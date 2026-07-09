import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type { TranscriptEvent } from "./soniox-rt.js";

export interface TranscriptLine {
  ts: number;
  speaker: "mic" | "system";
  text: string;
  final: boolean;
  /** Keyword-index matches (entity names, features, decision ids) — omitted when empty */
  topics?: string[];
  /** Set to "high" when the text contains urgency indicators (hiba, probléma, sürgős, etc.) */
  urgency?: "high";
  /** True when the text appears to be a question */
  question?: boolean;
}

export interface SilenceEvent {
  type: "silence";
  /** How long the silence has lasted at emission time */
  duration_ms: number;
  /** Transcript timestamp of the last speech before the silence */
  ts: number;
}

export interface TranscriptWriterOptions {
  silenceTimeoutMs?: number;
  maxBufferWords?: number;
  /** How often the silence check runs (default 1000ms; lower in tests) */
  checkIntervalMs?: number;
  /** Topic matcher for the "topics" field (default: no-op — capture injects the real one) */
  topicMatcher?: (text: string) => string[];
}

const noopMatcher = (): string[] => [];

/**
 * Sentence-based transcript writer.
 *
 * Accumulates finalized words per speaker. Flushes to JSONL when:
 * 1. A sentence boundary is detected (. ? ! followed by space or end)
 * 2. Speaker changes (the other channel produces output)
 * 3. Silence timeout (no new words for N seconds)
 * 4. Buffer exceeds max length (safety flush)
 *
 * Each flushed line gets a "topics" field with keyword-index matches so the
 * copilot can route on pre-matched topics instead of re-scanning the raw text.
 *
 * When speech stops for longer than the silence timeout, a single
 * {"type":"silence","duration_ms":N} event is written per silence period.
 */
export class TranscriptWriter {
  private outputPath: string;
  private buffers: Record<"mic" | "system", { text: string; tokenCount: number; lastTs: number; lastActivity: number }>;
  private silenceTimeoutMs: number;
  private maxBufferTokens: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private topicMatcher: (text: string) => string[];
  /** Wall-clock time of the last final transcript event (any speaker); 0 = no speech yet */
  private lastEventAt = 0;
  /** True once the silence event for the current silence period has been written */
  private silenceEmitted = false;

