import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, join } from "node:path";

import type { AlertCategory, KeywordPattern } from "./knowledge/types.js";

export interface KnowledgeConfig {
  /** "markdown" (built-in) or a path to a module exporting a KnowledgeAdapter factory */
  adapter: string;
  /** Paths or globs the adapter scans — a docs dir, scattered notes, "**\/*.md", anything */
  sources: string[];
  /** Directory holding decision files (markdown with frontmatter). Optional. */
  decisions?: string;
  /** If set (e.g. "DEC"), transcript lines referencing "<PREFIX>-NNN" get annotated. */
  decisionIdPrefix?: string;
  /** Hand-written topic seeds. Optional — with autoKeywords the sources supply the rest. */
  keywords: KeywordPattern[];
  /** Derive extra topics from the sources (page titles, headings, decision titles, tags) */
  autoKeywords: boolean;
  /** Regex sources that mark a knowledge line as deferred / out-of-scope */
  deferredMarkers: string[];
}

/** What the copilot is allowed to speak up about, and how it should read the knowledge */
export interface CopilotPromptConfig {
  /**
   * Path to a project-owned markdown file loaded verbatim into the copilot's
   * context at session start — domain rules, tone, what matters in this project.
   */
  instructions?: string;
  /** Alert taxonomy. Defaults to contradiction / context / new decision / question. */
  alerts: AlertCategory[];
}

/** Regex sources driving the per-line flags the copilot routes on */
export interface DetectionConfig {
  /** A match sets `urgency: "high"` on the transcript line */
  urgency: string[];
  /** A match sets `question: true` */
  question: string[];
}

export interface CopilotConfig {
  /** Language hint passed to Soniox (e.g. "hu", "en") */
  language: string;
  /** Runtime scratch dir for JSONL + poll offset (must match what skills read) */
  runtimeDir: string;
  /** Where the capture process writes the meeting transcript JSONL */
  transcriptOutput: string;
  /** Where dictation (mic-only) writes its JSONL */
  dictationOutput: string;
  sonioxApiKey: string;
  sonioxMode: "rt" | "chunk";
  audio: {
    micSource: string;
    monitorSource: string;
    sampleRate: number;
    /** Optional custom sound files for the start/stop signal (any format paplay/afplay plays) */
    toneStart: string;
    toneEnd: string;
  };
  knowledge: KnowledgeConfig;
  copilot: CopilotPromptConfig;
  detect: DetectionConfig;
  /** Absolute path of the project root the config was loaded from */
  projectRoot: string;
}

/**
 * User-level config dir — the fallback for secrets and settings when the
 * command runs outside a set-copilot project (e.g. /ds from any cwd).
 */
export function userConfigDir(): string {
  if (process.env.SET_COPILOT_HOME) return resolve(process.env.SET_COPILOT_HOME);
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "set-copilot");
}

