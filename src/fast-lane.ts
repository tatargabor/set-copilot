/**
 * The fast lane — a spoken command, taken out of the ambient stream.
 *
 * Everything else this copilot does is *inference*: it listens, judges, and decides
 * whether something is worth saying. That path is deliberately gated (silence, dwell,
 * a whole model turn composing narration and drawings together) and it measures ~33 s
 * from a sentence to a reaction. For a spoken INSTRUCTION that is the wrong trade:
 * nothing has to be inferred, so nothing should be waited for.
 *
 * Three decisions carry this module, each of them a consequence of how speech actually
 * arrives rather than how it reads afterwards:
 *
 * 1. **It reads the TOKEN stream, not the transcript lines.** A line is a flush artefact:
 *    the writer cuts on a sentence boundary, on 3 s of that speaker's silence, or on 80
 *    tokens — none of which respect where an instruction begins and ends. A marker split
 *    across a flush ("CSI" | "NÁLD") is invisible to any line-level matcher, and an
 *    instruction spanning two sentences would be seen in halves. The state machine keeps
 *    its own rolling buffer per speaker, which no flush touches.
 *
 * 2. **A command is BRACKETED, and the closing marker is load-bearing.** Speech has no
 *    reliable end-of-thought: the recogniser's punctuation is a guess, and a speaker who
 *    pauses mid-instruction has not finished. Without a terminator the engine would have
 *    to guess when to execute, and the failure mode is acting on half a sentence. With
 *    one, "finished" is something the speaker SAYS. It also makes the trigger deliberate:
 *    a start word alone can be said by accident, both words in order much less so.
 *
 * 3. **An unterminated command is abandoned OUT LOUD.** A speaker who says the opening
 *    word and then changes their mind must not leave the engine holding an open span for
 *    the rest of the meeting — and must not have their next twenty minutes of speech
 *    silently become "the instruction". So a span dies on a cap (time or length) and says
 *    so, because a command that quietly never happened is indistinguishable from one the
 *    engine never heard, and the operator would debug the microphone.
 *
 * Matching is accent- and case-insensitive over Unicode letters, so "CSINÁLD", "csinald"
 * and "Csináld" are one marker; the extracted instruction keeps the speaker's own text,
 * accents and all. Markers match as whole words: "restart" never opens a command.
 */

/** The words that open and close a spoken command, and the caps that bound one. */
export interface FastLaneConfig {
  enabled: boolean;
  /** Words that OPEN a command span (matched as whole words, accent-insensitive). */
  start: string[];
  /** Words that CLOSE it and hand the instruction over. */
  end: string[];
  /** An open span older than this is abandoned. */
  maxSpanMs: number;
  /** An open span longer than this many characters is abandoned. */
  maxChars: number;
}

export type FastLaneEvent =
  /** A complete, bracketed instruction. `text` is what was said BETWEEN the markers. */
  | { kind: "command"; speaker: string; text: string; startTs: number; ts: number }
  /** An opened span that never closed. Reported so the silence is explainable. */
  | { kind: "abandoned"; speaker: string; partial: string; reason: "timeout" | "too-long"; startTs: number; ts: number };

/**
 * Fold a string to its matching form: lowercase, accents removed, every non
 * letter/digit run collapsed to a single space.
 *
 * NFD + combining-mark strip rather than an enumerated character class — the same rule
 * the rest of this project follows for word boundaries. An enumerated Latin+Hungarian
 * class works until the first speaker of another language, and then fails silently.
 */
function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ");
}

/**
 * Where `marker` occurs as a whole word in the folded text: the index just past it, or
 * -1. Whole-word only, so "start" does not fire inside "restart" or "startup".
 */
function findWord(folded: string, marker: string): number {
  const m = fold(marker).trim();
  if (!m) return -1;
  let from = 0;
  for (;;) {
    const at = folded.indexOf(m, from);
    if (at < 0) return -1;
    const before = at === 0 ? " " : folded[at - 1];
    const after = at + m.length >= folded.length ? " " : folded[at + m.length];
    if (before === " " && after === " ") return at + m.length;
    from = at + 1;
  }
}

/** The earliest whole-word hit among several markers: index just past it, or -1. */
function findAny(folded: string, markers: string[]): number {
  let best = -1;
  for (const marker of markers) {
    const end = findWord(folded, marker);
    if (end >= 0 && (best < 0 || end < best)) best = end;
  }
  return best;
}

interface Span { text: string; startTs: number; openedAt: number }

/**
 * The span assembler. Pure apart from the clock, which is passed in — so every rule
 * below (including the caps) is testable without timers.
 */
export class FastLane {
  private readonly cfg: FastLaneConfig;
  /** Text seen since the last marker decision, per speaker. Never reset by a flush. */
  private readonly pending: Record<string, string> = {};
  /** The open span, per speaker. At most one — a second opener restarts it. */
  private readonly open: Record<string, Span | undefined> = {};

