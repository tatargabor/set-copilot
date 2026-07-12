/**
 * Library entry — for programmatic use and custom knowledge adapters.
 *
 * Most users interact through the `set-copilot` CLI + the Claude Code skills.
 * Import from here when writing a custom KnowledgeAdapter or embedding capture.
 */

export {
  loadConfig, normalizeKeywords, DEFAULT_ALERTS, DEFAULT_DETECT, DEFAULT_DEFERRED_MARKERS,
  type CopilotConfig, type KnowledgeConfig, type CopilotPromptConfig, type DetectionConfig,
} from "./config.js";
export { runCapture, type CaptureOptions } from "./capture.js";
export { runDigest } from "./knowledge/run-digest.js";
export { runPoll } from "./poll.js";
export { renderCopilotPrompt, renderAlerts } from "./copilot-prompt.js";
export { resolveSources, globToRegExp } from "./knowledge/sources.js";
export {
  buildMatcher, compilePatterns, loadKeywordIndex, stemFromName, topicFromName,
} from "./knowledge/keyword-matcher.js";
export { TranscriptWriter, type TranscriptLine, type SilenceEvent } from "./transcript-writer.js";
export type {
  KnowledgeAdapter,
  KnowledgeAdapterFactory,
  AdapterContext,
  AlertCategory,
  KeywordPattern,
  EnrichedContext,
  DecisionSummary,
  DeferredItem,
  TopicCard,
  DomainFaq,
  Incident,
} from "./knowledge/types.js";
export { MarkdownAdapter, default as createMarkdownAdapter } from "./knowledge/markdown-adapter.js";
