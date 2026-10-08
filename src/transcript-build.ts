/**
 * Transcript stitch — turning the capture's fragments back into sentences.
 *
 * The writer's line boundaries (sentence end / that speaker's own 3s silence / 80-token
 * overflow) are not meaning boundaries, and with two channels the fragments interleave.
 * Before `a30d12f` a cross-channel interjection also cut a line wherever the token stream
 * happened to stand — mid-word. That fix stopped the cutting and recorded `startTs` /
 * `partial` / `cont` / `midWord` so the remaining boundaries would be REVERSIBLE. This
 * module is what reverses them; without it those fields have no consumer, and a reader
 * gets the same fragments the capture wrote.
 *
 * The load-bearing insight: a channel's fragments are complete and in order WITHIN the
 * channel — only the interleaving destroyed readability. So each channel is rebuilt on
 * its own, split into sentences, and only the FINISHED sentences are merged. Stitching in
 * stream order would interleave halves of two different utterances.
 *
 * Everything here is pure: parsed lines in, artifacts out. File I/O and argument parsing
 * live in `cli.ts`, which is what keeps this unit-testable the way `transcript-writer` is.
 */

/** A speech line as the writer wrote it (see `TranscriptLine`), parsed and trusted loosely. */
export interface StitchLine {
  ts: number;
  speaker: string;
  text: string;
  /**
   * Position in the file. The transcript is append-only, so file order IS recording
   * order — and it is the only thing that survives a capture rotation, where the
   * timestamps themselves restart. Sorting by `ts` before the rotation is repaired
   * would sort the backwards jump away and hide the rotation entirely.
   */
  seq?: number;
  /** First token's timestamp; absent on recordings that predate `a30d12f` */
  startTs?: number;
  partial?: boolean;
  cont?: boolean;
  midWord?: boolean;
}

/** A non-speech event kept on the timeline because it means words may be MISSING. */
export interface StitchEvent {
  type: string;
  ts: number;
  /** Position in the file — see `StitchLine.seq` */
  seq?: number;
  speaker?: string;
  downtimeMs?: number;
  replayedMs?: number;
}

export interface StitchedSentence {
  speaker: string;
  text: string;
  /** When the sentence STARTED (from `startTs`, falling back to `ts`) */
  startTs: number;
  /** When its last fragment completed */
  endTs: number;
  /** The other channel was speaking during this sentence */
  overlap?: boolean;
  /**
   * File position of the sentence's first fragment. Only used to order the rendered
   * stream against the timeline events, whose `ts` is the last speech BEFORE them — so
   * an event and the sentence it follows share a timestamp and only file order separates
   * them. Not part of the output.
   */
  seq?: number;
  /**
   * Every word boundary inside this sentence was known exactly (from `cont`/`midWord`)
   * rather than guessed by the heuristic. False marks a sentence a reader should trust
   * a little less — it is the per-sentence form of what `--stats` reports in aggregate.
   */
  exact: boolean;
}

/** A time window to cut from the output, with the reason shown in its place. */
export interface RedactionWindow {
  from: number;
  to: number;
  reason: string;
}

export interface StitchOptions {
  /** Channel → display name; an unmapped channel falls back to its raw name */
  speakers?: Record<string, string>;
  /** Words complete on their own — the heuristic fallback's dictionary */
  completeWords?: string[];
  /** A gap at least this long is a word boundary (heuristic only) */
  pauseGapMs?: number;
  redactions?: RedactionWindow[];
}

export interface StitchStats {
  segments: number;
  sentences: number;
  /** Boundaries decided from `cont`/`midWord` */
  exact: number;
  /** Boundaries the heuristic had to guess */
  guessed: number;
  /** Of the guessed ones, how many were joined WITHOUT a separator (a healed mid-word cut) */
  healed: number;
  /** True when the input's timestamps restarted (a capture rotation was repaired) */
  rotated: boolean;
  /**
   * How many times a channel's clock restarted. One per channel is a capture rotation;
   * more means the clocks cannot be trusted and the output is in recording order.
   */
  clockRepairs: number;
}

