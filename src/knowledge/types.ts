/**
 * Knowledge adapter contract.
 *
 * The engine (capture + skills) is knowledge-agnostic. A KnowledgeAdapter turns
 * whatever a project's "knowledge base" is (markdown wiki, database, Notion,
 * Confluence…) into three artifacts the copilot consumes:
 *
 *   1. keyword patterns  → JSON-side topic annotation on transcript lines
 *   2. enriched context  → structured JSON for the copilot's "lite" mode
 *   3. markdown digest    → human-readable summary loaded at session start
 *
 * The built-in `markdown` adapter covers the common case (a directory of
 * markdown pages). Projects with richer sources ship their own adapter module
 * and point `knowledge.adapter` at it in set-copilot.config.json.
 */

/** A topic and the regex stems (matched at word start, case-insensitive) that trigger it */
export interface KeywordPattern {
  /** Canonical label written into the JSONL "topics" array */
  topic: string;
  /** Regex sources matched case-insensitively at a word start */
  stems: string[];
}

export interface DecisionSummary {
  id: string;
  title: string;
  summary: string;
}

export interface DeferredItem {
  /** Requirement / ticket id, if any */
  req: string;
  description: string;
  source: string;
}

export interface TopicCard {
  /** e.g. a partner name, a subsystem, an entity */
  name: string;
  facts: string[];
  recentIssues?: string[];
}

export interface DomainFaq {
  domain: string;
  file: string;
  keyFacts: string[];
}

export interface Incident {
  date: string;
  description: string;
  domain: string;
}

/** Structured context loaded verbatim into the copilot's "lite" mode */
export interface EnrichedContext {
  generated: string;
  decisions: DecisionSummary[];
  deferred: DeferredItem[];
  cards: TopicCard[];
  domainFaq: DomainFaq[];
  recentIncidents: Incident[];
}

/** Everything an adapter needs to know about the project it runs against */
export interface AdapterContext {
  projectRoot: string;
  /** knowledge.* section of the resolved config */
  sources: string[];
  decisionsDir?: string;
  seedKeywords: KeywordPattern[];
}

export interface KnowledgeAdapter {
  /** Human-readable adapter name (for logging) */
  readonly name: string;
  /** Compiled keyword patterns (seeds + adapter-discovered entities) */
  keywordPatterns(): Promise<KeywordPattern[]> | KeywordPattern[];
  /** Structured context for lite mode */
  enrichedContext(): Promise<EnrichedContext> | EnrichedContext;
  /** Human-readable markdown digest for session start */
  digestMarkdown(): Promise<string> | string;
}

/** Factory signature a custom adapter module must default-export */
export type KnowledgeAdapterFactory = (ctx: AdapterContext) => KnowledgeAdapter;
