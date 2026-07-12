import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, resolve, relative, basename } from "node:path";
import { execSync } from "node:child_process";

import { resolveSources } from "./sources.js";
import { stemFromName, topicFromName } from "./keyword-matcher.js";
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
 * Built-in adapter: the knowledge base is markdown, in whatever shape the project
 * keeps it — a docs tree, a decisions folder, a pile of meeting notes, a glob.
 *
 * - keyword patterns  = config seeds, plus (autoKeywords) topics derived from the
 *                       pages themselves: titles, `##` headings, frontmatter tags
 * - enriched context  = decisions parsed from `decisionsDir`, deferred markers
 *                        grepped from pages, per-file key facts, recent fix commits
 * - digest            = compact markdown assembled from the above
 *
 * It assumes no database, no wiki product, and no naming convention.
 */
export class MarkdownAdapter implements KnowledgeAdapter {
  readonly name = "markdown";
  constructor(private ctx: AdapterContext) {}

  keywordPatterns(): KeywordPattern[] {
    const seeds = [...this.ctx.seedKeywords];
    if (!this.ctx.autoKeywords) return seeds;

    // Seeds win: a hand-written stem for a topic is more precise than a derived one.
    const taken = new Set(seeds.map((s) => s.topic.toLowerCase()));
    const derived: KeywordPattern[] = [];

    for (const name of this.derivedTopicNames()) {
      const topic = topicFromName(name);
      const key = topic.toLowerCase();
      if (!topic || taken.has(key)) continue;
      const stem = stemFromName(topic);
      if (!stem) continue;
      taken.add(key);
      derived.push({ topic, stems: [stem] });
      if (derived.length >= MAX_DERIVED_TOPICS) break;
    }

    return [...seeds, ...derived];
  }

  enrichedContext(): EnrichedContext {
    return {
      generated: fixedTimestamp(),
      decisions: this.readDecisions(),
      deferred: this.readDeferred(),
      cards: [],
      domainFaq: this.readDomainFaq(),
      recentIncidents: this.readRecentIncidents(),
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
      lines.push("## Page index", "");
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
    if (lines.length === 2) {
      lines.push(
        "_No knowledge sources resolved. Set `knowledge.sources` in set-copilot.config.json_",
        "",
      );
    }
    return lines.join("\n");
  }

  // ---- helpers -------------------------------------------------------------

  private markdownFiles(): string[] {
    return resolveSources(this.ctx.projectRoot, this.ctx.sources);
  }

  /**
   * Topic candidates the pages name themselves: frontmatter tags, the page title,
   * and `##` section headings. This is what makes a project with ordinary docs
   * useful to the copilot on day one, with an empty `keywords` array.
   */
  private derivedTopicNames(): string[] {
    const names: string[] = [];
    for (const file of this.markdownFiles()) {
      const raw = readFileSync(file, "utf-8");
      const fm = parseFrontmatter(raw);
      for (const key of ["tags", "topics", "keywords"]) {
        for (const tag of splitList(fm[key] ?? "")) names.push(tag);
      }
      const body = stripFrontmatter(raw);
      const title = firstHeading(body);
      if (title) names.push(title);
      for (const m of body.matchAll(/^##\s+(.+)$/gm)) names.push(m[1]!.trim());
    }
    return names.filter(isTopicLike);
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
    const markers = this.ctx.deferredMarkers.filter(Boolean);
    if (!markers.length) return out;
    const marker = new RegExp(markers.join("|"), "iu");
    // A generic ticket/requirement id: two-to-five letter groups plus a number.
    const reqRe = /\b([A-Z][A-Z0-9]{1,5}(?:-[A-Z0-9]{1,5})?-\d{1,5})\b/;
    for (const file of this.markdownFiles()) {
      const rel = relative(this.ctx.projectRoot, file);
      for (const line of readFileSync(file, "utf-8").split("\n")) {
        if (marker.test(line)) {
          const req = line.match(reqRe)?.[1] ?? "";
          out.push({ req, description: line.replace(/^[-*\s>]+/, "").trim().slice(0, 200), source: rel });
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

// ---- topic heuristics ------------------------------------------------------

const MAX_DERIVED_TOPICS = 200;

/**
 * Headings that name a document's furniture rather than a subject. Matching one
 * of these as a "topic" would flag half the meeting.
 */
const GENERIC_HEADINGS = new Set([
  "overview", "summary", "introduction", "intro", "background", "context", "notes",
  "todo", "todos", "goals", "scope", "status", "details", "usage", "example",
  "examples", "links", "references", "appendix", "changelog", "history", "faq",
  "requirements", "open questions", "next steps", "table of contents",
]);

/** A topic must be a name, not a sentence: short, not generic, not a bare number. */
export function isTopicLike(name: string): boolean {
  const t = name.trim().replace(/[.:!?]+$/, "");
  if (t.length < 3 || t.length > 60) return false;
  if (GENERIC_HEADINGS.has(t.toLowerCase())) return false;
  if (t.split(/\s+/).length > 5) return false; // prose heading, not a topic
  if (!/\p{L}/u.test(t)) return false; // no letters — a number or punctuation run
  return true;
}

// ---- markdown/frontmatter utilities (no external deps) --------------------

function parseFrontmatter(raw: string): Record<string, string> {
  const m = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const fm: Record<string, string> = {};
  let listKey = "";
  for (const line of m[1]!.split("\n")) {
    // YAML block list under the previous key: "- value"
    const item = line.match(/^\s*-\s+(.+)$/);
    if (item && listKey) {
      fm[listKey] = fm[listKey] ? `${fm[listKey]}, ${item[1]!.trim()}` : item[1]!.trim();
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (kv) {
      const key = kv[1]!;
      const value = kv[2]!.trim().replace(/^["']|["']$/g, "");
      fm[key] = value;
      listKey = value === "" ? key : "";
    }
  }
  return fm;
}

/** "a, b, c" / "[a, b]" / a YAML list already flattened by parseFrontmatter */
function splitList(value: string): string[] {
  return value
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
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