export interface StitchResult {
  markdown: string;
  jsonl: string;
  /** The reassembled text alone — what a dictation's consumer acts on (dictation-output). */
  plain: string;
  sentences: StitchedSentence[];
  stats: StitchStats;
}

const SENTENCE_END = /[.?!…]/;
/** A timestamp dropping back by more than this means the capture restarted, not a reorder. */
const ROTATION_GAP_MS = 60_000;
/** How far to look for an overlapping sentence from the other channel. */
const OVERLAP_WINDOW = 8;
/**
 * Length past which a terminator splits even if the text resumes lowercase — a bound on
 * how much damage the false-terminator rule can do when its assumption fails.
 *
 * It fails when one channel carries TWO overlapping remote speakers: their fragments
 * interleave inside the channel, every join looks like a mid-sentence continuation, and
 * the rule merges the lot. Measured on a real pre-`a30d12f` recording, that produced one
 * 1162-character wall of text per file. A genuine spoken sentence does not reach 600
 * characters (~100 words); the cleanest measured post-fix recording peaked at 487.
 */
const MAX_MERGED_SENTENCE = 600;

/**
 * Tolerant JSONL parse. A transcript can end in a half-written line (a capture killed
 * mid-append), and one bad line must never cost the other 1400 — so a parse failure is
 * skipped, not thrown. Speech lines and timeline events are separated here because they
 * are ordered by different rules downstream.
 */
export function parseLines(text: string): { lines: StitchLine[]; events: StitchEvent[] } {
  const lines: StitchLine[] = [];
  const events: StitchEvent[] = [];
  let seq = 0;
  for (const raw of text.split("\n")) {
    const s = raw.trim();
    if (!s) continue;
    seq++;
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(s) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (typeof o.type === "string") {
      // `silence` is a copilot-loop signal with no bearing on the text. `reconnect` is
      // the opposite: it marks a hole where words may be MISSING, and a reader who
      // cannot see it reads a truncated sentence as a complete one.
      if (o.type === "reconnect") {
        events.push({
          type: "reconnect",
          seq,
          ts: typeof o.ts === "number" ? o.ts : 0,
          speaker: typeof o.speaker === "string" ? o.speaker : undefined,
          downtimeMs: typeof o.downtime_ms === "number" ? o.downtime_ms : undefined,
          replayedMs: typeof o.replayed_audio_ms === "number" ? o.replayed_audio_ms : undefined,
        });
      }
      continue;
    }
    if (typeof o.text !== "string" || !o.text) continue;
    if (typeof o.speaker !== "string" || typeof o.ts !== "number") continue;
    lines.push({
      seq,
      ts: o.ts,
      speaker: o.speaker,
      text: o.text,
      startTs: typeof o.startTs === "number" ? o.startTs : undefined,
      partial: o.partial === true,
      cont: o.cont === true,
      midWord: o.midWord === true,
    });
  }
  return { lines, events };
}

/**
 * Repair a timeline whose timestamps restarted part-way through one file.
 *
 * Two causes, one symptom. A capture that restarted at its duration limit resumes BOTH
 * channels from zero. A transcription socket that reconnected restarted ONE channel's
 * clock (captures recorded before the reconnect fix took each token's time from the
 * current socket), while the other channel kept counting — measured on a two-hour call:
 * 155 backward jumps on the mic channel alone, and the stitched transcript squeezed two
 * hours into four minutes with both channels interleaved out of order.
 *
 * So the repair is PER CHANNEL: when a channel's clock jumps back, that channel continues
 * from the latest point the whole file has reached so far (file order is recording order).
 * A row without a speaker (a `silence` event) is placed at that point and never moves it:
 * it carries whichever channel's raw clock produced it, and letting it drive the timeline
 * stacked every later segment on top of a stale clock (measured: a two-hour call stretched
 * to seven). The first repair is reported as the break; later ones are counted.
 *
 * Needed for the existing archives regardless of whether either cause goes away.
 */
