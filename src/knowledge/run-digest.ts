import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";

import type { CopilotConfig } from "../config.js";
import { keywordIndexPath, enrichedContextPath, digestMarkdownPath } from "../config.js";
import type { AdapterContext, DeckSlideContext, KnowledgeAdapter, KnowledgeAdapterFactory } from "./types.js";
import createMarkdownAdapter from "./markdown-adapter.js";
import { extractDeck, type Slide } from "./deck.js";
import { resolveSources } from "./sources.js";

/** Extensions a deck may be written in. Format handling is engine; which files is config. */
const DECK_EXTENSIONS = [".md", ".txt", ".html", ".htm"];

/** How much of a slide's text the context carries — enough to cite, not the whole deck. */
const SLIDE_SUMMARY_CHARS = 400;

/** Resolve deck paths across every deck extension, reusing the tested source resolver. */
export function resolveDeckFiles(projectRoot: string, deck: string[]): string[] {
  if (!deck.length) return [];
  const found = new Set<string>();
  for (const ext of DECK_EXTENSIONS) {
    for (const f of resolveSources(projectRoot, deck, ext)) found.add(f);
  }
  return [...found];
}

/**
 * Keyword topics a slide contributes, so a transcript line is tagged with the slide it
 * belongs to through the index the capture already reads.
 *
 * Stems come from the title's own words: those are what a presenter actually says when
 * they arrive at a slide. Short words are dropped — matching on "a" or "és" would tag
 * every line in the meeting with every slide, which is the same as tagging nothing.
 */
export function slideKeywordPatterns(slides: Slide[]): { topic: string; stems: string[] }[] {
  return slides
    .map((s) => {
      const stems = [...new Set(
        s.title.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 5),
      )];
      return { topic: `dia ${s.index}: ${s.title}`, stems };
    })
    .filter((p) => p.stems.length > 0);
}

/** The slide shape the context carries. */
export function slideContext(slides: Slide[]): DeckSlideContext[] {
  return slides.map((s) => ({
    index: s.index,
    title: s.title,
    summary: s.text.replace(/\s+/g, " ").slice(0, SLIDE_SUMMARY_CHARS),
    facts: s.facts.map((f) => ({ figure: f.figure, unit: f.unit, context: f.context })),
  }));
}

/**
 * The deck section of the session digest.
 *
 * Facts lead, prose follows. The contradiction the copilot is there to catch is a figure,
 * and a digest that buries the figures in summary text asks it to re-read the deck at the
 * moment it has the least time to.
 */
export function renderDeckDigest(slides: Slide[]): string {
  if (!slides.length) return "";
  const out: string[] = ["", "## A prezentáció (diánként)", ""];
  out.push("Ezt a decket adja elő a beszélő. Ha egy elhangzott szám ellentmond egy itteni");
  out.push("számnak, **hivatkozd a diát** — nem a tudásbázist.", "");
  for (const s of slides) {
    out.push(`### ${s.index}. dia — ${s.title}`);
    if (s.facts.length) {
      for (const f of s.facts) {
        out.push(`- **${f.figure}${f.unit ? " " + f.unit : ""}** — ${f.context}`);
      }
    }
    const prose = s.text.replace(/\s+/g, " ").slice(0, SLIDE_SUMMARY_CHARS);
    if (prose) out.push("", prose);
    out.push("");
  }
  return out.join("\n");
}

async function resolveAdapter(cfg: CopilotConfig, ctx: AdapterContext): Promise<KnowledgeAdapter> {
  const spec = cfg.knowledge.adapter;
  if (!spec || spec === "markdown") return createMarkdownAdapter(ctx);

  // Custom adapter module: path relative to project root, default-exporting a factory.
  const modPath = resolve(cfg.projectRoot, spec);
  const mod = (await import(pathToFileURL(modPath).href)) as {
    default?: KnowledgeAdapterFactory;
  };
  if (typeof mod.default !== "function") {
    throw new Error(`[set-copilot] Adapter module "${spec}" must default-export a (ctx) => KnowledgeAdapter factory`);
  }
  return mod.default(ctx);
}

/**
 * Run the configured knowledge adapter and write:
 *   - keyword-index.json   (topic annotation patterns)
 *   - knowledge-context.json (enriched context for lite mode)
 *   - knowledge-digest.md  (human-readable digest)
 *
 * Returns a one-line summary for logging.
 */
export async function runDigest(cfg: CopilotConfig): Promise<string> {
  const ctx: AdapterContext = {
    projectRoot: cfg.projectRoot,
    sources: cfg.knowledge.sources,
    decisionsDir: cfg.knowledge.decisions,
    seedKeywords: cfg.knowledge.keywords,
    autoKeywords: cfg.knowledge.autoKeywords,
    deferredMarkers: cfg.knowledge.deferredMarkers,
  };

  const adapter = await resolveAdapter(cfg, ctx);

  const [patterns, enriched, digest] = await Promise.all([
    adapter.keywordPatterns(),
    adapter.enrichedContext(),
    adapter.digestMarkdown(),
  ]);

  // The deck is contributed by the PIPELINE, not by an adapter: a project running a custom
  // adapter must get deck awareness without implementing it, and a deck is orthogonal to
  // however a project models the rest of its knowledge.
  const deckFiles = resolveDeckFiles(cfg.projectRoot, cfg.knowledge.deck);
  const { slides, problems } = deckFiles.length
    ? extractDeck(deckFiles)
    : { slides: [] as Slide[], problems: [] };
  const deckPatterns = slideKeywordPatterns(slides);
  const allPatterns = deckPatterns.length ? [...patterns, ...deckPatterns] : patterns;
  if (slides.length) enriched.deck = slideContext(slides);
  const fullDigest = slides.length ? digest + renderDeckDigest(slides) : digest;

  enriched.generated = new Date().toISOString();

  mkdirSync(dirname(keywordIndexPath(cfg)), { recursive: true });
  writeFileSync(keywordIndexPath(cfg), JSON.stringify(allPatterns, null, 2) + "\n");
  writeFileSync(enrichedContextPath(cfg), JSON.stringify(enriched, null, 2) + "\n");
  writeFileSync(digestMarkdownPath(cfg), fullDigest + "\n");

  const deckNote = slides.length
    ? `, ${slides.length} slides (${slides.reduce((n, s) => n + s.facts.length, 0)} facts)`
    : cfg.knowledge.deck.length ? ", deck configured but EMPTY" : "";
  const problemNote = problems.length ? ` — ${problems.length} deck file(s) failed to extract` : "";
  return `[set-copilot] digest via "${adapter.name}": ${allPatterns.length} keywords, ${enriched.decisions.length} decisions, ${enriched.deferred.length} deferred, ${enriched.domainFaq.length} domains${deckNote}${problemNote}`;
}
