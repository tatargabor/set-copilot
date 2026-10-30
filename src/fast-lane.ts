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
 * 4. **Only an ADDRESS opens a command** (command-trigger-precision). In a meeting about the copilot its
 *    own name is ordinary speech, and a remote participant's "start … stop" is ordinary
 *    speech too: one recorded meeting logged 16 false openings and no real command.
 *    So an opener counts only on a configured channel (default: the operator's mic) and
 *    only where it BEGINS an utterance — nothing but punctuation before it since that
 *    speaker's last sentence end or last pause. "Copilot, draw …" opens; "…when the
 *    copilot started" does not.
 *
 * Matching is accent- and case-insensitive over Unicode letters, so "CSINÁLD", "csinald"
 * and "Csináld" are one marker; the extracted instruction keeps the speaker's own text,
 * accents and all. Markers match as whole words: "restart" never opens a command, and an
 * opener counts only once a boundary AFTER it has been seen in the stream — "Copilot" + "ot"
 * is one word, `Copilotot`, not an opener (see `findWord`).
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
  /** Speakers (channels) that may open a command. Any other speaker is ignored entirely. */
  channels: string[];
  /** When true, an opener counts only at the start of an utterance. */
  utteranceStart: boolean;
  /** A same-speaker gap at least this long (speech time, ms) starts a new utterance. */
  utterancePauseMs: number;
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
 *
 * `endIsBoundary` decides what the END of the text counts as. For a closing word it is a
 * boundary: the speaker hands the instruction over by saying it, and waiting for the token
 * after it would hold every command until they say something else. For an OPENING word it
 * is not (`fast-lane-opener-boundary`): speech arrives as tokens, and Hungarian attaches a
 * suffix directly to the word, which Soniox delivers as its own token — `" Copilot"` then
 * `"ot"`. Measured 2026-10-07: „Meeting Copilotot", „Copilotokat" and „Set Copilotos" each
 * opened a command in one meeting, because after the first token the buffer ended in
 * `copilot`. So an opener counts only once a separator has actually been SEEN after it — the
 * leading space of the next word's token, or punctuation; until then it is held.
 */
function findWord(folded: string, marker: string, endIsBoundary: boolean): number {
  const m = fold(marker).trim();
  if (!m) return -1;
  let from = 0;
  for (;;) {
    const at = folded.indexOf(m, from);
    if (at < 0) return -1;
    const atEnd = at + m.length >= folded.length;
    const before = at === 0 ? " " : folded[at - 1];
    const after = atEnd ? (endIsBoundary ? " " : "") : folded[at + m.length];
    if (before === " " && after === " ") return at + m.length;
    from = at + 1;
  }
}

/** The earliest whole-word hit among several markers: index just past it, or -1. */
function findAny(folded: string, markers: string[], endIsBoundary: boolean): number {
  let best = -1;
  for (const marker of markers) {
    const end = findWord(folded, marker, endIsBoundary);
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
  /** Speech time of the speaker's previous piece — the pause clock for utterance starts. */
  private readonly lastTs: Record<string, number> = {};
  /**
   * When the pending buffer ends in an opener not yet confirmed by a boundary: the `ts` and
   * clock of the piece it arrived in. A confirmed span starts THERE — where the word was said,
   * not one token later where the boundary after it was seen.
   */
  private readonly held: Record<string, { ts: number; now: number } | undefined> = {};

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
    // A channel that may not address the copilot touches no state at all: a remote
    // participant can never be the operator, and a COMPLETED false command is executed.
    if (!this.cfg.channels.includes(speaker)) return [];
    const span = this.open[speaker];
    const prevTs = this.lastTs[speaker];
    this.lastTs[speaker] = ts;

    if (span) {
      span.text += text;
      return this.settle(speaker, ts, now);
    }

    // No span open: watch for an opener. The pending buffer is bounded so a meeting
    // with no command in it never grows memory — a marker is a word, not a paragraph.
    // A pause is an utterance boundary: what was said before it cannot precede an opener.
    // An opener still held across the pause stays, and the pause is the boundary it waited for.
    const paused = this.cfg.utteranceStart && prevTs !== undefined && ts - prevTs >= this.cfg.utterancePauseMs;
    const before = this.pending[speaker] ?? "";
    const buf = (paused ? (this.held[speaker] ? before + " " : "") : before) + text;
    const opens = this.opener(buf, false);
    if (opens >= 0) {
      const at = this.held[speaker] ?? { ts, now };
      this.held[speaker] = undefined;
      const rest = this.cfg.utteranceStart ? buf.slice(opens) : cutAfterMarker(buf, this.cfg.start);
      this.open[speaker] = { text: rest, startTs: at.ts, openedAt: at.now };
      this.pending[speaker] = "";
      // The opener and closer can arrive in the SAME piece ("copilot rajzolj csináld"),
      // and a held opener is confirmed by a piece that may already be long or late — so the
      // just-opened span is judged at once, by the same close/cap rules as any open span,
      // rather than waiting for more speech that may never come.
      return this.settle(speaker, ts, now);
    }
    // An opener the buffer ENDS with is held, not matched: remember where it was said.
    // Re-derived from the whole buffer every piece, so a suffix token (`ot`) that continues
    // the word clears it again.
    if (this.opener(buf, true) >= 0) this.held[speaker] ??= { ts, now };
    else this.held[speaker] = undefined;
    // Truncating must not manufacture an utterance start: a tail that happens to begin
    // with the marker was preceded by speech, so a placeholder word stands in for it.
    this.pending[speaker] = buf.length > MAX_PENDING ? MID_SPEECH + trimPending(buf) : buf;
    return [];
  }

  /**
   * Where an opener counts in this buffer: the raw index just past it, or -1. Without
   * utterance starts any index >= 0 only says one is there.
   */
  private opener(buf: string, endIsBoundary: boolean): number {
    return this.cfg.utteranceStart
      ? utteranceOpener(buf, this.cfg.start, endIsBoundary)
      : findAny(fold(buf), this.cfg.start, endIsBoundary) >= 0 ? 0 : -1;
  }

  /**
   * Judge an open span: a closing word inside it completes the command; otherwise the time
   * and length caps may abandon it. Shared by every path that leaves a span open.
   */
  private settle(speaker: string, ts: number, now: number): FastLaneEvent[] {
    const span = this.open[speaker];
    if (!span) return [];
    if (findAny(fold(span.text), this.cfg.end, true) >= 0) {
      // The instruction is what lies between the markers. Cut on the RAW text at the
      // proportional point rather than the folded one: folding changes lengths, and
      // an instruction with the closing word left on the end reads as part of it.
      const instruction = cutBeforeMarker(span.text, this.cfg.end).trim();
      this.open[speaker] = undefined;
      this.pending[speaker] = "";
      return [{ kind: "command", speaker, text: instruction, startTs: span.startTs, ts }];
    }
    const reason = span.text.length > this.cfg.maxChars
      ? "too-long" as const
      : now - span.openedAt > this.cfg.maxSpanMs
        ? "timeout" as const
        : null;
    if (!reason) return [];
    this.open[speaker] = undefined;
    // The speaker is mid-speech when a cap fires: their next word is not an
    // utterance start, so the buffer must not look like one.
    this.pending[speaker] = MID_SPEECH;
    return [{ kind: "abandoned", speaker, partial: span.text.trim(), reason, startTs: span.startTs, ts }];
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

/**
 * A placeholder word standing for speech the buffer no longer holds. Prefixed where the
 * buffer is reset or truncated MID-utterance, so an opener right after it is correctly
 * read as mid-sentence. Any letter works; it never reaches an instruction's text.
 */
const MID_SPEECH = "x ";

/**
 * The raw index just past the first start marker that BEGINS an utterance, or -1.
 *
 * "Begins" means no letter or digit between the last sentence terminator before it and
 * the marker itself — punctuation and whitespace ("…kész. — Copilot,") do not count.
 * Raw words are walked and folded one by one, as `sliceAtMarker` does, so the index is a
 * raw one. A marker said mid-sentence is skipped, not fatal: the same buffer may still
 * hold a sentence-initial one further on. `endIsBoundary` means what it means in `findWord`.
 */
function utteranceOpener(raw: string, markers: string[], endIsBoundary: boolean): number {
  const folded = markers.map((m) => fold(m).trim()).filter(Boolean);
  const re = /[\p{L}\p{N}]+/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    if (!folded.includes(fold(m[0]).trim())) continue;
    if (!endIsBoundary && m.index + m[0].length >= raw.length) continue;
    const before = raw.slice(0, m.index);
    const sentenceEnd = Math.max(before.lastIndexOf("."), before.lastIndexOf("?"), before.lastIndexOf("!"));
    if (!/[\p{L}\p{N}]/u.test(before.slice(sentenceEnd + 1))) return m.index + m[0].length;
  }
  return -1;
}

/**
 * Keep the last `MAX_PENDING` characters — cut on a word boundary. A slice that starts inside
 * a word (`…autocopilot` → `copilot…`) would present the word's tail as a whole word, with
 * "start of buffer" passing as the boundary before it: the same buffer-edge-is-a-word-edge
 * mistake as an opener at the end, at the other end.
 */
function trimPending(buf: string): string {
  if (buf.length <= MAX_PENDING) return buf;
  const cut = buf.length - MAX_PENDING;
  const tail = buf.slice(cut);
  return /[\p{L}\p{N}]/u.test(buf[cut - 1]) ? tail.replace(/^[\p{L}\p{N}]+/u, "") : tail;
}

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