export function applyRotationOffset<T extends { ts: number; startTs?: number; seq?: number; speaker?: string }>(
  rows: T[],
): { rows: T[]; rotationAt: number | null; rotationSeq: number; repairs: number; repairsBy: Map<string, number> } {
  const rawMax = new Map<string, number>();
  const offset = new Map<string, number>();
  let maxAdj = 0;
  let rotationAt: number | null = null;
  let rotationSeq = 0;
  let repairs = 0;
  const repairsBy = new Map<string, number>();
  const out: T[] = [];
  for (const o of rows) {
    const key = o.speaker ?? "";
    if (!key) {
      out.push({ ...o, ts: maxAdj || o.ts, startTs: o.startTs != null ? maxAdj || o.startTs : undefined });
      continue;
    }
    const prevRaw = rawMax.get(key);
    if (prevRaw != null && o.ts < prevRaw - ROTATION_GAP_MS) {
      offset.set(key, maxAdj);
      rawMax.set(key, o.ts);
      repairs++;
      repairsBy.set(key, (repairsBy.get(key) ?? 0) + 1);
      if (rotationAt == null) {
        rotationAt = maxAdj;
        // The break belongs to the FIRST row of the new segment: its timestamp ties with
        // the last row of the old one, so only file order puts the marker between them.
        rotationSeq = o.seq ?? 0;
      }
    } else {
      rawMax.set(key, Math.max(prevRaw ?? 0, o.ts));
    }
    const off = offset.get(key) ?? 0;
    const row = { ...o, ts: o.ts + off, startTs: o.startTs != null ? o.startTs + off : undefined };
    maxAdj = Math.max(maxAdj, row.ts);
    out.push(row);
  }
  for (const o of rows) if (o.speaker && !repairsBy.has(o.speaker)) repairsBy.set(o.speaker, 0);
  return { rows: out, rotationAt, rotationSeq, repairs, repairsBy };
}

interface JoinStats {
  exact: number;
  guessed: number;
  healed: number;
}

const startsWord = (s: string): boolean => !/^\p{Ll}/u.test(s);
const endsInLetter = (s: string): boolean => /\p{L}$/u.test(s);
const bareWord = (w: string): string => w.replace(/^[.,?!…]+|[.,?!…]+$/gu, "").toLowerCase();

/**
 * The separator between two consecutive fragments of the SAME channel.
 *
 * `cont`/`midWord` are the authority when present — Soniox marks a word boundary with a
 * leading space, and the flush trims it, so the capture recording that fact at token time
 * is the only surviving evidence. Everything else is a recording made before those fields
 * existed, where the answer has to be inferred.
 *
 * The inference is deliberately biased toward a SPACE: an unnecessary space is a cosmetic
 * error, while wrongly glued words destroy two words and any search for either of them.
 * It glues only when all four hold — the previous part ends in a letter, the next starts
 * lowercase, the pause was short, and neither adjoining word stands complete on its own.
 */
export function separator(
  prevText: string,
  seg: StitchLine,
  gapMs: number | null,
  stats: JoinStats,
  opts: { completeWords: Set<string>; pauseGapMs: number },
): string {
  const t = seg.text.trim();
  if (!prevText || !t) return "";
  // A fragment that is nothing but punctuation belongs to the preceding word.
  if (/^[.,?!…-]+$/u.test(t)) return "";

  if (seg.cont) {
    stats.exact++;
    return seg.midWord ? "" : " ";
  }

  // Structurally certain, not a guess: only a lowercase letter following a letter can be
  // the second half of one word.
  if (!endsInLetter(prevText) || startsWord(t)) return " ";

  stats.guessed++;
  if (gapMs != null && gapMs >= opts.pauseGapMs) return " ";
  const prevWord = bareWord(prevText.split(/\s+/u).pop() ?? "");
  const nextWord = bareWord(t.split(/\s+/u)[0] ?? "");
  if (opts.completeWords.has(prevWord) || opts.completeWords.has(nextWord)) return " ";
  stats.healed++;
  return "";
}

/** Where a given text position falls on the timeline. */
interface Mark {
  pos: number;
  ts: number;
  endTs: number;
  seq: number;
}

export interface RebuiltChannel {
  text: string;
  marks: Mark[];
  /** Text positions at which the separator had to be guessed */
  guessedAt: number[];
}

