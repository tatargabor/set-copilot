import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";

import type { CopilotConfig } from "../config.js";
import { keywordIndexPath, enrichedContextPath, digestMarkdownPath } from "../config.js";
import type { AdapterContext, KnowledgeAdapter, KnowledgeAdapterFactory } from "./types.js";
import createMarkdownAdapter from "./markdown-adapter.js";

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

  enriched.generated = new Date().toISOString();

  mkdirSync(dirname(keywordIndexPath(cfg)), { recursive: true });
  writeFileSync(keywordIndexPath(cfg), JSON.stringify(patterns, null, 2) + "\n");
  writeFileSync(enrichedContextPath(cfg), JSON.stringify(enriched, null, 2) + "\n");
  writeFileSync(digestMarkdownPath(cfg), digest + "\n");

  return `[set-copilot] digest via "${adapter.name}": ${patterns.length} keywords, ${enriched.decisions.length} decisions, ${enriched.deferred.length} deferred, ${enriched.domainFaq.length} domains`;
}
