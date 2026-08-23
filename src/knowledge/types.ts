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
 * The built-in `markdown` adapter covers the common case (markdown pages, in
 * whatever layout the project happens to use). Projects with richer sources ship
 * their own adapter module and point `knowledge.adapter` at it.
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
  /**
   * The deck this meeting is about, in slide order, with the numeric claims each slide
   * makes. Contributed by the pipeline rather than by an adapter, so a project running a
   * custom adapter gets deck awareness without implementing it.
   */
  deck?: DeckSlideContext[];
}

/** One slide as the copilot sees it: enough to cite, without carrying the whole deck. */
export interface DeckSlideContext {
  index: number;
  title: string;
  /** Opening text of the slide, trimmed — the digest carries the citable part, not the deck. */
  summary: string;
  facts: { figure: string; unit?: string; context: string }[];
}

/**
 * One thing the copilot is allowed to speak up about. The shipped defaults are
 * contradiction / context / new decision / question, but the taxonomy is data:
 * a project can drop a category or add its own (pricing, compliance, …) without
 * forking the skill.
 */
export interface AlertCategory {
  /** Stable key, e.g. "contradiction" */
  key: string;
  /** Prefix shown in the chat line, e.g. "⚠" */
  emoji: string;
  /** Display label; defaults to key.toUpperCase() */
  label?: string;
  priority: "high" | "medium" | "low";
  /** Also fire an OS desktop notification when this category triggers */
  notify?: boolean;
  /** Natural-language trigger condition — rendered verbatim into the prompt */
  when: string;
}

/** Everything an adapter needs to know about the project it runs against */
export interface AdapterContext {
  projectRoot: string;
  /** knowledge.sources — paths or globs, resolved by the adapter */
  sources: string[];
  decisionsDir?: string;
  /** Manually seeded keyword patterns from the config */
  seedKeywords: KeywordPattern[];
  /** Derive additional topics from the sources themselves (headings, titles, tags) */
  autoKeywords: boolean;
  /** Regex sources marking a line as deferred / out-of-scope */
  deferredMarkers: string[];
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