/** Concatenate one channel's fragments into continuous text, keeping a position→time map. */
export function rebuildChannel(
  rows: StitchLine[],
  speaker: string,
  stats: JoinStats,
  opts: { completeWords: Set<string>; pauseGapMs: number },
): RebuiltChannel {
  const segs = rows.filter((o) => o.speaker === speaker);
  let text = "";
  const marks: Mark[] = [];
  const guessedAt: number[] = [];
  let prevTs: number | null = null;
  for (const seg of segs) {
    const t = seg.text.trim();
    if (!t) continue;
    const gap = prevTs == null ? null : seg.ts - prevTs;
    const before = stats.guessed;
    text += separator(text, seg, gap, stats, opts);
    if (stats.guessed > before) guessedAt.push(text.length);
    marks.push({ pos: text.length, ts: seg.startTs ?? seg.ts, endTs: seg.ts, seq: seg.seq ?? 0 });
    text += t;
    prevTs = seg.ts;
  }
  return { text, marks, guessedAt };
}

function tsAt(marks: Mark[], pos: number, field: "ts" | "endTs" | "seq"): number {
  let best = marks[0]?.[field] ?? 0;
  for (const m of marks) {
    if (m.pos <= pos) best = m[field];
    else break;
  }
  return best;
}

/**
 * Does the text after a terminator continue the SAME sentence?
 *
 * The flush boundaries are not the only thing that fragments a transcript: the recognizer
 * also drops a period mid-utterance ("…dehogy. ma már volt egy sessionünk"). Splitting on
 * those leaves the reader with the same fragments the stitch exists to remove — measured
 * on a real post-fix recording, they were 30% of all sentences, and rejoining them is what
 * takes the stitch from a 4-point improvement to a real one.
 *
 * A sentence in a cased script starts with a capital, a digit, or a quote — never a
 * lowercase letter. The test is `\p{Ll}` specifically, NOT "not uppercase": Chinese,
 * Japanese and Thai have no case at all (`\p{Lo}`), and a "not uppercase" rule would merge
 * an entire transcript in those languages into one sentence.
 *
 * The terminator itself is kept in the text — this changes where a sentence is CUT, never
 * what it says.
 */
function resumesLowercase(text: string, from: number): boolean {
  let p = from;
  while (p < text.length && /\s/u.test(text[p]!)) p++;
  return p < text.length && /\p{Ll}/u.test(text[p]!);
}

/** Split a rebuilt channel into sentences, each carrying its own start/end timestamps. */
export function splitSentences(channel: RebuiltChannel, speaker: string): StitchedSentence[] {
  const { text, marks, guessedAt } = channel;
  const out: StitchedSentence[] = [];

  // A sentence's start must be read at its first NON-whitespace character: the space
  // after terminal punctuation still belongs to the PREVIOUS fragment, so reading the
  // timestamp there would give the sentence the previous utterance's start time.
  const firstWordPos = (from: number): number => {
    let p = from;
    while (p < text.length && /\s/u.test(text[p]!)) p++;
    return p;
  };
  const push = (from: number, to: number): void => {
    const s = text.slice(from, to).trim();
    if (!s) return;
    out.push({
      speaker,
      text: s,
      startTs: tsAt(marks, firstWordPos(from), "ts"),
      endTs: tsAt(marks, Math.max(from, to - 1), "endTs"),
      seq: tsAt(marks, firstWordPos(from), "seq"),
      exact: !guessedAt.some((p) => p > from && p < to),
    });
  };

  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const nextIsBoundary = i + 1 >= text.length || /\s/u.test(text[i + 1]!);
    const merged = i + 1 - start > MAX_MERGED_SENTENCE;
    if (SENTENCE_END.test(text[i]!) && nextIsBoundary && (merged || !resumesLowercase(text, i + 1))) {
      push(start, i + 1);
      start = i + 1;
    }
  }
  // Whatever is left over: a capture stopped mid-utterance still said it.
  push(start, text.length);
  return out;
}

/** Mark sentences whose span intersects a sentence from another channel. */
export function markOverlaps(sentences: StitchedSentence[]): StitchedSentence[] {
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i]!;
    const lo = Math.max(0, i - OVERLAP_WINDOW);
    const hi = Math.min(sentences.length, i + OVERLAP_WINDOW + 1);
    for (let j = lo; j < hi; j++) {
      const o = sentences[j]!;
      if (j !== i && o.speaker !== s.speaker && o.startTs < s.endTs && o.endTs > s.startTs) {
        s.overlap = true;
        break;
      }
    }
  }
  return sentences;
}

