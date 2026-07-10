import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

import type { KeywordPattern } from "./knowledge/types.js";

export interface KnowledgeConfig {
  /** "markdown" (built-in) or a path to a module exporting a KnowledgeAdapter factory */
  adapter: string;
  /** Glob-ish directories/files the markdown adapter scans for knowledge pages */
  sources: string[];
  /** Directory holding decision files (markdown with frontmatter). Optional. */
  decisions?: string;
  /** If set (e.g. "DEC"), transcript lines referencing "<PREFIX>-NNN" get annotated. */
  decisionIdPrefix?: string;
  /** Seed keyword patterns for transcript topic annotation */
  keywords: {
    partners: KeywordPattern[];
    features: KeywordPattern[];
  };
}

export interface CopilotConfig {
  /** BCP-47-ish language hint passed to Soniox (e.g. "hu", "en") */
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
  /** Absolute path of the project root the config was loaded from */
  projectRoot: string;
}

/** Load a simple KEY=VALUE .env file into process.env (does not overwrite existing) */
function loadDotEnv(projectRoot: string): void {
  const envPath = join(projectRoot, ".env");
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

const DEFAULTS: Omit<CopilotConfig, "sonioxApiKey" | "projectRoot"> = {
  language: "hu",
  runtimeDir: "/tmp/set-copilot",
  transcriptOutput: "/tmp/set-copilot/transcript.jsonl",
  dictationOutput: "/tmp/set-copilot/dictation.jsonl",
  sonioxMode: "rt",
  audio: { micSource: "", monitorSource: "", sampleRate: 16000, toneStart: "", toneEnd: "" },
  knowledge: {
    adapter: "markdown",
    sources: [],
    keywords: { partners: [], features: [] },
  },
};

export const CONFIG_FILENAME = "set-copilot.config.json";

/**
 * Load the effective config for a project.
 *
 * Resolution order (later wins): built-in defaults → config file → env overrides.
 * Secrets (SONIOX_API_KEY) come from env / .env only, never the committed config.
 */
export function loadConfig(projectRoot: string = process.cwd()): CopilotConfig {
  const root = resolve(projectRoot);
  loadDotEnv(root);

  let fileCfg: Partial<CopilotConfig> = {};
  const cfgPath = join(root, CONFIG_FILENAME);
  if (existsSync(cfgPath)) {
    try {
      fileCfg = JSON.parse(readFileSync(cfgPath, "utf-8")) as Partial<CopilotConfig>;
    } catch (err) {
      throw new Error(`[set-copilot] Failed to parse ${CONFIG_FILENAME}: ${(err as Error).message}`);
    }
  }

  const runtimeDir = process.env.SET_COPILOT_DIR || fileCfg.runtimeDir || DEFAULTS.runtimeDir;

  const cfg: CopilotConfig = {
    language: fileCfg.language ?? DEFAULTS.language,
    runtimeDir,
    transcriptOutput: fileCfg.transcriptOutput ?? join(runtimeDir, "transcript.jsonl"),
    dictationOutput: fileCfg.dictationOutput ?? join(runtimeDir, "dictation.jsonl"),
    sonioxApiKey: process.env.SONIOX_API_KEY || "",
    sonioxMode: (process.env.SONIOX_MODE as "rt" | "chunk") || fileCfg.sonioxMode || DEFAULTS.sonioxMode,
    audio: {
      micSource: process.env.MIC_SOURCE || fileCfg.audio?.micSource || DEFAULTS.audio.micSource,
      monitorSource: process.env.MONITOR_SOURCE || fileCfg.audio?.monitorSource || DEFAULTS.audio.monitorSource,
      sampleRate: fileCfg.audio?.sampleRate ?? DEFAULTS.audio.sampleRate,
      toneStart: fileCfg.audio?.toneStart || DEFAULTS.audio.toneStart,
      toneEnd: fileCfg.audio?.toneEnd || DEFAULTS.audio.toneEnd,
    },
    knowledge: {
      adapter: fileCfg.knowledge?.adapter ?? DEFAULTS.knowledge.adapter,
      sources: fileCfg.knowledge?.sources ?? DEFAULTS.knowledge.sources,
      decisions: fileCfg.knowledge?.decisions,
      decisionIdPrefix: fileCfg.knowledge?.decisionIdPrefix,
      keywords: {
        partners: fileCfg.knowledge?.keywords?.partners ?? [],
        features: fileCfg.knowledge?.keywords?.features ?? [],
      },
    },
    projectRoot: root,
  };

  return cfg;
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
