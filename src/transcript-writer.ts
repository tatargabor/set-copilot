import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULT_DETECT, type DetectionConfig } from "./config.js";
import type { TranscriptEvent } from "./soniox-rt.js";

export interface TranscriptLine {
  ts: number;
  speaker: "mic" | "system";
  text: string;
  final: boolean;
  /** Keyword-index matches (entity names, features, decision ids) — omitted when empty */
  topics?: string[];
  /** Set to "high" when the text matches a `detect.urgency` pattern */
  urgency?: "high";
  /** True when the text matches a `detect.question` pattern */
  question?: boolean;
  /**
   * True when the mic speaker addressed the copilot by name (`copilot.names` /
   * `detect.command`). `poll` returns at once on such a line rather than waiting for
   * the silence event — a direct instruction should not sit behind an ambient gate.
   */
  command?: boolean;
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
  /** Regex sources behind the urgency/question flags (default: config DEFAULT_DETECT) */
  detect?: DetectionConfig;
}

const noopMatcher = (): string[] => [];

/**
 * Compile `detect` sources into one regex. Patterns are user-supplied, so a bad
 * one must not take the capture down with it — it is dropped with a warning.
 */
function compileDetector(sources: string[], kind: string): RegExp | null {
  const good: string[] = [];
  for (const src of sources) {
    try {
      new RegExp(src, "iu");
      good.push(`(?:${src})`);
    } catch (err) {
      console.error(`[set-copilot] Ignoring invalid detect.${kind} pattern ${JSON.stringify(src)}: ${(err as Error).message}`);
    }
  }
  return good.length ? new RegExp(good.join("|"), "iu") : null;
}

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
  private urgencyRe: RegExp | null;
  private questionRe: RegExp | null;
  private commandRe: RegExp | null;
  /** Wall-clock time of the last final transcript event (any speaker); 0 = no speech yet */
  private lastEventAt = 0;
  /** True once the silence event for the current silence period has been written */
  private silenceEmitted = false;

  constructor(outputPath: string, opts?: TranscriptWriterOptions) {
    this.outputPath = outputPath;
    this.silenceTimeoutMs = opts?.silenceTimeoutMs ?? 3000;
    this.maxBufferTokens = opts?.maxBufferWords ?? 80;
    this.topicMatcher = opts?.topicMatcher ?? noopMatcher;

    const detect = opts?.detect ?? DEFAULT_DETECT;
    this.urgencyRe = compileDetector(detect.urgency, "urgency");
    this.questionRe = compileDetector(detect.question, "question");
    this.commandRe = compileDetector(detect.command ?? [], "command");

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
    if (this.urgencyRe?.test(text)) {
      line.urgency = "high";
    }
    if (this.questionRe?.test(text)) {
      line.question = true;
    }
    // Only the mic speaker can address the copilot — a name heard on the system
    // channel is someone else's meeting, not an instruction to us. Same restriction
    // the voice-command scoping already uses.
    if (speaker === "mic" && this.commandRe?.test(text)) {
      line.command = true;
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

  /**
   * Record a non-speech event (currently: a transcription reconnect) in the same
   * stream as the speech. The point is honesty about coverage: if the socket dropped,
   * the reader — human or copilot — must be able to see that there is a hole here,
   * rather than reading an unbroken transcript that quietly skipped a minute.
   */
  writeEvent(type: string, fields: Record<string, unknown> = {}): void {
    const event = {
      type,
      ...fields,
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
