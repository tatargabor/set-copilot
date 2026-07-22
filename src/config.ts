import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, join } from "node:path";

import type { AlertCategory, KeywordPattern } from "./knowledge/types.js";
import type { WallConfig, Category, WallWindow } from "./wall/types.js";

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

/**
 * How much of a voice the copilot has.
 *
 * - `silent`      — only the high-priority categories. Nothing else, ever.
 * - `reactive`    — the default: speak when a category fires, otherwise say nothing.
 *                   A watcher, not a participant.
 * - `participant` — a third voice in the conversation. Still no filler, but it may
 *                   volunteer: confirm or refute a claim, add a fact the speakers
 *                   would want, bring background. Use when you WANT it talking.
 */
export type Engagement = "silent" | "reactive" | "participant";

/** What the copilot is allowed to speak up about, and how it should read the knowledge */
export interface CopilotPromptConfig {
  /**
   * Path to a project-owned markdown file loaded verbatim into the copilot's
   * context at session start — domain rules, tone, what matters in this project.
   */
  instructions?: string;
  /** Alert taxonomy. Defaults to contradiction / context / new decision / question. */
  alerts: AlertCategory[];
  /** How eagerly it speaks. Default "reactive". */
  engagement: Engagement;
  /** Max lines per contribution. Default 3 — raise it when you want reasoning, not just flags. */
  maxLines: number;
  /**
   * Allow WebSearch/WebFetch during the meeting (background research, fact-checking a
   * claim against the outside world). Off by default: it costs seconds, and most
   * meetings only need the project's own knowledge.
   */
  allowWebResearch: boolean;
  /**
   * The narrow feedback opening (design D1 of wall-feedback-and-replay). When on, the
   * copilot is NOT silent in two cases the engagement policy would otherwise mute:
   * when the mic speaker directly addresses it, and when it emits a wall visual (it
   * also writes a one-line chat echo of what it understood). Orthogonal to
   * `engagement`, which governs how eagerly it speaks about *content*. Default on:
   * a copilot whose only channel is a wall that may not visibly update looks broken
   * when it stays silent. Multi-party conversation policy is unchanged.
   */
  acknowledge: boolean;
  /**
   * The wall drawing contract (fork-wall-producer D2). Rendered into the policy
   * `set-copilot prompt` prints, so it is loaded ONCE at session start and every
   * producer fork inherits it from an already-cached prefix instead of having it
   * re-supplied on each emission. A fork's own prompt carries only its mandate.
   */
  drawing: DrawingContractConfig;
  /**
   * What the copilot answers to. Plain words, not regexes — naming one of these
   * marks the line `command: true`, and `poll` returns at once instead of waiting
   * for the silence gate. Default `["copilot"]`; add nicknames or slang freely
   * (`["copilot", "tesa"]`).
   *
   * Only address forms belong here. An imperative ("draw this") is ambiguous in a
   * meeting — usually aimed at another person — and a false positive costs a
   * wasted reaction. For anything more complex than a word, use `detect.command`,
   * which takes raw regexes and is merged with these.
   */
  names: string[];
}

/**
 * When a visual is warranted, and what the project wants drawn. The *categories*
 * live in `wall.categories` (already config) and are not duplicated here; the
 * *payload shapes* are engine mechanics and live in the renderer. This holds the
 * one genuinely project-specific part: the judgement about when to draw at all.
 */
export interface DrawingContractConfig {
  /** Render the contract into the prompt. Off for a project that never uses the wall. */
  enabled: boolean;
  /**
   * Project-owned drawing conventions, one bullet each, rendered verbatim. Replace
   * these to teach a project's own visual language without forking the skill.
   */
  conventions: string[];
}