/** Load a simple KEY=VALUE .env file into process.env (does not overwrite existing) */
function loadDotEnvFile(envPath: string): void {
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

/** Project .env wins over the user-level one (first loader to set a key keeps it). */
function loadDotEnv(projectRoot: string): void {
  loadDotEnvFile(join(projectRoot, ".env"));
  loadDotEnvFile(join(userConfigDir(), ".env"));
}

/**
 * The copilot's out-of-the-box alert taxonomy. Entirely replaceable from config:
 * a project that only cares about pricing slips ships one category and gets a
 * copilot that stays silent about everything else.
 */
export const DEFAULT_ALERTS: AlertCategory[] = [
  {
    key: "contradiction",
    emoji: "⚠",
    priority: "high",
    notify: true,
    when: "what is being said contradicts an active decision, treats a deferred / out-of-scope item as if it were in scope, or contradicts a documented fact. Cite the exact source (decision id, file, line).",
  },
  {
    key: "context",
    emoji: "📋",
    priority: "medium",
    when: "relevant recorded knowledge the speakers may not remember — a prior different outcome, or a spec section that already covers what they are discussing. Quote the fact and cite the file.",
  },
  {
    key: "new decision",
    emoji: "✏",
    priority: "medium",
    when: "the speakers are deciding something worth recording — a scope change, a new requirement, a design choice. Summarize it and suggest where to record it.",
  },
  {
    key: "question",
    emoji: "❓",
    priority: "low",
    when: "a topic is raised where the knowledge base is unclear or silent. Note what is unknown and where to look.",
  },
];

/**
 * Line-flag detection defaults. English + Hungarian out of the box; a project in
 * another language replaces these wholesale via `detect.urgency` / `detect.question`.
 * The trailing "?" rule is language-independent, so a bare override still detects
 * most questions.
 */
export const DEFAULT_DETECT: DetectionConfig = {
  urgency: [
    // en
    "\\b(bugs?|broken|crash(es|ed|ing)?|fail(s|ed|ing|ure)?|blocker|urgent|asap|regression|outage|not working|doesn'?t work|went down)\\b",
    // hu
    "(?<=^|[^\\p{L}])(hib[aá]|probléma|nem működ|sürgős|nem jó|rossz|elroml|baj van|nem stim|nem ok|gond van)",
  ],
  question: [
    // language-independent
    "[?]\\s*$",
    // en
    "(?:^|[.!]\\s+)(what|why|how|when|where|who|which|can we|should we|could we|is it|are we|do we|does it|shall we)\\b",
    // hu
    "(?:^|[.!]\\s+)(mi[tck]?soda|hogyan|miért|mikor|hol|ki |mennyit?|melyik|hány|mit |milyen|hogy\\b|kell-e|lehet-e|van-e|tudunk-e)",
  ],
};

/**
 * Deferred/out-of-scope markers the markdown adapter greps for. Defaults are
 * English; projects add their own vocabulary rather than editing the package.
 */
export const DEFAULT_DEFERRED_MARKERS = [
  "deferred:\\s*\\S+",
  "out[- ]of[- ]scope",
  "postponed",
  "won'?t (do|fix)",
  "\\bTBD\\b",
];

const DEFAULTS: Omit<CopilotConfig, "sonioxApiKey" | "projectRoot"> = {
  language: "en",
  runtimeDir: "/tmp/set-copilot",
  transcriptOutput: "/tmp/set-copilot/transcript.jsonl",
  dictationOutput: "/tmp/set-copilot/dictation.jsonl",
  sonioxMode: "rt",
  audio: { micSource: "", monitorSource: "", sampleRate: 16000, toneStart: "", toneEnd: "" },
  knowledge: {
    adapter: "markdown",
    sources: [],
    keywords: [],
    autoKeywords: true,
    deferredMarkers: DEFAULT_DEFERRED_MARKERS,
  },
  copilot: { alerts: DEFAULT_ALERTS },
  detect: DEFAULT_DETECT,
};

export const CONFIG_FILENAME = "set-copilot.config.json";

/** Config as it may appear on disk — keywords accept the legacy grouped shape. */
type RawKnowledge = Omit<Partial<KnowledgeConfig>, "keywords"> & {
  keywords?: KeywordPattern[] | Record<string, KeywordPattern[]>;
};
type RawConfig = Omit<Partial<CopilotConfig>, "knowledge"> & { knowledge?: RawKnowledge };

function readConfigFile(path: string): RawConfig {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as RawConfig;
  } catch (err) {
    throw new Error(`[set-copilot] Failed to parse ${path}: ${(err as Error).message}`);
  }
}

/**
 * Keywords are a flat [{topic, stems}] list. Named groups — the old
 * {partners: [...], features: [...]} shape, or any user-invented grouping — are
 * accepted and flattened, because the group name never reached the transcript
 * anyway: only `topic` does.
 */
export function normalizeKeywords(raw: unknown): KeywordPattern[] {
  const flat: KeywordPattern[] = [];
  const push = (list: unknown): void => {
    if (!Array.isArray(list)) return;
    for (const p of list) {
      if (p && typeof p.topic === "string" && Array.isArray(p.stems) && p.stems.length) {
        flat.push({ topic: p.topic, stems: p.stems.filter((s: unknown) => typeof s === "string") });
      }
    }
  };
  if (Array.isArray(raw)) push(raw);
  else if (raw && typeof raw === "object") for (const group of Object.values(raw)) push(group);
  return flat;
}

