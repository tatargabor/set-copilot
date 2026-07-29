/**
 * The wall's `text` formatter — the pure half.
 *
 * A wall text line used to render with a single `textContent` assignment, so a Claude Code
 * message arrived on the wall with everything that carried its meaning destroyed: a
 * markdown table became run-on text, a list became one undifferentiated blob. This turns
 * the line's string into a small structured tree that the client builds elements from.
 *
 * Three properties are load-bearing, and each is a spec requirement rather than an
 * implementation detail:
 *
 * 1. **The vocabulary is CLOSED** — bold, italic, inline code, fenced code block, bullet
 *    list, numbered list, table. Nothing else. Closed in the same sense as `RenderType`:
 *    extending it is an engine change, never a config one. Anything outside the set is
 *    literal text, which is also what every malformed construct degrades to.
 *
 * 2. **There is no raw/HTML node type.** That absence is the safety invariant, not a
 *    consequence of it: the builder cannot pass markup through because this union gives it
 *    nothing to pass through. Escaping is a property one careless edit can lose; having no
 *    markup path at all is a property you have to work to lose. Do not add a "raw" variant.
 *
 * 3. **The payload stays a plain string.** Formatting is derived at render time, so the
 *    event schema, every existing producer, the server-side redaction funnel (which walks
 *    one string leaf *before* any of this exists), and the accumulated-state replay are all
 *    untouched.
 *
 * Deliberate omission: `_underscore_` is NOT italic. Only `*asterisk*` is. A coding
 * copilot's message is full of `snake_case` identifiers and file names, and turning half of
 * one into italics is a worse failure than not italicizing an underscore someone meant.
 */

// ---- the closed node union --------------------------------------------------

/**
 * @typedef {{type:"text",value:string}
 *   | {type:"bold",children:Inline[]}
 *   | {type:"italic",children:Inline[]}
 *   | {type:"code",value:string}} Inline
 *
 * @typedef {"left"|"center"|"right"} CellAlign
 *
 * @typedef {{type:"paragraph",children:Inline[]}
 *   | {type:"codeblock",lang:string,value:string}
 *   | {type:"bullets",items:Inline[][]}
 *   | {type:"numbers",items:Inline[][]}
 *   | {type:"table",header:Inline[][],rows:Inline[][][],align:CellAlign[]}} Block
 */

/**
 * Every node type this module can emit. Exported so a test can assert the union carries no
 * raw/HTML variant — the structural guarantee behind the "never as markup" invariant.
 */
export const NODE_TYPES = [
  "text", "bold", "italic", "code",
  "paragraph", "codeblock", "bullets", "numbers", "table",
];

// ---- inline scanner ---------------------------------------------------------

/** Append text to the last node when it is text, so the tree carries no adjacent text runs. */
function pushText(out, value) {
  if (!value) return;
  const last = out[out.length - 1];
  if (last && last.type === "text") last.value += value;
  else out.push({ type: "text", value });
}

/**
 * Parse the inline vocabulary. An unclosed delimiter is literal — the delimiter character
 * is emitted as text and scanning continues after it, so the rest of the line still parses.
 */