export const hhmmss = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
};

/** One position on the rendered timeline: a sentence, or a break in the recording. */
type StreamItem =
  | { kind: "sentence"; ts: number; seq: number; sentence: StitchedSentence }
  | { kind: "rotation"; ts: number; seq: number }
  | { kind: "reconnect"; ts: number; seq: number; event: StitchEvent };

/**
 * Merge sentences and timeline events into ONE ordered stream, so the markdown and the
 * structured output can never disagree about what happened when.
 */
function buildStream(
  sentences: StitchedSentence[],
  events: StitchEvent[],
  rotation: { at: number | null; seq: number },
): StreamItem[] {
  const items: StreamItem[] = sentences.map((sentence) => ({
    kind: "sentence" as const,
    ts: sentence.startTs,
    seq: sentence.seq ?? 0,
    sentence,
  }));
  for (const event of events) {
    items.push({ kind: "reconnect", ts: event.ts, seq: event.seq ?? 0, event });
  }
  if (rotation.at != null) items.push({ kind: "rotation", ts: rotation.at, seq: rotation.seq });
  // Ties are broken by FILE order, not by kind. An event's `ts` is the last speech
  // before it, so it always ties with the sentence it follows — ranking events first
  // would print every break one turn too early, in front of the line it came after.
  return items.sort((a, b) => a.ts - b.ts || a.seq - b.seq);
}

function reconnectNote(e: StitchEvent): string {
  const hole = e.downtimeMs != null ? Math.max(0, e.downtimeMs - (e.replayedMs ?? 0)) : null;
  const who = e.speaker ? ` (${e.speaker})` : "";
  const gap =
    hole != null ? `${(hole / 1000).toFixed(1)}s not recovered` : "duration unknown";
  return `⚠ **[${hhmmss(e.ts)}] transcription dropped${who} — ${gap}. Words may be missing here.**`;
}

const ROTATION_NOTE =
  "🔄 **capture rotation.** The recording hit its duration limit and restarted; " +
  "the timestamps below are counted back onto the REAL timeline. There is no gap in the conversation.";

/**
 * The readable transcript: timestamped, speaker-labelled turns, with the things a flush
 * boundary destroyed put back and the things it could NOT recover marked rather than
 * smoothed over.
 */
export function renderMarkdown(
  stream: StreamItem[],
  opts: { speakers: Record<string, string>; redactions: RedactionWindow[] },
): string {
  const lines: string[] = [];
  let activeRedaction: RedactionWindow | null = null;
  for (const item of stream) {
    if (item.kind === "rotation") {
      lines.push(`> ${ROTATION_NOTE}`);
      continue;
    }
    if (item.kind === "reconnect") {
      lines.push(`> ${reconnectNote(item.event)}`);
      continue;
    }
    const s = item.sentence;
    const red = opts.redactions.find((r) => s.startTs >= r.from && s.startTs <= r.to);
    if (red) {
      // One marker per window, not per sentence — but the marker is never omitted: a
      // reader must see that something was cut, and why.
      if (red !== activeRedaction) {
        lines.push(`> ⏹ **[${hhmmss(red.from)}–${hhmmss(red.to)}] cut:** ${red.reason}`);
        activeRedaction = red;
      }
      continue;
    }
    activeRedaction = null;
    const who = opts.speakers[s.speaker] ?? s.speaker;
    lines.push(`**[${hhmmss(s.startTs)}] ${who}${s.overlap ? " ⇄" : ""}:** ${s.text}`);
  }
  return lines.join("\n\n") + "\n";
}