/** Drop malformed alert entries rather than letting them reach the prompt as `undefined`. */
function normalizeAlerts(raw: unknown): AlertCategory[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = raw.filter(
    (a): a is AlertCategory =>
      !!a && typeof a.key === "string" && typeof a.when === "string" && typeof a.emoji === "string",
  );
  return out.length ? out : undefined;
}

/**
 * Load the effective config for a project.
 *
 * Resolution order (later wins): built-in defaults → user config → project config
 * → env overrides. Secrets (SONIOX_API_KEY) come from env / .env only (project
 * .env first, then the user-level one), never the committed config.
 */
export function loadConfig(projectRoot: string = process.cwd()): CopilotConfig {
  const root = resolve(projectRoot);
  loadDotEnv(root);

  const userCfg = readConfigFile(join(userConfigDir(), CONFIG_FILENAME));
  const projCfg = readConfigFile(join(root, CONFIG_FILENAME));
  const fileCfg: RawConfig = { ...userCfg, ...projCfg };
  // Nested sections merge per key, so a project can override `sources` without
  // also having to restate the user-level `keywords`.
  const knowledge: RawKnowledge = { ...userCfg.knowledge, ...projCfg.knowledge };
  const copilot = { ...userCfg.copilot, ...projCfg.copilot };
  const detect = { ...userCfg.detect, ...projCfg.detect };

  const runtimeDir = process.env.SET_COPILOT_DIR || fileCfg.runtimeDir || DEFAULTS.runtimeDir;
  const mode = process.env.SONIOX_MODE || fileCfg.sonioxMode || DEFAULTS.sonioxMode;

  return {
    language: process.env.SET_COPILOT_LANGUAGE || fileCfg.language || DEFAULTS.language,
    runtimeDir,
    transcriptOutput: fileCfg.transcriptOutput ?? join(runtimeDir, "transcript.jsonl"),
    dictationOutput: fileCfg.dictationOutput ?? join(runtimeDir, "dictation.jsonl"),
    sonioxApiKey: process.env.SONIOX_API_KEY || "",
    sonioxMode: mode === "chunk" ? "chunk" : "rt",
    audio: {
      micSource: process.env.MIC_SOURCE || fileCfg.audio?.micSource || DEFAULTS.audio.micSource,
      monitorSource: process.env.MONITOR_SOURCE || fileCfg.audio?.monitorSource || DEFAULTS.audio.monitorSource,
      sampleRate: fileCfg.audio?.sampleRate ?? DEFAULTS.audio.sampleRate,
      toneStart: fileCfg.audio?.toneStart || DEFAULTS.audio.toneStart,
      toneEnd: fileCfg.audio?.toneEnd || DEFAULTS.audio.toneEnd,
    },
    knowledge: {
      adapter: knowledge.adapter ?? DEFAULTS.knowledge.adapter,
      sources: knowledge.sources ?? DEFAULTS.knowledge.sources,
      decisions: knowledge.decisions,
      decisionIdPrefix: knowledge.decisionIdPrefix,
      keywords: normalizeKeywords(knowledge.keywords),
      autoKeywords: knowledge.autoKeywords ?? DEFAULTS.knowledge.autoKeywords,
      deferredMarkers: knowledge.deferredMarkers?.length
        ? knowledge.deferredMarkers
        : DEFAULTS.knowledge.deferredMarkers,
    },
    copilot: {
      instructions: copilot.instructions,
      alerts: normalizeAlerts(copilot.alerts) ?? DEFAULT_ALERTS,
    },
    detect: {
      urgency: detect.urgency?.length ? detect.urgency : DEFAULT_DETECT.urgency,
      question: detect.question?.length ? detect.question : DEFAULT_DETECT.question,
    },
    projectRoot: root,
  };
}

/** Path where the digest step writes the compiled keyword index */
export function keywordIndexPath(cfg: CopilotConfig): string {
  return join(cfg.runtimeDir, "keyword-index.json");
}

/** Path where the digest step writes the enriched (lite-mode) context */
export function enrichedContextPath(cfg: CopilotConfig): string {
  return join(cfg.runtimeDir, "knowledge-context.json");
}

/** Path where the digest step writes the human-readable markdown digest */
export function digestMarkdownPath(cfg: CopilotConfig): string {
  return join(cfg.runtimeDir, "knowledge-digest.md");
}