/** Regex sources driving the per-line flags the copilot routes on */
export interface DetectionConfig {
  /** A match sets `urgency: "high"` on the transcript line */
  urgency: string[];
  /** A match sets `question: true` */
  question: string[];
  /**
   * A match sets `command: true` — the speaker is addressing the copilot and wants
   * a reaction NOW. `poll` returns immediately on such a line instead of waiting for
   * the silence event that closes a spoken thought unit.
   *
   * This is safe because a transcript line is already a complete sentence (the writer
   * flushes on `. ? !`); the silence gate is a second, redundant coherence check. It
   * is worth keeping for *ambient* listening, where the copilot infers rather than
   * obeys and reacting mid-thought is noisy — but not for a direct instruction.
   */
  command: string[];
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
  /** Speech-to-text backend: "soniox" (cloud, needs a key) or "whisper" (local whisper.cpp, free/offline) */
  sttBackend: "soniox" | "whisper";
  /** whisper.cpp settings, used only when sttBackend === "whisper" */
  whisper: {
    /** whisper.cpp CLI binary (default "whisper-cli") */
    bin: string;
    /** Path to a ggml model file (e.g. ggml-small.en.bin) */
    model: string;
  };
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
  /** The monitor-wall display: categories + windows + port, all config/data */
  wall: WallConfig;
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
  // Empty by default: the shipped trigger is the address form, which comes from
  // `copilot.names` and is merged in at load time. This list is the escape hatch
  // for a project that needs a pattern rather than a word.
  command: [],
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

/**
 * The out-of-the-box display model — Hungarian category labels because the
 * project is Hungarian, but the whole thing is data: a project replaces the
 * registry and the windows wholesale from config without touching `src/`.
 *
 * The copilot shows only *processed* output — there is deliberately no raw
 * transcript category. `súgás`/`riasztás` are `text`, `architektúra` is a
 * node/edge `graph`, `metrika` is a data `chart`. That is the whole render-type
 * vocabulary (text / graph / chart).
 */
export const DEFAULT_CATEGORIES: Category[] = [
  { id: "súgás", label: "Súgás", icon: "💡", render: "text" },
  { id: "riasztás", label: "Riasztás", icon: "⚠", render: "text" },
  { id: "architektúra", label: "Architektúra", icon: "🕸", render: "graph" },
  { id: "metrika", label: "Metrika", icon: "📊", render: "chart" },
];

// Slots stack top-to-bottom (one column). The private view keeps the alert
// pinned, scrolls processed hints, and gives the graph the hero space with the
// chart beneath; the public wall shows only the shared graph + chart.
export const DEFAULT_WINDOWS: WallWindow[] = [
  {
    name: "én",
    route: "/",
    zones: ["private", "both"],
    slots: [
      { area: "pinned", behavior: "latest", cats: ["riasztás"] },
      { area: "hints", behavior: "scroll", cats: ["súgás"] },
      { area: "canvas", behavior: "latest", cats: ["architektúra"], pacing: { minDwellMs: 8000, crossFadeMs: 400 } },
      { area: "chart", behavior: "latest", cats: ["metrika"] },
    ],
  },
  {
    name: "fal",
    route: "/wall",
    zones: ["public", "both"],
    slots: [
      { area: "canvas", behavior: "latest", cats: ["architektúra"], pacing: { minDwellMs: 8000, crossFadeMs: 400 } },
      { area: "chart", behavior: "latest", cats: ["metrika"] },
    ],
  },
];

/**
 * When drawing is worth a fork at all. Deliberately about *judgement*, not
 * mechanics — the mechanics (payload shapes, the emit command) are engine facts
 * rendered alongside these. A project replaces this list to teach its own visual
 * language; the shipped defaults encode the one lesson the Haiku-worker prototype
 * cost us: an ungrounded producer draws everything and the result is a hairball.
 */
export const DEFAULT_DRAWING_CONVENTIONS: string[] = [
  "Draw when the *structure* of what was said is the point — components and how they relate, a sequence, a comparison of quantities. Prose that is already clear in chat does not need a picture.",
  "Prefer few nodes that carry the argument over many that are merely true. A diagram with everything in it says nothing; if it exceeds roughly a dozen nodes, you are transcribing, not drawing.",
  "People, side threads, and scheduling are not architecture. Leave them out of the graph.",
  "Redraw when the understanding changed, not when new words arrived. An unchanged picture is a correct picture.",
  "A number is a chart only when it is comparable to another number. A single figure belongs in text.",
];

export const DEFAULT_WALL: WallConfig = {
  port: 4180,
  categories: DEFAULT_CATEGORIES,
  windows: DEFAULT_WINDOWS,
};

/** The default name — the copilot answers to itself unless a project renames it. */
export const DEFAULT_NAMES: string[] = ["copilot"];

/**
 * Turn a name the copilot answers to into a detector pattern.
 *
 * A leading Unicode boundary (never `\b`, which treats `á` as a boundary and breaks
 * every accented language) and NO trailing one: Hungarian agglutinates, so
 * "copilotot" / "copilottal" must match the same stem. The name itself is escaped -
 * it is a word from config, not a pattern, and `c++` must not compile as a quantifier.
 *
 * Known limit: a name ending in a vowel changes stem when suffixed (tesa -> tesa-with-
 * accent), so only its bare form matches. Guessing at morphology would buy false
 * positives; configure both forms instead.
 */
export function namePattern(name: string): string {
  const escaped = name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return `(?<=^|[^\\p{L}\\p{N}])${escaped}`;
}

const DEFAULTS: Omit<CopilotConfig, "sonioxApiKey" | "projectRoot"> = {
  language: "en",
  runtimeDir: "/tmp/set-copilot",
  transcriptOutput: "/tmp/set-copilot/transcript.jsonl",
  dictationOutput: "/tmp/set-copilot/dictation.jsonl",
  sonioxMode: "rt",
  sttBackend: "soniox",
  whisper: { bin: "whisper-cli", model: "" },
  audio: { micSource: "", monitorSource: "", sampleRate: 16000, toneStart: "", toneEnd: "" },
  knowledge: {
    adapter: "markdown",
    sources: [],
    keywords: [],
    autoKeywords: true,
    deferredMarkers: DEFAULT_DEFERRED_MARKERS,
  },
  copilot: {
    alerts: DEFAULT_ALERTS,
    engagement: "reactive",
    maxLines: 3,
    allowWebResearch: false,
    acknowledge: true,
    drawing: { enabled: true, conventions: DEFAULT_DRAWING_CONVENTIONS },
    names: DEFAULT_NAMES,
  },
  detect: DEFAULT_DETECT,
  wall: DEFAULT_WALL,
};

const ENGAGEMENTS: Engagement[] = ["silent", "reactive", "participant"];

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
  // Resolved once: the names feed both `copilot.names` (what the policy shows) and
  // `detect.command` (what flags the line).
  const resolvedNames = Array.isArray(copilot.names)
    ? copilot.names.filter((n): n is string => typeof n === "string" && !!n.trim())
    : DEFAULT_NAMES;
  const detect = { ...userCfg.detect, ...projCfg.detect };
  const wall = { ...userCfg.wall, ...projCfg.wall };

