/**
 * The mirror's formatting half — block structure, fencing, and chunking.
 *
 * Everything here is pure and line-based, and it deliberately agrees with the wall's own
 * block scanner (`src/wall/public/text-format.mjs`): this module decides WHERE a message may
 * be divided, and the wall decides how each piece renders. If the two disagreed about where
 * a table ends, a chunk boundary could land inside one — which is the failure this exists to
 * prevent, because a half table renders as debris and an unterminated fence swallows the
 * rest of the box.
 *
 * Two rules are load-bearing:
 *
 * 1. **Length control divides a message; it never deletes the end of it.** Measured on
 *    2026-07-29: the operator's nine-item field report was 2143 characters and the policy
 *    returned 641 — one item of nine, cut mid-sentence. So the budget is a *chunk size*,
 *    not a ceiling: the scrolling box accumulates consecutive chunks. Only a single block
 *    that alone exceeds the budget is cut, and it says so.
 *
 * 2. **Monospace-dependent content is fenced HERE, not by asking the copilot to fence it.**
 *    The field test's ASCII table arrived unfenced and rendered proportional — the copilot
 *    was working around a code-block stripping the config no longer performs. Replacing one
 *    piece of prompt discipline with another would reproduce the failure the follower exists
 *    to end, so the delivery path does it mechanically, every time.
 */

/** What a line-run is, for the purpose of never cutting through it. */
export type BlockKind = "blank" | "fence" | "table" | "list" | "heading" | "paragraph";

export interface Block {
  kind: BlockKind;
  lines: string[];
}