/**
 * The reassembled text and nothing else (dictation-output).
 *
 * A dictation's output is not a document to read later — it is the user's **message**, and
 * whatever surrounds the words gets read as part of it. `renderMarkdown`'s
 * `**[00:00:11] mic:**` prefixes are meeting furniture; here a timestamp would arrive as
 * part of the instruction. So: sentences, one space between them, nothing else.
 *
 * A renderer over the SAME stream as the other two, deliberately — never a second
 * reassembly path. The word-boundary logic (`cont`/`midWord`) has exactly one
 * implementation, so the dictation and meeting outputs can never disagree about where a
 * word begins, which is the whole failure this exists to end.
 *
 * Non-sentence items produce nothing: a rotation note or a reconnect warning is a fact
 * about the recording, not something the speaker said. A redacted window is skipped
 * without a marker for the same reason (and the dictation path passes no redactions at
 * all) — a `⏹ cut` line in the middle of an instruction is contamination, and the marker's
 * purpose, telling a *reader* something was removed, does not apply to a message being
 * acted on.
 *
 * Sentences join with a single space: a dictation is one continuous utterance, and
 * paragraph structure is not something the transcript knows.
 */
export function renderPlain(
  stream: StreamItem[],
  opts: { redactions?: RedactionWindow[] } = {},
): string {
  const redactions = opts.redactions ?? [];
  const parts: string[] = [];
  for (const item of stream) {
    if (item.kind !== "sentence") continue;
    const s = item.sentence;
    if (redactions.some((r) => s.startTs >= r.from && s.startTs <= r.to)) continue;
    const text = s.text.trim();
    if (text) parts.push(text);
  }
  return parts.join(" ");
}

/**
 * The structured transcript: one sentence per line, so a tool never has to parse the
 * markdown — and so a transcript archived months ago stays machine-readable without
 * re-running the stitch.
 */
export function renderJsonl(
  stream: StreamItem[],
  opts: { redactions: RedactionWindow[] },
): string {
  const out: string[] = [];
  let activeRedaction: RedactionWindow | null = null;
  for (const item of stream) {
    if (item.kind === "rotation") {
      out.push(JSON.stringify({ type: "rotation", ts: item.ts }));
      continue;
    }
    if (item.kind === "reconnect") {
      const e = item.event;
      out.push(
        JSON.stringify({
          type: "reconnect",
          ts: e.ts,
          speaker: e.speaker,
          downtimeMs: e.downtimeMs,
          replayedMs: e.replayedMs,
        }),
      );
      continue;
    }
    const s = item.sentence;
    const red = opts.redactions.find((r) => s.startTs >= r.from && s.startTs <= r.to);
    if (red) {
      if (red !== activeRedaction) {
        out.push(JSON.stringify({ type: "redacted", from: red.from, to: red.to, reason: red.reason }));
        activeRedaction = red;
      }
      continue;
    }
    activeRedaction = null;
    out.push(
      JSON.stringify({
        speaker: s.speaker,
        text: s.text,
        startTs: s.startTs,
        endTs: s.endTs,
        ...(s.overlap ? { overlap: true } : {}),
        exact: s.exact,
      }),
    );
  }
  return out.length ? out.join("\n") + "\n" : "";
}

/**
 * Stitch a parsed transcript into its readable and structured forms.
 *
 * Returns `null` when there is nothing to stitch — an empty or event-only transcript.
 * The caller must not write zero-byte artifacts, mirroring the handover's no-op on an
 * empty transcript.
 */