  const runtimeDir = process.env.SET_COPILOT_DIR || fileCfg.runtimeDir || DEFAULTS.runtimeDir;
  const mode = process.env.SONIOX_MODE || fileCfg.sonioxMode || DEFAULTS.sonioxMode;

  return {
    language: process.env.SET_COPILOT_LANGUAGE || fileCfg.language || DEFAULTS.language,
    runtimeDir,
    transcriptOutput: fileCfg.transcriptOutput ?? join(runtimeDir, "transcript.jsonl"),
    dictationOutput: fileCfg.dictationOutput ?? join(runtimeDir, "dictation.jsonl"),
    sonioxApiKey: process.env.SONIOX_API_KEY || "",
    sonioxMode: mode === "chunk" ? "chunk" : "rt",
    sttBackend: (process.env.STT_BACKEND || fileCfg.sttBackend) === "whisper" ? "whisper" : "soniox",
    whisper: {
      bin: process.env.WHISPER_BIN || fileCfg.whisper?.bin || DEFAULTS.whisper.bin,
      // Default model lives under the user config dir, so `init` + docs can point
      // users at a single drop-in location and whisper mode works with no config.
      model: process.env.WHISPER_MODEL || fileCfg.whisper?.model || join(userConfigDir(), "models", "ggml-small.en.bin"),
    },
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
      engagement: ENGAGEMENTS.includes(copilot.engagement as Engagement)
        ? (copilot.engagement as Engagement)
        : DEFAULTS.copilot.engagement,
      maxLines:
        typeof copilot.maxLines === "number" && copilot.maxLines > 0
          ? Math.floor(copilot.maxLines)
          : DEFAULTS.copilot.maxLines,
      allowWebResearch: copilot.allowWebResearch === true,
      acknowledge: copilot.acknowledge !== false,
      drawing: {
        enabled: copilot.drawing?.enabled !== false,
        // An empty array is a deliberate "no conventions", not a missing key — only
        // an absent/malformed list falls back, mirroring how detect.* handles this.
        conventions: Array.isArray(copilot.drawing?.conventions)
          ? copilot.drawing.conventions.filter((c): c is string => typeof c === "string")
          : DEFAULT_DRAWING_CONVENTIONS,
      },
      names: resolvedNames,
    },
    detect: {
      urgency: detect.urgency?.length ? detect.urgency : DEFAULT_DETECT.urgency,
      question: detect.question?.length ? detect.question : DEFAULT_DETECT.question,
      // Names are the friendly front door, detect.command the raw-regex one; both
      // set the same flag, so they merge rather than override.
      command: [...resolvedNames.map(namePattern), ...(detect.command ?? [])],
    },
    wall: {
      // Categories/windows are validated where they are consumed (resolveCategories,
      // the server), so a bad entry drops with a warning instead of failing the load.
      port: typeof wall.port === "number" && wall.port > 0 ? wall.port : DEFAULT_WALL.port,
      categories: Array.isArray(wall.categories) ? wall.categories : DEFAULT_WALL.categories,
      categoriesModule: wall.categoriesModule,
      windows: Array.isArray(wall.windows) ? wall.windows : DEFAULT_WALL.windows,
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
