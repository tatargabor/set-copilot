import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, resolve, relative, basename } from "node:path";
import { execSync } from "node:child_process";

import type {
  AdapterContext,
  KnowledgeAdapter,
  KeywordPattern,
  EnrichedContext,
  DecisionSummary,
  DeferredItem,
  DomainFaq,
  Incident,
} from "./types.js";

/**
 * Built-in adapter: treats the knowledge base as a directory of markdown pages.
 *
 * - keyword patterns  = the config seed keywords (no external entity source)
 * - enriched context  = decisions parsed from `decisionsDir`, deferred markers
 *                        grepped from pages, per-file key facts, recent fix commits
 * - digest            = compact markdown assembled from the above
 *
 * It makes no assumptions about a database or a specific wiki structure, so it
 * works for any project whose knowledge lives in markdown.
 */
export class MarkdownAdapter implements KnowledgeAdapter {
  readonly name = "markdown";
  constructor(private ctx: AdapterContext) {}

  keywordPatterns(): KeywordPattern[] {
    // The markdown adapter has no external entity source, so patterns are the
    // configured seeds. A custom adapter can enrich these from a DB/API.
    return [...this.ctx.seedKeywords];
  }

  enrichedContext(): EnrichedContext {
    const decisions = this.readDecisions();
    const deferred = this.readDeferred();
    const domainFaq = this.readDomainFaq();
    const recentIncidents = this.readRecentIncidents();
    return {
      generated: fixedTimestamp(),
      decisions,
      deferred,
      cards: [],
      domainFaq,
      recentIncidents,
    };
  }

  digestMarkdown(): string {
    const ctx = this.enrichedContext();
    const lines: string[] = ["# Knowledge digest", ""];

    if (ctx.decisions.length) {
      lines.push("## Decisions", "");
      for (const d of ctx.decisions) lines.push(`- **${d.id}** ${d.title} — ${d.summary}`);
      lines.push("");
    }
    if (ctx.deferred.length) {
      lines.push("## Deferred / out-of-scope", "");
      for (const d of ctx.deferred) lines.push(`- ${d.req ? `[${d.req}] ` : ""}${d.description} (${d.source})`);
      lines.push("");
    }
    if (ctx.domainFaq.length) {
      lines.push("## Domain index", "");
      for (const f of ctx.domainFaq) {
        lines.push(`### ${f.domain} (${f.file})`);
        for (const fact of f.keyFacts) lines.push(`- ${fact}`);
        lines.push("");
      }
    }
    if (ctx.recentIncidents.length) {
      lines.push("## Recent fixes (30d)", "");
      for (const i of ctx.recentIncidents) lines.push(`- ${i.description}`);
      lines.push("");
    }
    return lines.join("\n");
  }

  // ---- helpers -------------------------------------------------------------

  private markdownFiles(): string[] {
    const out: string[] = [];
    for (const src of this.ctx.sources) {
      const abs = resolve(this.ctx.projectRoot, src);
      if (!existsSync(abs)) continue;
      if (statSync(abs).isDirectory()) walkMarkdown(abs, out);
      else if (abs.endsWith(".md")) out.push(abs);
    }
    return out;
  }

  private readDecisions(): DecisionSummary[] {
    if (!this.ctx.decisionsDir) return [];
    const dir = resolve(this.ctx.projectRoot, this.ctx.decisionsDir);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
    const out: DecisionSummary[] = [];
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".md")).sort()) {
      const raw = readFileSync(join(dir, f), "utf-8");
      const fm = parseFrontmatter(raw);
      const status = (fm.status || "").toLowerCase();
      if (status === "superseded") continue;
      const id = fm.id || basename(f, ".md");
      const title = fm.title || firstHeading(raw) || id;
      out.push({ id, title, summary: firstParagraph(stripFrontmatter(raw)) });
    }
    return out;
  }

  private readDeferred(): DeferredItem[] {
    const out: DeferredItem[] = [];
    const marker = /(deferred:\s*\S+|halasztva|M2-re|out of scope|out-of-scope)/i;
    const reqRe = /\b([A-Z]{2,5}-[A-Z]{2,5}-\d{2,4}|REQ-[A-Z]+-\d+)\b/;
    for (const file of this.markdownFiles()) {
      const rel = relative(this.ctx.projectRoot, file);
      for (const line of readFileSync(file, "utf-8").split("\n")) {
        if (marker.test(line)) {
          const req = line.match(reqRe)?.[1] ?? "";
          out.push({ req, description: line.replace(/^[-*\s]+/, "").trim().slice(0, 200), source: rel });
        }
      }
    }
    return out.slice(0, 100);
  }

  private readDomainFaq(): DomainFaq[] {
    const out: DomainFaq[] = [];
    for (const file of this.markdownFiles()) {
      const rel = relative(this.ctx.projectRoot, file);
      const raw = readFileSync(file, "utf-8");
      const headings = [...raw.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1]!.trim());
      if (headings.length === 0) continue;
      out.push({
        domain: firstHeading(raw) || basename(file, ".md"),
        file: rel,
        keyFacts: headings.slice(0, 8),
      });
    }
    return out;
  }

  private readRecentIncidents(): Incident[] {
    try {
      const log = execSync(
        `git -C "${this.ctx.projectRoot}" log --since="30 days ago" --oneline --grep="fix"`,
        { encoding: "utf-8", timeout: 5_000, stdio: ["ignore", "pipe", "ignore"] },
      );
      return log
        .split("\n")
        .filter(Boolean)
        .slice(0, 30)
        .map((line) => ({ date: "", description: line, domain: "" }));
    } catch {
      return [];
    }
  }
}

export default function createMarkdownAdapter(ctx: AdapterContext): KnowledgeAdapter {
  return new MarkdownAdapter(ctx);
}

// ---- markdown/frontmatter utilities (no external deps) --------------------

function walkMarkdown(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkMarkdown(full, out);
    else if (entry.name.endsWith(".md")) out.push(full);
  }
}

function parseFrontmatter(raw: string): Record<string, string> {
  const m = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const fm: Record<string, string> = {};
  for (const line of m[1]!.split("\n")) {
    const kv = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (kv) fm[kv[1]!] = kv[2]!.trim().replace(/^["']|["']$/g, "");
  }
  return fm;
}

function stripFrontmatter(raw: string): string {
  return raw.replace(/^---\n[\s\S]*?\n---\n?/, "");
}

function firstHeading(raw: string): string {
  return stripFrontmatter(raw).match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "";
}

function firstParagraph(body: string): string {
  for (const block of body.split(/\n\s*\n/)) {
    const t = block.trim();
    if (t && !t.startsWith("#")) return t.replace(/\s+/g, " ").slice(0, 240);
  }
  return "";
}

// Scripts must be deterministic (no Date.now); callers stamp the real time after run.
function fixedTimestamp(): string {
  return "generated";
}