// The same recognizers the wall's scanner uses, deliberately duplicated rather than shared:
// that module is browser-side ESM with no types, and a boundary disagreement is caught by
// the tests that feed both. Keep them in sync.
const FENCE = /^\s*```(.*)$/;
const BULLET = /^\s*[-*]\s+/;
const NUMBER = /^\s*\d+[.)]\s+/;
const HEADING = /^\s{0,3}#{1,6}\s+\S/;
const SEPARATOR_CELL = /^:?-{1,}:?$/;

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

/** Is `line` a pipe row whose successor is a matching separator row? (i.e. a real table head) */
function startsTable(line: string, next: string | undefined): boolean {
  if (next === undefined || !line.includes("|")) return false;
  const header = splitRow(line);
  const sep = splitRow(next);
  return header.length > 1 && sep.length === header.length && sep.every((c) => SEPARATOR_CELL.test(c));
}

/**
 * Split text into blocks, preserving every line — `blocks.flatMap(b => b.lines).join("\n")`
 * is the input, byte for byte. Blank runs are their own blocks so a chunk can be reassembled
 * without inventing or losing separators.
 *
 * An UNTERMINATED fence degrades to paragraph lines, matching the wall: treating it as a
 * fence would let it swallow everything after it.
 */
export function splitBlocks(text: string): Block[] {
  const lines = (text ?? "").split("\n");
  const out: Block[] = [];
  let para: string[] = [];

  const flushPara = (): void => {
    if (para.length) { out.push({ kind: "paragraph", lines: para }); para = []; }
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (FENCE.test(line)) {
      let close = -1;
      for (let j = i + 1; j < lines.length; j++) {
        if (FENCE.test(lines[j])) { close = j; break; }
      }
      if (close > i) {
        flushPara();
        out.push({ kind: "fence", lines: lines.slice(i, close + 1) });
        i = close + 1;
        continue;
      }
      para.push(line); // unterminated — literal, like the wall
      i++;
      continue;
    }

    if (startsTable(line, lines[i + 1])) {
      flushPara();
      const block = [line, lines[i + 1]];
      let j = i + 2;
      for (; j < lines.length; j++) {
        if (!lines[j].includes("|") || !lines[j].trim()) break;
        block.push(lines[j]);
      }
      out.push({ kind: "table", lines: block });
      i = j;
      continue;
    }

    const isBullet = BULLET.test(line);
    if (isBullet || NUMBER.test(line)) {
      const re = isBullet ? BULLET : NUMBER;
      flushPara();
      const block: string[] = [];
      let j = i;
      for (; j < lines.length && re.test(lines[j]); j++) block.push(lines[j]);
      out.push({ kind: "list", lines: block });
      i = j;
      continue;
    }

    if (HEADING.test(line)) {
      flushPara();
      out.push({ kind: "heading", lines: [line] });
      i++;
      continue;
    }

    if (!line.trim()) {
      flushPara();
      const block: string[] = [];
      let j = i;
      for (; j < lines.length && !lines[j].trim(); j++) block.push(lines[j]);
      out.push({ kind: "blank", lines: block });
      i = j;
      continue;
    }

    para.push(line);
    i++;
  }
  flushPara();
  return out;
}

/** Box-drawing + block-element ranges — the unmistakable signature of a character-drawn table. */
const BOX_DRAWING = /[─-╿▀-▟]/;

/**
 * Do these lines share column positions? Requires at least one interior gap of two or more
 * spaces at the SAME index in EVERY line, with content on both sides of it in every line.
 *
 * Deliberately strict: prose wraps at different points, so an accidental match needs three
 * lines to coincide twice over. The bias is still toward fencing — an unnecessary monospace
 * paragraph is cosmetic, an unreadable table in front of a room is the failure being fixed.
 */
export function hasAlignedColumns(lines: string[]): boolean {
  if (lines.length < 3) return false;
  const min = Math.min(...lines.map((l) => l.length));
  if (min < 4) return false;
  for (let i = 1; i < min - 2; i++) {
    const gap = lines.every((l) => /\s/.test(l[i]) && /\s/.test(l[i + 1]));
    if (!gap) continue;
    const before = lines.every((l) => /\S/.test(l.slice(0, i)));
    const after = lines.every((l) => /\S/.test(l.slice(i + 2)));
    if (before && after) return true;
  }
  return false;
}

/** Would this paragraph block become unreadable in a proportional font? */
function needsMonospace(block: Block): boolean {
  if (block.kind !== "paragraph") return false;
  if (block.lines.some((l) => BOX_DRAWING.test(l))) return true;
  return hasAlignedColumns(block.lines);
}

/**
 * Wrap alignment-dependent paragraph blocks in a code fence so the wall renders them
 * monospace. Already-fenced content, prose, lists, headings and markdown tables are
 * untouched — fencing applies only where column positions carry meaning.
 */
export function fenceAlignedBlocks(text: string): string {
  const blocks = splitBlocks(text);
  if (!blocks.some(needsMonospace)) return text; // byte-identical when there is nothing to do
  const out: string[] = [];
  for (const b of blocks) {
    if (needsMonospace(b)) out.push("```", ...b.lines, "```");
    else out.push(...b.lines);
  }
  return out.join("\n");
}

/** Appended to a block that had to be cut because it alone exceeded the budget. */
export const CUT_MARKER = "… [levágva]";

const blockLength = (b: Block): number => b.lines.join("\n").length;

/**
 * Cut one oversized block to `budget`, marking it — and closing its fence if it is a code
 * block, because an unterminated fence swallows the rest of the wall box.
 */
function cutBlock(b: Block, budget: number): string {
  const text = b.lines.join("\n");
  const closing = b.kind === "fence" ? "\n```" : "";
  const room = Math.max(1, budget - CUT_MARKER.length - closing.length - 1);
  return `${text.slice(0, room)}\n${CUT_MARKER}${closing}`;
}

/**
 * Divide a message into chunks of whole blocks, each within `budget`.
 *
 * A message that already fits comes back as ONE byte-identical chunk — chunking must be
 * invisible until it is needed. Leading and trailing blank blocks are dropped per chunk, so
 * a boundary does not produce an empty-looking wall line.
 */
export function chunkBlocks(text: string, budget: number): string[] {
  if (!text) return [];
  if (text.length <= budget) return [text];

  const blocks = splitBlocks(text);
  const chunks: string[] = [];
  let current: Block[] = [];

  const flush = (): void => {
    while (current.length && current[0].kind === "blank") current.shift();
    while (current.length && current[current.length - 1].kind === "blank") current.pop();
    if (!current.length) { current = []; return; }
    const joined = current.flatMap((b) => b.lines).join("\n");
    if (joined.trim()) chunks.push(joined);
    current = [];
  };
  const currentLength = (): number =>
    current.length ? current.flatMap((b) => b.lines).join("\n").length : 0;

  for (const b of blocks) {
    if (b.kind === "blank") { if (current.length) current.push(b); continue; }

    if (blockLength(b) > budget) {
      // A single block bigger than the budget: emit what is buffered, then the cut block on
      // its own, so the cut never takes neighbouring blocks with it.
      flush();
      chunks.push(cutBlock(b, budget));
      continue;
    }
    // +1 for the newline that would join it to what is buffered.
    if (current.length && currentLength() + 1 + blockLength(b) > budget) flush();
    current.push(b);
  }
  flush();
  return chunks;
}