  constructor(outputPath: string, opts?: TranscriptWriterOptions) {
    this.outputPath = outputPath;
    this.silenceTimeoutMs = opts?.silenceTimeoutMs ?? 3000;
    this.maxBufferTokens = opts?.maxBufferWords ?? 80;
    this.topicMatcher = opts?.topicMatcher ?? noopMatcher;

    this.buffers = {
      mic: { text: "", tokenCount: 0, lastTs: 0, lastActivity: 0 },
      system: { text: "", tokenCount: 0, lastTs: 0, lastActivity: 0 },
    };

    const dir = dirname(outputPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Check for silence timeout periodically
    this.timer = setInterval(() => this.checkSilence(), opts?.checkIntervalMs ?? 1000);
  }

  onTranscript(event: TranscriptEvent): void {
    if (!event.isFinal) return;
    if (!event.text) return;

    const buf = this.buffers[event.speaker];

    // Soniox RT v5 tokens include leading spaces for word boundaries.
    // Concatenate directly — do NOT join with extra spaces.
    buf.text += event.text;
    buf.tokenCount++;
    buf.lastTs = event.timestampMs;
    buf.lastActivity = Date.now();

    // Speech resumed — the next silence period gets a fresh event
    this.lastEventAt = buf.lastActivity;
    this.silenceEmitted = false;

    const accumulated = buf.text;
    const sentences = this.extractCompleteSentences(accumulated);

    if (sentences.completed.length > 0) {
      this.writeLine(event.speaker, sentences.completed, buf.lastTs);
      buf.text = sentences.remainder;
      buf.tokenCount = sentences.remainder ? 1 : 0;
    }

    // Safety flush if buffer is too long
    if (buf.tokenCount > this.maxBufferTokens) {
      const text = buf.text.trim();
      if (text) {
        this.writeLine(event.speaker, text, buf.lastTs);
      }
      buf.text = "";
      buf.tokenCount = 0;
    }
  }

  /**
   * When one speaker produces output, flush the OTHER speaker's buffer.
   * This handles the natural turn-taking in conversation.
   */
  onSpeakerChange(activeSpeaker: "mic" | "system"): void {
    const other = activeSpeaker === "mic" ? "system" : "mic";
    this.flushBuffer(other);
  }

  private checkSilence(): void {
    const now = Date.now();
    for (const speaker of ["mic", "system"] as const) {
      const buf = this.buffers[speaker];
      if (buf.text.length > 0 && buf.lastActivity > 0) {
        if (now - buf.lastActivity > this.silenceTimeoutMs) {
          this.flushBuffer(speaker);
        }
      }
    }

    // Silence event: speech happened, all buffers are flushed, and nothing
    // new has arrived for the timeout — emit ONE event per silence period.
    if (
      this.lastEventAt > 0 &&
      !this.silenceEmitted &&
      now - this.lastEventAt > this.silenceTimeoutMs &&
      !this.buffers.mic.text &&
      !this.buffers.system.text
    ) {
      this.writeSilence(now - this.lastEventAt);
      this.silenceEmitted = true;
    }
  }

  private extractCompleteSentences(text: string): { completed: string; remainder: string } {
    // Find the last sentence-ending punctuation followed by space or end
    const sentenceEndPattern = /[.?!…]\s+/g;
    let lastEnd = -1;
    let match;
    while ((match = sentenceEndPattern.exec(text)) !== null) {
      lastEnd = match.index + match[0].length;
    }

    // Also check if text ends with sentence-ending punctuation
    if (/[.?!…]$/.test(text.trim())) {
      return { completed: text.trim(), remainder: "" };
    }

    if (lastEnd > 0) {
      return {
        completed: text.slice(0, lastEnd).trim(),
        remainder: text.slice(lastEnd).trim(),
      };
    }

    return { completed: "", remainder: text };
  }

  private flushBuffer(speaker: "mic" | "system"): void {
    const buf = this.buffers[speaker];
    if (!buf.text) return;

    const text = buf.text.trim();
    if (text) {
      this.writeLine(speaker, text, buf.lastTs);
    }
    buf.text = "";
    buf.tokenCount = 0;
  }

  private writeLine(speaker: "mic" | "system", text: string, ts: number): void {
    const line: TranscriptLine = { ts, speaker, text, final: true };
    const topics = this.topicMatcher(text);
    if (topics.length > 0) {
      line.topics = topics;
    }
    if (detectUrgency(text)) {
      line.urgency = "high";
    }
    if (detectQuestion(text)) {
      line.question = true;
    }
    appendFileSync(this.outputPath, JSON.stringify(line) + "\n");
  }

  private writeSilence(durationMs: number): void {
    const event: SilenceEvent = {
      type: "silence",
      duration_ms: durationMs,
      ts: Math.max(this.buffers.mic.lastTs, this.buffers.system.lastTs),
    };
    appendFileSync(this.outputPath, JSON.stringify(event) + "\n");
  }

  close(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.flushBuffer("mic");
    this.flushBuffer("system");
  }
}

const URGENCY_RE =
  /(?:^|[^a-záéíóöőúüű])(hib[aá]|probléma|nem működ|sürgős|nem jó|rossz|elroml|baj van|nem stim|nem ok|gond van|bug|broken|crash)/iu;

function detectUrgency(text: string): boolean {
  return URGENCY_RE.test(text);
}

const QUESTION_RE = /[?]\s*$|(?:^|[.!]\s+)(?:mi[tck]?soda|hogyan|miért|mikor|hol|ki |mennyit?|melyik|hány|mit |mit\b|milyen|hogy\b|kell-e|lehet-e|van-e|tudunk-e)/iu;

function detectQuestion(text: string): boolean {
  return QUESTION_RE.test(text);
}
