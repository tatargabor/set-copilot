import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULT_DETECT, type DetectionConfig } from "./config.js";
import type { TranscriptEvent } from "./soniox-rt.js";

export interface TranscriptLine {
  ts: number;
  speaker: "mic" | "system";
  text: string;
  final: boolean;
  /**
   * Timestamp of the FIRST token in this line. `ts` is the last token's — fine for a
   * single channel, but with two channels a long utterance completes after several
   * short ones from the other side, so completion order is not speaking order.
   * A reader that wants the conversation in the order it was spoken sorts on this.
   */
  startTs?: number;
  /**
   * True when this line was cut without a sentence boundary (own-silence or overflow
   * flush) — the utterance continues in the speaker's next line. Without this a reader
   * cannot tell a finished thought from a severed one.
   */
  partial?: boolean;
  /** True when this line resumes the speaker's previous `partial` line. */
  cont?: boolean;
  /**
   * Only on a `cont` line: the resumed text did NOT start at a word boundary, so the
   * previous line's last word and this line's first word are two halves of ONE word.
   * Join them with no separator; a `cont` line without this flag takes a space.
   *
   * Soniox marks word boundaries with a leading space on the token, and that space is
   * the only evidence — trimming it at flush time destroys it irrecoverably. This flag
   * preserves the fact after the trim.
   */
  midWord?: boolean;
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
 * 2. Silence timeout (no new words from THAT speaker for N seconds)
 * 3. Buffer exceeds max length (safety flush)
 *
 * A speaker change deliberately does NOT flush the other channel. It used to, on a
 * "natural turn-taking" assumption that only holds for a single diarized stream: with
 * two independent channels the speech genuinely overlaps, and constant backchannel
 * ("mhm", "aha") on one channel severed the other's sentence — mid-word, because the
 * cut lands wherever the token stream happens to be. Measured on a 3-hour two-channel
 * recording: 460 mid-word cuts, 44% of them immediately after a cross-channel
 * interjection, 154 of those after a backchannel of three words or less.
 *
 * Each speaker's own sentence and silence rules are what bound its buffer; the reader
 * orders the conversation with `startTs`.
 *
 * Each flushed line gets a "topics" field with keyword-index matches so the
 * copilot can route on pre-matched topics instead of re-scanning the raw text.
 *
 * When speech stops for longer than the silence timeout, a single
 * {"type":"silence","duration_ms":N} event is written per silence period.
 */
export class TranscriptWriter {
  private outputPath: string;
  private buffers: Record<
    "mic" | "system",
    {
      text: string;
      tokenCount: number;
      lastTs: number;
      lastActivity: number;
      /** Timestamp of the first token currently in the buffer */
      startTs: number;
      /** The last line written for this speaker was cut mid-utterance */
      severed: boolean;
      /** The buffer was refilled after a severed line — the next line continues it */
      resuming: boolean;
      /** The resumed text did not start at a word boundary (no leading space) */
      resumedMidWord: boolean;
    }
  >;
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

    const emptyBuffer = () => ({
      text: "",
      tokenCount: 0,
      lastTs: 0,
      lastActivity: 0,
      startTs: 0,
      severed: false,
      resuming: false,
      resumedMidWord: false,
    });
    this.buffers = { mic: emptyBuffer(), system: emptyBuffer() };

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

    // First token of a fresh buffer: remember when the utterance started, and — if the
    // previous line was severed — whether this token opens a new word. Soniox marks a
    // word boundary with a leading space, and `flushBuffer` trims it away, so it has to
    // be captured HERE or it is gone.
    if (!buf.text) {
      buf.startTs = event.timestampMs;
      if (buf.severed) {
        buf.resuming = true;
        buf.resumedMidWord = !/^\s/.test(event.text);
        buf.severed = false;
      }
    }

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
      this.writeLine(event.speaker, sentences.completed, buf);
      buf.text = sentences.remainder;
      buf.tokenCount = sentences.remainder ? 1 : 0;
      buf.startTs = sentences.remainder ? buf.lastTs : 0;
    }

    // Safety flush if buffer is too long
    if (buf.tokenCount > this.maxBufferTokens) {
      this.flushBuffer(event.speaker, { partial: true });
    }
  }

  private checkSilence(): void {
    const now = Date.now();
    for (const speaker of ["mic", "system"] as const) {
      const buf = this.buffers[speaker];
      if (buf.text.length > 0 && buf.lastActivity > 0) {
        if (now - buf.lastActivity > this.silenceTimeoutMs) {
          this.flushBuffer(speaker, { partial: true });
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

  /**
   * Write out whatever the speaker has buffered.
   *
   * `partial` marks a cut that is NOT a sentence boundary — the thought continues in
   * this speaker's next line. The buffer remembers that (`severed`) so the resuming
   * line can record whether it picked up mid-word.
   */
  private flushBuffer(speaker: "mic" | "system", opts: { partial?: boolean } = {}): void {
    const buf = this.buffers[speaker];
    if (!buf.text) return;

    const text = buf.text.trim();
    if (text) {
      this.writeLine(speaker, text, buf, { partial: opts.partial });
      if (opts.partial) buf.severed = true;
    }
    buf.text = "";
    buf.tokenCount = 0;
    buf.startTs = 0;
  }

  private writeLine(
    speaker: "mic" | "system",
    text: string,
    buf: { lastTs: number; startTs: number; resuming: boolean; resumedMidWord: boolean },
    opts: { partial?: boolean } = {},
  ): void {
    const line: TranscriptLine = { ts: buf.lastTs, speaker, text, final: true };
    if (buf.startTs && buf.startTs !== buf.lastTs) {
      line.startTs = buf.startTs;
    }
    if (opts.partial) {
      line.partial = true;
    }
    if (buf.resuming) {
      line.cont = true;
      if (buf.resumedMidWord) line.midWord = true;
      buf.resuming = false;
      buf.resumedMidWord = false;
    }
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