export function stitchTranscript(
  input: { lines: StitchLine[]; events: StitchEvent[] },
  opts: StitchOptions = {},
): StitchResult | null {
  if (!input.lines.length) return null;

  const completeWords = new Set((opts.completeWords ?? []).map((w) => w.toLowerCase()));
  const pauseGapMs = opts.pauseGapMs ?? 2500;
  const redactions = opts.redactions ?? [];

  // The rotation offset has to be applied to speech and events TOGETHER, from one
  // reading of the timeline — offsetting them separately would put a reconnect warning
  // on the wrong side of the break.
  //
  // Ordered by `seq` (file order), NEVER by `ts`: the transcript is append-only, so file
  // order is recording order — and after a rotation the timestamps restart, so sorting on
  // them would sort the backwards jump away and the rotation would go undetected.
  const tagged = [
    ...input.lines.map((l) => ({ ...l, _event: null as StitchEvent | null })),
    ...input.events.map((e) => ({
      seq: e.seq,
      ts: e.ts,
      speaker: e.speaker ?? "",
      text: "",
      startTs: undefined as number | undefined,
      _event: e,
    })),
  ].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  const repaired = applyRotationOffset(tagged);
  const { rotationAt, rotationSeq, repairs } = repaired;
  const channelCount = repaired.repairsBy.size;
  // A whole-capture rotation restarts every channel once. Anything beyond that is a
  // clock that cannot be trusted (see applyRotationOffset), so the output falls back to
  // recording order with times read off the steadiest channel.
  const unreliable = repairs > Math.max(1, channelCount);
  const shifted = unreliable ? retime(tagged, repaired.repairsBy) : repaired.rows;
  const lines = shifted.filter((r) => !r._event) as StitchLine[];
  const events = shifted
    .filter((r) => r._event)
    .map((r) => ({ ...r._event!, ts: r.ts }));

  const stats: JoinStats = { exact: 0, guessed: 0, healed: 0 };
  // Whatever channels the recording actually has — mic-only dictation is the common case,
  // and a future third channel needs no change here.
  const speakers = [...new Set(lines.map((l) => l.speaker))].sort();
  const rebuilt = speakers
    .flatMap((sp) => splitSentences(rebuildChannel(lines, sp, stats, { completeWords, pauseGapMs }), sp));
  const sentences = unreliable
    // Recording order; no overlap marks — they would be read off the same broken clocks.
    ? rebuilt.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
    : markOverlaps(
        // Speaking order, NOT completion order: with two channels a long utterance
        // completes after several short ones from the other side.
        rebuilt.sort((a, b) => a.startTs - b.startTs || a.speaker.localeCompare(b.speaker)),
      );

  if (!sentences.length) return null;

  const stream = buildStream(sentences, events, { at: unreliable ? null : rotationAt, seq: rotationSeq });
  const markdown = renderMarkdown(stream, { speakers: opts.speakers ?? {}, redactions });
  return {
    markdown: unreliable ? `${unreliableNote(repairs)}\n\n${markdown}` : markdown,
    jsonl: renderJsonl(stream, { redactions }),
    plain: renderPlain(stream, { redactions }),
    sentences,
    stats: {
      segments: lines.length,
      sentences: sentences.length,
      exact: stats.exact,
      guessed: stats.guessed,
      healed: stats.healed,
      rotated: rotationAt != null,
      clockRepairs: repairs,
    },
  };
}

/**
 * Times for a recording whose clocks cannot be trusted: every row keeps its place in the
 * file and takes the time the steadiest channel (fewest restarts) had reached by then.
 * Approximate by construction — the note in the output says so — but monotonic, and on
 * the measured two-hour call within minutes of the real length, where the per-channel
 * repair alone stretched it to seven hours.
 */
function retime<T extends { ts: number; startTs?: number; seq?: number; speaker?: string }>(
  rows: T[],
  repairsBy: Map<string, number>,
): T[] {
  let ref = "";
  let fewest = Infinity;
  for (const [sp, n] of repairsBy) if (n < fewest) { fewest = n; ref = sp; }
  // The reference channel's own segments laid end to end: when its raw clock restarts,
  // it continues from where it had got to — never from another channel's (faster) clock.
  let clock = rows.find((r) => r.speaker === ref)?.ts ?? 0;
  let rawPrev: number | null = null;
  let base = 0;
  return rows.map((r) => {
    if (r.speaker === ref) {
      if (rawPrev != null && r.ts < rawPrev - ROTATION_GAP_MS) base = clock - r.ts;
      rawPrev = r.ts < (rawPrev ?? 0) - ROTATION_GAP_MS ? r.ts : Math.max(rawPrev ?? r.ts, r.ts);
      clock = Math.max(clock, base + r.ts);
    }
    return { ...r, ts: clock, startTs: r.startTs != null ? clock : undefined };
  });
}

function unreliableNote(repairs: number): string {
  return (
    `> ⚠ **Timeline repaired.** The transcription clocks restarted ${repairs} times in this ` +
    "recording (reconnects), so the lines are in RECORDING order and the times are approximate."
  );
}

/** Convenience: raw file contents → artifacts. */
export function stitchText(text: string, opts: StitchOptions = {}): StitchResult | null {
  return stitchTranscript(parseLines(text), opts);
}
