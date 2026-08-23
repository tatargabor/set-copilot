/**
 * A presentation as a knowledge source.
 *
 * The copilot could not tell a presenter they had just contradicted their own slide,
 * because the deck was never in its knowledge: `knowledge.sources` resolves `.md` only.
 * Measured across three real-time runs of one scenario, exactly one planted trap was
 * missed every single time — a spoken figure that disagreed with the deck's figure, which
 * nobody in the room corrected.
 *
 * Three things here are deliberate.
 *
 * **Slides, not pages.** A slide carries its position and title because the *citation* is
 * the useful part: "the knowledge base says 21.8" cannot be acted on mid-meeting, and
 * "slide 11 (ASP három állapot) says 21,8 milliárd" can.
 *
 * **Numbers are pulled out, not left in prose.** A presenter's contradiction against their
 * own deck is overwhelmingly a figure. Asking the copilot to re-read a whole deck per
 * utterance is asking it to do, live, the expensive thing the digest exists to avoid.
 *
 * **This is a shape matcher, not a parser**, and it over-collects on purpose. A spurious
 * fact costs a line of digest; a missed one costs the alert this exists to produce. That is
 * the opposite direction from `wall/redaction.ts`, and for the same reason: there a mistake
 * publishes something, here a mistake stays silent — and silence is indistinguishable from
 * a meeting where nothing was worth saying.
 */

import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";

/** One slide of a deck. `index` is 1-based deck order — what a citation names. */
export interface Slide {
  index: number;
  title: string;
  text: string;
  /** File the slide came from, for the inspection report. */
  source: string;
  /** The numeric claims this slide asserts. */
  facts: DeckFact[];
}

/** A numeric claim a slide makes, with enough context to recognise it in speech. */
export interface DeckFact {
  /** The figure as written, e.g. "21,8" — never normalised, because the deck's form is the citable one. */
  figure: string;
  /** Numeric value, decimal separator resolved. */
  value: number;
  /** Scale or unit word immediately following, e.g. "milliárd", "%", "óra". */
  unit?: string;
  /** Words around the figure that say what it refers to. */
  context: string;
  /** Slide this came from. */
  slideIndex: number;
  slideTitle: string;
}

/** Something a deck file failed to give us. Reported, never silent. */
export interface DeckProblem {
  file: string;
  reason: string;
}

export interface DeckExtraction {
  slides: Slide[];
  problems: DeckProblem[];
}

/**
 * At most this many facts per slide.
 *
 * The digest is loaded into every session, so one number-dense slide must not be able to
 * flood it. Facts are kept in slide order, so the cap drops the tail rather than sampling —
 * a slide's opening figures are the ones it is actually about.
 */
export const MAX_FACTS_PER_SLIDE = 12;

/**
 * Below this much text, an extraction from a real file is treated as a failure.
 *
 * A loader shell yields something like "Unpacking…" — long enough to pass an emptiness
 * check, short enough to be worthless, and indistinguishable from content to everything
 * downstream.
 */
export const MIN_SLIDE_CHARS = 60;

/** Words that scale or qualify a figure. Extended by config later if a project needs it. */
const UNIT_WORDS = [
  "milliárd", "millió", "ezer", "mrd", "m", "bn", "billion", "million", "thousand",
  "%", "százalék", "percent", "ft", "forint", "eur", "euró", "usd", "dollár",
  "óra", "hour", "nap", "day", "hét", "week", "hónap", "month", "év", "year",
  "fő", "db", "darab", "hely", "helyezés",
];

/**
 * Strip a static-export wrapper, if there is one.
 *
 * Some export tools ship a loader shell whose real document sits JSON-encoded inside a
 * `<script type="…/template">`. Extracting the shell yields its loading message — a deck
 * that "extracts" to "This page requires JavaScript to display", which is worse than an
 * error because it looks like content.
 */
export function unwrapBundlerTemplate(html: string): string {
  const m = /<script[^>]+type="[^"]*template"[^>]*>([\s\S]*?)<\/script>/i.exec(html);
  if (!m) return html;
  const raw = m[1].trim();
  if (!raw.startsWith('"')) return html;
  try {
    const inner = JSON.parse(raw) as unknown;
    // The test is "is this a document", NOT "is this a large fraction of the file". The
    // first version compared the template against the file size and failed on exactly the
    // slides that needed it: an export weighing 5.5 MB of embedded images carries an 11 KB
    // document, so the ratio guard rejected the real content and the slide extracted to
    // the shell's "Unpacking…" — twelve characters that look like content.
    if (typeof inner !== "string" || inner.length < 200) return html;
    return /<(html|body|div|section|main)\b/i.test(inner) ? inner : html;
  } catch {
    return html; // not a JSON string after all — treat the document as-is
  }
}