export function parseInline(s) {
  const out = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];

    // Inline code binds tightest: whatever is between backticks is literal, including
    // characters that would otherwise be emphasis delimiters.
    if (ch === "`") {
      const end = s.indexOf("`", i + 1);
      if (end > i + 1) {
        out.push({ type: "code", value: s.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
      pushText(out, ch);
      i++;
      continue;
    }

    if (ch === "*") {
      const bold = s.startsWith("**", i);
      const marker = bold ? "**" : "*";
      const end = s.indexOf(marker, i + marker.length);
      // An empty span (`**` / `**`) is not emphasis — it is two literal asterisks.
      if (end > i + marker.length) {
        const inner = s.slice(i + marker.length, end);
        out.push({ type: bold ? "bold" : "italic", children: parseInline(inner) });
        i = end + marker.length;
        continue;
      }
      pushText(out, marker);
      i += marker.length;
      continue;
    }

    pushText(out, ch);
    i++;
  }
  return out;
}

// ---- block scanner ----------------------------------------------------------

const FENCE = /^\s*```(.*)$/;
const BULLET = /^\s*[-*]\s+(.*)$/;
const NUMBER = /^\s*\d+[.)]\s+(.*)$/;

/** A table separator row: `| --- | :--: |` — the line that makes a pipe row a table. */
const SEPARATOR_CELL = /^:?-{1,}:?$/;

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

function alignOf(cell) {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  return left && right ? "center" : right ? "right" : "left";
}

/** Emit the buffered paragraph lines as one paragraph block (newlines preserved). */
function flushParagraph(para, out) {
  if (!para.length) return;
  out.push({ type: "paragraph", children: parseInline(para.join("\n")) });
  para.length = 0;
}

/**
 * Turn a wall text line into blocks.
 *
 * Never throws: every malformed construct (unterminated fence, truncated table, unclosed
 * emphasis, a header/separator mismatch) degrades to literal text for the region it
 * affects while the surrounding content still parses. "Degrades to literal" is a spec
 * requirement, not a fallback — there is no error state on a wall.
 */
export function parseWallText(s) {
  const lines = (s ?? "").split("\n");
  const out = [];
  const para = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block. An UNTERMINATED fence is not a code block — treating it as one
    // would swallow the rest of the message, so the fence line stays literal and the
    // following lines are re-scanned normally.
    const fence = FENCE.exec(line);
    if (fence) {
      let close = -1;
      for (let j = i + 1; j < lines.length; j++) {
        if (FENCE.test(lines[j])) { close = j; break; }
      }
      if (close > i) {
        flushParagraph(para, out);
        out.push({ type: "codeblock", lang: fence[1].trim(), value: lines.slice(i + 1, close).join("\n") });
        i = close + 1;
        continue;
      }
      para.push(line);
      i++;
      continue;
    }

    // Table: a pipe row followed by a separator row with the SAME cell count. A mismatch
    // means this is not a table (or is a truncated one) — both stay literal.
    if (line.includes("|") && i + 1 < lines.length) {
      const header = splitRow(line);
      const sep = splitRow(lines[i + 1]);
      if (
        header.length > 1 && sep.length === header.length
        && sep.every((c) => SEPARATOR_CELL.test(c))
      ) {
        const rows = [];
        let j = i + 2;
        for (; j < lines.length; j++) {
          const row = lines[j];
          if (!row.includes("|") || !row.trim()) break;
          // Ragged rows are padded/truncated to the header width rather than rejected: a
          // mirrored message is often mid-stream, and a readable table beats no table.
          const cells = splitRow(row);
          while (cells.length < header.length) cells.push("");
          rows.push(cells.slice(0, header.length).map(parseInline));
        }
        flushParagraph(para, out);
        out.push({
          type: "table",
          header: header.map(parseInline),
          rows,
          align: sep.map(alignOf),
        });
        i = j;
        continue;
      }
    }

    // Bullet / numbered list: a run of consecutive matching lines is ONE list block, so a
    // list occupies one wall line rather than competing with the surrounding stream.
    const bullet = BULLET.exec(line);
    const number = NUMBER.exec(line);
    if (bullet || number) {
      const re = bullet ? BULLET : NUMBER;
      const items = [];
      let j = i;
      for (; j < lines.length; j++) {
        const m = re.exec(lines[j]);
        if (!m) break;
        items.push(parseInline(m[1]));
      }
      flushParagraph(para, out);
      out.push({ type: bullet ? "bullets" : "numbers", items });
      i = j;
      continue;
    }

    if (!line.trim()) { flushParagraph(para, out); i++; continue; }

    para.push(line);
    i++;
  }

  flushParagraph(para, out);
  return out;
}