  constructor(cfg: FastLaneConfig) {
    this.cfg = cfg;
  }

  /** True when a command span is currently open for this speaker. */
  isOpen(speaker: string): boolean {
    return this.open[speaker] !== undefined;
  }

  /**
   * Feed one piece of recognised speech. Any granularity works — a token, a word, a
   * whole flushed line — because the matcher only ever looks at the accumulated buffer.
   */
  feed(speaker: string, text: string, ts: number, now: number): FastLaneEvent[] {
    if (!this.cfg.enabled || !text) return [];
    const out: FastLaneEvent[] = [];
    let span = this.open[speaker];

    if (span) {
      span.text += text;
      const folded = fold(span.text);
      const closes = findAny(folded, this.cfg.end);
      if (closes >= 0) {
        // The instruction is what lies between the markers. Cut on the RAW text at the
        // proportional point rather than the folded one: folding changes lengths, and
        // an instruction with the closing word left on the end reads as part of it.
        const instruction = cutBeforeMarker(span.text, this.cfg.end).trim();
        this.open[speaker] = undefined;
        this.pending[speaker] = "";
        out.push({ kind: "command", speaker, text: instruction, startTs: span.startTs, ts });
        return out;
      }
      const reason = span.text.length > this.cfg.maxChars
        ? "too-long" as const
        : now - span.openedAt > this.cfg.maxSpanMs
          ? "timeout" as const
          : null;
      if (reason) {
        this.open[speaker] = undefined;
        this.pending[speaker] = "";
        out.push({ kind: "abandoned", speaker, partial: span.text.trim(), reason, startTs: span.startTs, ts });
      }
      return out;
    }

    // No span open: watch for an opener. The pending buffer is bounded so a meeting
    // with no command in it never grows memory — a marker is a word, not a paragraph.
    const buf = (this.pending[speaker] ?? "") + text;
    const folded = fold(buf);
    const opens = findAny(folded, this.cfg.start);
    if (opens >= 0) {
      this.open[speaker] = { text: cutAfterMarker(buf, this.cfg.start), startTs: ts, openedAt: now };
      this.pending[speaker] = "";
      // The opener and closer can arrive in the SAME piece ("copilot rajzolj csináld"),
      // so the just-opened span is examined at once rather than waiting for more speech
      // that may never come.
      return this.closeIfClosed(speaker, ts);
    }
    this.pending[speaker] = buf.slice(-MAX_PENDING);
    return out;
  }

  /** Re-check an open span for a closing marker already inside it. */
  private closeIfClosed(speaker: string, ts: number): FastLaneEvent[] {
    const span = this.open[speaker];
    if (!span) return [];
    if (findAny(fold(span.text), this.cfg.end) < 0) return [];
    const instruction = cutBeforeMarker(span.text, this.cfg.end).trim();
    this.open[speaker] = undefined;
    return [{ kind: "command", speaker, text: instruction, startTs: span.startTs, ts }];
  }

  /**
   * Close out an open span at end of capture. A speaker who was mid-instruction when
   * the recording stopped gets the abandonment reported, not swallowed.
   */
  close(ts: number): FastLaneEvent[] {
    const out: FastLaneEvent[] = [];
    for (const [speaker, span] of Object.entries(this.open)) {
      if (!span) continue;
      this.open[speaker] = undefined;
      out.push({ kind: "abandoned", speaker, partial: span.text.trim(), reason: "timeout", startTs: span.startTs, ts });
    }
    return out;
  }
}

/** Enough to hold any plausible marker plus the fragments around it. */
const MAX_PENDING = 200;

/** The raw text AFTER the earliest start marker in it. */
function cutAfterMarker(raw: string, markers: string[]): string {
  return sliceAtMarker(raw, markers, "after");
}

/** The raw text BEFORE the earliest end marker in it. */
function cutBeforeMarker(raw: string, markers: string[]): string {
  return sliceAtMarker(raw, markers, "before");
}

/**
 * Cut raw text at a marker, working in the RAW string.
 *
 * Folding collapses punctuation and strips accents, so a folded index does not
 * correspond to a raw one — using it would slice an instruction a few characters off
 * and eat the first letter of what the speaker actually asked for. Walking raw words
 * and folding each one keeps the two in step.
 */
function sliceAtMarker(raw: string, markers: string[], side: "before" | "after"): string {
  const folded = markers.map((m) => fold(m).trim()).filter(Boolean);
  const re = /[\p{L}\p{N}]+/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const word = fold(m[0]).trim();
    if (folded.includes(word)) {
      return side === "after" ? raw.slice(m.index + m[0].length) : raw.slice(0, m.index);
    }
  }
  return side === "after" ? "" : raw;
}