/** Visible text of an HTML document: no markup, scripts, styles, or embedded data URIs. */
export function htmlToText(html: string): string {
  let s = unwrapBundlerTemplate(html);
  // `<title>` and `<head>` metadata are NOT visible text. Leaving the title in the body
  // made every slide's first extracted "fact" its own slide number, because an exported
  // slide is titled `11 — ASP …`.
  s = s.replace(/<head[^>]*>[\s\S]*?<\/head>/gi, " ");
  s = s.replace(/<(script|style|title)[^>]*>[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/data:[^"')\s]{200,}/g, " ");
  s = s.replace(/<[^>]+>/g, "\n");
  s = s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
       .replace(/&quot;/g, '"').replace(/&#\d+;/g, " ");
  return s.split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
}

/** Title of an HTML document: its `<title>`, else its first heading. */
export function htmlTitle(html: string): string | null {
  const src = unwrapBundlerTemplate(html);
  const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(src);
  if (t && t[1].trim()) return t[1].trim();
  const h = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i.exec(src);
  if (h) {
    const text = h[1].replace(/<[^>]+>/g, " ").trim();
    if (text) return text;
  }
  return null;
}

/**
 * Deck order for a file: a leading number in its name, else Infinity.
 *
 * Decks are named `01-…`, `02-…` precisely because their order carries meaning. A file
 * with no leading number sorts after the numbered ones, keeping its configured order.
 */
export function fileOrder(path: string): number {
  const m = /^(\d+)/.exec(basename(path));
  return m ? parseInt(m[1], 10) : Number.POSITIVE_INFINITY;
}

const NUM = /(?<![\w.,])(\d{1,3}(?:[   ]\d{3})+|\d+(?:[.,]\d+)?)(?![\w])/g;

/** Parse a written figure into a number, accepting either decimal convention. */
export function parseFigure(raw: string): number | null {
  const cleaned = raw.replace(/[   ]/g, "");
  // A single comma or dot with 1–2 trailing digits is a decimal separator in one
  // convention or the other; anything else is a thousands group already removed above.
  const normalized = /^\d+[.,]\d{1,3}$/.test(cleaned) ? cleaned.replace(",", ".") : cleaned.replace(/[.,]/g, "");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/**
 * Numeric claims in a slide's text.
 *
 * Over-collects by design (D3): a page number or a version string becoming a "fact" costs
 * a digest line, while a missed figure costs the alert. The per-slide cap bounds the cost.
 */
export function extractFacts(text: string, slideIndex: number, slideTitle: string): DeckFact[] {
  const facts: DeckFact[] = [];
  const flat = text.replace(/\n+/g, " · ");
  for (const m of flat.matchAll(NUM)) {
    const figure = m[1];
    const value = parseFigure(figure);
    if (value === null) continue;
    const at = m.index ?? 0;
    // A figure with no letters immediately around it is a chart tick or a list marker — a
    // number the slide DISPLAYS, not a claim it MAKES. The window is deliberately narrow:
    // a wider one catches the axis LABEL and lets every tick through.
    const near = flat.slice(Math.max(0, at - 12), at + figure.length + 12);
    if (!/\p{L}/u.test(near.slice(0, 12) + near.slice(12 + figure.length))) continue;

    const after = flat.slice(at + figure.length, at + figure.length + 20).trim();
    const unitMatch = UNIT_WORDS.find((u) => after.toLowerCase().startsWith(u));
    const before = flat.slice(Math.max(0, at - 70), at).trim();
    const tail = flat.slice(at + figure.length, at + figure.length + 70).trim();
    facts.push({
      figure,
      value,
      unit: unitMatch,
      context: `${before} ⟨${figure}⟩ ${tail}`.replace(/\s+/g, " ").trim(),
      slideIndex,
      slideTitle,
    });
  }

  // RANK, then cap — do not cap in reading order. The harm of the cap is not that a
  // spurious fact survives, it is that the slide's actual claim gets pushed out by six
  // chart ticks that happened to appear first. A figure carrying a scale word is a claim
  // almost by construction; after that, the more words around a figure, the more likely it
  // is asserting something. Reading order breaks ties, so the ranking stays deterministic.
  return facts
    .map((f, i) => ({ f, i, score: (f.unit ? 1000 : 0) + (f.context.match(/\p{L}+/gu)?.length ?? 0) }))
    .sort((a, b) => (b.score - a.score) || (a.i - b.i))
    .slice(0, MAX_FACTS_PER_SLIDE)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.f);
}

/** Split markdown/plain text into slides on its headings. */
function markdownSlides(text: string, fallbackTitle: string): { title: string; text: string }[] {
  const lines = text.split("\n");
  const out: { title: string; text: string }[] = [];
  let title: string | null = null;
  let buf: string[] = [];
  const flush = (): void => {
    const body = buf.join("\n").trim();
    if (title !== null || body) out.push({ title: title ?? fallbackTitle, text: body });
    buf = [];
  };
  for (const line of lines) {
    const h = /^(#{1,3})\s+(.*\S)\s*$/.exec(line);
    if (h) {
      flush();
      title = h[2];
      continue;
    }
    buf.push(line);
  }
  flush();
  return out.length ? out : [{ title: fallbackTitle, text: text.trim() }];
}

/**
 * Extract one deck file into slides.
 *
 * A file that yields nothing is a *problem*, not an empty result: a deck that silently
 * extracts to nothing produces a copilot that says nothing, and nobody can tell the
 * difference from a quiet meeting.
 */
export function extractFile(path: string, read: (p: string) => string = (p) => readFileSync(p, "utf-8")): {
  slides: { title: string; text: string }[];
  problem?: string;
} {
  let raw: string;
  try {
    raw = read(path);
  } catch (err) {
    return { slides: [], problem: `cannot read: ${(err as Error).message}` };
  }

  const ext = extname(path).toLowerCase();
  const fallback = basename(path, ext).replace(/^[\d._-]+/, "").replace(/[_-]+/g, " ").trim() || basename(path);

  if (ext === ".html" || ext === ".htm") {
    const text = htmlToText(raw);
    if (!text) return { slides: [], problem: "no visible text after extraction" };
    // A handful of characters out of a real file is a loader shell, not a slide — and it
    // is worse than nothing, because it passes an emptiness check and reads as content.
    if (text.length < MIN_SLIDE_CHARS && raw.length > 2000) {
      return { slides: [], problem: `extracted only ${text.length} characters (${JSON.stringify(text.slice(0, 40))}) from a ${Math.round(raw.length / 1024)} KB file — this looks like a loader shell, not the slide` };
    }
    // One HTML file is one slide: an exported deck ships a file per slide, and splitting
    // on headings inside one would invent slides the deck does not have.
    return { slides: [{ title: htmlTitle(raw) ?? fallback, text }] };
  }

  const text = raw.trim();
  if (!text) return { slides: [], problem: "file is empty" };
  return { slides: markdownSlides(text, fallback) };
}

/** Extract a whole deck: ordered slides with their facts, plus whatever failed. */
export function extractDeck(
  files: string[],
  read?: (p: string) => string,
  warn: (msg: string) => void = console.warn,
): DeckExtraction {
  const ordered = [...files]
    .map((f, i) => ({ f, i, ord: fileOrder(f) }))
    .sort((a, b) => (a.ord - b.ord) || (a.i - b.i))
    .map((x) => x.f);

  const slides: Slide[] = [];
  const problems: DeckProblem[] = [];
  let index = 0;

  for (const file of ordered) {
    const { slides: parts, problem } = extractFile(file, read);
    if (problem) {
      problems.push({ file, reason: problem });
      warn(`[set-copilot] deck: ${file} — ${problem}`);
      continue;
    }
    for (const part of parts) {
      index++;
      slides.push({
        index,
        title: part.title,
        text: part.text,
        source: file,
        facts: extractFacts(part.text, index, part.title),
      });
    }
  }

  if (files.length > 0 && slides.length === 0) {
    warn(`[set-copilot] deck: ${files.length} file(s) configured but nothing extracted — the copilot will have no deck to cite`);
  }
  return { slides, problems };
}
