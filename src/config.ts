import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, join } from "node:path";

import type { AlertCategory, KeywordPattern } from "./knowledge/types.js";
import type { WallConfig, Category, WallLayout, WallWindow, RedactionConfig } from "./wall/types.js";
import { compileRedactor } from "./wall/redaction.js";

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
  /**
   * The presentation this meeting is about — files or globs, `.md`/`.txt`/`.html`.
   *
   * Separate from `sources` because a deck is *ordered* and its slides are *citable*: an
   * alert that names the knowledge base cannot be acted on mid-meeting, one that names
   * slide 11 can. Empty by default; a project without a deck is unchanged.
   */
  deck: string[];
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
   * The continuous-narration channel (live-narration D2). When enabled, the copilot
   * writes a running, substantive commentary of what is being discussed into the
   * private `narráció` box on a regular cadence — a separate channel from the
   * event-triggered alert taxonomy, and independent of `engagement`. Default on and
   * louder than the reactive silence users complained about; disabling it restores the
   * pre-change reactive behavior byte-for-byte.
   */
  narration: NarrationConfig;
  /**
   * Chat→wall mirroring (wall-chat-mirror). When enabled, the copilot also emits its
   * substantive chat lines to the wall (as `mirror.category` text), through the same
   * redaction funnel as any event. Off by default: mirroring is an explicit, session-level
   * opt-in, so the chat-primary / wall-secondary separation is preserved unless asked for.
   */
  mirror: MirrorConfig;
  /**
   * A project command `stop` runs AFTER the transcript is archived and the derived
   * artifacts are written — the seam that lets a project hand its transcript on
   * (out of the gitignored runtime dir, into its own inputs) without forking the
   * meeting-copilot skill. Absent by default; absent means today's handover exactly.
   *
   * It cannot fail the handover: a non-zero exit, a missing executable or a timeout is
   * reported and the archived path still returned, on the same reasoning `stitchOnStop`
   * follows — the `renameSync` is the invariant, everything after it is convenience.
   *
   * The paths arrive as environment variables (`SET_COPILOT_TRANSCRIPT`,
   * `…_TRANSCRIPT_MD`, `…_TRANSCRIPT_JSONL`, `SET_COPILOT_DIR`) rather than as
   * placeholders: the values are file paths, and substituting them into a shell string
   * is a quoting bug waiting for the first space. `COPILOT_HANDOVER_SLUG` is passed
   * through when set, because the meeting's topic is the session's knowledge, not the
   * capture's — the skill runs `COPILOT_HANDOVER_SLUG=<topic> set-copilot stop`.
   */
  handoverCommand?: string;
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

/**
 * Chat→wall mirroring (wall-chat-mirror). When enabled, the copilot echoes its
 * substantive chat lines to a wall text box (via the `category` below), so a wall
 * audience can also read the chat — the primary voice. It is judgement-gated like every
 * other channel: only substantive lines, never filler, and a mirrored line goes through
 * the SAME server-side ingest redaction as any event. Off by default — the chat-primary /
 * wall-secondary separation stays the norm; an operator opts in for a session.
 */
export interface MirrorConfig {
  /** Mirror chat to the wall at all. Default off. */
  enabled: boolean;
  /** Which text category a mirrored line is emitted under. Default "tükör". */
  category: string;
  /** Below this many characters a message is filler and is not mirrored. Default 40. */
  minLength: number;
  /** A mirrored line is truncated to this many characters. Default 600. */
  maxLength: number;
  /**
   * Regex sources for progress/acknowledgement phrases that are never wall material
   * ("dolgozom rajta", "working on it", "csendben hallgatok"). Matched against the WHOLE
   * trimmed message, not as a substring anywhere — a legitimate message that happens to
   * contain such a phrase still reaches the wall.
   *
   * Like `detect.*` this is a language fact, so it is config with HU+EN defaults, an
   * invalid entry is dropped with a warning rather than breaking mirroring, and — like
   * `transcript.completeWords` — an explicitly EMPTY list is honoured as a deliberate
   * "length floor only". Nothing leaks by suppressing less, so "no rules" is safe here;
   * the opposite of `wall.redaction`.
   */
  fillerPhrases: string[];
  /**
   * What happens to a fenced code block in a mirrored message. Default `keep`: a coding
   * copilot's message is largely code, and the hook used to discard every block
   * unconditionally, which defeated the purpose of mirroring. `collapse` renders each
   * block as a one-line marker for a meeting-facing project that finds code noisy.
   */
  codeBlocks: "keep" | "strip" | "collapse";
}

/** How talkative the continuous-narration channel is. Rendered into the policy mandate. */
export type NarrationVerbosity = "terse" | "normal" | "rich";

/**
 * The continuous-narration channel (live-narration D2). Verbosity is *policy*, rendered
 * into the prompt by `copilot-prompt.ts`, never a regex in `src/` — a project raises,
 * lowers, or disables narration from config without forking the skill or the engine.
 * The default is deliberately louder than today's reactive silence (the single loudest
 * complaint across three sessions); disabling it makes the policy output and runtime
 * behavior byte-for-byte the pre-change reactive behavior. Orthogonal to `engagement`,
 * which governs how eagerly the copilot speaks *in chat* about content.
 */
export interface NarrationConfig {
  /** Emit the narration channel at all. Default on. */
  enabled: boolean;
  /** How much it narrates — rendered into the mandate. Default "normal". */
  verbosity: NarrationVerbosity;
  /** Max lines per narration emission. Default 1 — one substantive line per batch. */
  maxLines: number;
}

/**
 * A box's own slice of content policy (design D5).
 *
 * Every field is optional and overrides the session-global `copilot.*` value for
 * that box alone; a box declaring nothing inherits the global policy unchanged, so
 * a config written before boxes existed behaves exactly as it did. The merge is
 * key by key, not wholesale — otherwise every box would have to restate the entire
 * alert taxonomy just to change one instruction, and the copies would drift.
 *
 * This is what makes the private and the public text box differ in *mandate*
 * rather than only in zone: the private one checks and surfaces, the public one
 * narrates.
 */
export interface BoxPolicy {
  /** Markdown path or inline text, same as `copilot.instructions`. */
  instructions?: string;
  /** Alert taxonomy for this box only. */
  alerts?: AlertCategory[];
  /** How eagerly this box is fed. */
  engagement?: Engagement;
  /** Max lines per contribution to this box. */
  maxLines?: number;
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

/**
 * Post-processing of a finished transcript: turning the capture's fragments back
 * into sentences. Everything here is a seam, for the usual reason — the shipped
 * `completeWords` list is a *language* fact, not an engine one, and a project
 * working in Portuguese must be able to replace it without touching `src/`.
 */
export interface TranscriptConfig {
  /** Channel → display name in the readable transcript ("mic" → "Gábor") */
  speakers: Record<string, string>;
  /** Produce the readable + structured artifacts at stop (default true) */
  stitchOnStop: boolean;
  /**
   * High-frequency words that are COMPLETE on their own. Used only by the heuristic
   * fallback, for recordings that predate `cont`/`midWord`: if either side of a join
   * is one of these, the cut was at a word boundary, so the parts take a space.
   */
  completeWords: string[];
  /** A gap at least this long between two fragments is a word boundary (heuristic only) */
  pauseGapMs: number;
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
  /** Post-processing of a finished transcript (the stitch) */
  transcript: TranscriptConfig;
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
 * Words that stand complete on their own — the dictionary behind the stitch's
 * heuristic word-boundary fallback. English + Hungarian out of the box, matching
 * `detect.*`; a project in another language replaces the list via
 * `transcript.completeWords`.
 *
 * Function words, deliberately: the heuristic asks "could this fragment end (or
 * start) a real word?", and the words that most often sit at a flush boundary are
 * the high-frequency short ones. Domain nouns are the wrong population — they are
 * exactly what the keyword index holds, and exactly what does NOT help here.
 */
export const DEFAULT_COMPLETE_WORDS = (
  // hu
  "a az egy és de hogy nem is meg már még csak akkor ez ezt azt ott itt van volt lesz kell " +
  "új jó hát így úgy mert vagy ha mi mit ki ő te én ne se sem aminek amit ami aki végül majd " +
  "most pedig vissza össze át el be fel le szerintem igen persze tehát ugye aha ilyen olyan " +
  "minden nagyon lehet kicsit vagyis illetve szóval " +
  // en
  "a an the and or but so if then that this these those is are was were be been will would " +
  "can could should i you we they it he she not no yes ok okay just now well right yeah " +
  "for to of in on at with from by about up down out here there what why how when who which"
).split(" ");

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
 * transcript category, and the public narration box does not reintroduce one: it
 * emits condensed, filtered output, not a transcript mirror. `súgás`/`riasztás`
 * are `text`, `architektúra` is a node/edge `graph`, `metrika` is a data `chart`.
 *
 * The render-type vocabulary is text / graph / chart / image / webpage, and it is
 * closed: it lives in `RenderType` (`wall/types.ts`), so adding one is an engine
 * change, not something a project can do from config.
 */
export const DEFAULT_CATEGORIES: Category[] = [
  { id: "súgás", label: "Súgás", icon: "💡", render: "text" },
  { id: "riasztás", label: "Riasztás", icon: "⚠", render: "text" },
  // The narration channel — one category, zone-differentiated (live-narration + the
  // public narration box share it). Private-zone narration is the copilot's running,
  // substantive commentary of what is being discussed, shown in the private text box;
  // `both`/`public`-zone narration is the *processed* (condensed, filtered) audience
  // line that goes out through public-zone redaction. Never a raw transcript either
  // way. See DEFAULT_WINDOWS, the live-narration spec, and the box-policy spec.
  { id: "narráció", label: "Narráció", icon: "🗣", render: "text" },
  { id: "architektúra", label: "Architektúra", icon: "🕸", render: "graph" },
  { id: "metrika", label: "Metrika", icon: "📊", render: "chart" },
  // The predictive-staging channel (predictive-staging). A visual drawn AHEAD during a
  // `silence` window lands here in the PRIVATE staging box as `zone:"private"`, and only
  // an explicit promote lifts it to the public presentation box. A guess never publishes
  // itself: "prepared, not published". See DEFAULT_WINDOWS and the predictive-staging spec.
  { id: "előrejelzés", label: "Előrejelzés", icon: "🔮", render: "graph" },
  // The chat-mirror channel (wall-chat-mirror). When mirroring is enabled, the copilot
  // echoes its substantive chat lines here as `text`, so a wall audience can also read the
  // chat — the primary voice. A dedicated category (not `narráció`) so mirroring and
  // narration coexist and are zoned independently. Off by default: no `tükör` event is
  // emitted unless mirroring is turned on, so the extra subscription is inert until then.
  { id: "tükör", label: "Tükör", icon: "🪞", render: "text" },
  // The pinned reference channel (wall-three-region-layout). Everything else on the wall
  // flows; this one stays. Measured on a live meeting: the scrolling log buried the open
  // questions list ("kurvára keresem az öt nyitott kérdést"), because every shipped layout
  // gave the text stream a `scroll` box and nothing that survives it. A DEDICATED category
  // (not `súgás`/`narráció`) so that pinning something is an explicit producer choice and a
  // project can route it elsewhere purely in config.
  { id: "kitűzött", label: "Kitűzött", icon: "📌", render: "text" },
];

/**
 * The named layouts. Geometry only — which positions exist and how they sit — so a
 * window is reshaped by swapping an id, not by rewriting its content.
 *
 * `stacked` preserves the pre-layout arrangement (one column, top to bottom) and
 * is the rollback target if the horizontal default turns out wrong on someone's
 * screen. Neither declares `rows`, so row sizing still follows box behavior, which
 * is what keeps `stacked` byte-identical to what the wall did before layouts.
 */
export const DEFAULT_LAYOUTS: WallLayout[] = [
  { id: "stacked", areas: [["szöveg"], ["prezentáció"]] },
  { id: "third-two-thirds", areas: [["szöveg", "prezentáció"]], columns: ["1fr", "2fr"] },
  { id: "prezentáció-teljes", areas: [["prezentáció"]] },
  // The private view's layout with a staging lane along the bottom (predictive-staging).
  // Geometry only: a full-width row under the text + presentation, where a pre-drawn
  // prediction waits privately until it is promoted.
  { id: "private-staging", areas: [["szöveg", "prezentáció"], ["staging", "staging"]], columns: ["1fr", "2fr"], rows: ["2fr", "1fr"] },
  // The chat-wide layout (wall-chat-mirror): a big left column for the mirrored chat, an
  // equal right column for the visuals. Named `chat-wide`, NOT `mirror`, on purpose — a
  // field session proved that a `mirror` LAYOUT id collides with the `copilot.mirror`
  // FEATURE and cost real confusion (operator switched the layout, thought the echo was on,
  // wall stayed empty). Geometry only, and it reuses the `szöveg`/`prezentáció` position
  // names the default windows already assign, so switching a live window to it at runtime
  // maps its existing boxes with no reassignment and leaves NO unfilled dead region. (A
  // dedicated pinned "summary" box is deliberately deferred — see the wall backlog — rather
  // than shipped here as an empty third region.)
  { id: "chat-wide", areas: [["szöveg", "prezentáció"]], columns: ["1fr", "1fr"] },
  // The three-region layout the operator described (wall-three-region-layout): the message
  // stream down the left, the drawable canvas top-right, a PINNED text box under it — "és
  // ez a hármas felosztás azt gondolom, hogy ez körülbelül mindenre elég."
  //
  // `szöveg` spans both rows ON PURPOSE: it is one region, not a box per row. Splitting the
  // stream across two boxes would make "where is the newest line?" ambiguous, which is the
  // opposite of the continuous message wall that was asked for.
  //
  // The tracks are explicit rather than behavior-derived (`rowSize`), because a layout that
  // declares `rows` should own them: the canvas is the hero at `2fr`, the pinned box takes
  // what is left. This is also the first shipped layout with a multi-cell position — the
  // rectangularity check in `badLayout` exists because of it.
  {
    id: "három-régió",
    areas: [["szöveg", "prezentáció"], ["szöveg", "kitűzött"]],
    columns: ["1fr", "1fr"],
    rows: ["2fr", "1fr"],
  },
];

/**
 * Two boxes, not four slots: text on the left third, presentation on the right two
 * thirds. The presentation box takes both the graph and the chart category —
 * legal, and the point of the change, because the renderer follows the event's
 * payload rather than the box's subscription.
 *
 * The private view (`/`) gets a hint text box; the public wall (`/wall`) gets a
 * NARRATION text box plus the presentation. The public text box was pulled once —
 * it only makes sense with public-zone redaction, which an adversarial pass had
 * found leaky — and returns here now that the `public-redaction` capability lands
 * with it: every `both`/`public` event the narration box emits passes through the
 * server-side redactor before any public client sees it (box-policy: "A public
 * narration box narrates processed output").
 *
 * Both text boxes carry a `policy`, and they differ in *mandate*, not just zone
 * (design D5): the private one checks and surfaces contradictions; the public one
 * narrates *processed* output — condensed, filtered, redaction-safe — never the raw
 * transcript, preserving the "wall shows only processed output" invariant above.
 */
export const DEFAULT_WINDOWS: WallWindow[] = [
  {
    name: "én",
    route: "/",
    zones: ["private", "both"],
    // Who is watching, stated — not inferred from the zone list (wall-public-surface D1/D2).
    // This is the operator's own screen: no redaction, private events delivered. It is
    // declared rather than left to the default precisely because the default is now the
    // protected reading; an undeclared window would be treated as a public wall.
    audience: "operator",
    layout: "private-staging",
    boxes: {
      szöveg: {
        behavior: "scroll",
        cats: ["riasztás", "súgás", "narráció", "tükör"],
        policy: {
          instructions:
            "Ez a privát súgódoboz. Ellenőrizd, amit a beszélő mond, és hozd felszínre, amit nem tud, ÉS amit mindjárt tudnia kell: ellentmondás a rögzített döntésekkel, releváns kontextus, rögzítésre érdemes új döntés — és egy `silence`-ablakban egy-két lépéssel előre, merre tart a beszélgetés. A `narráció`-sorok folyamatos, tartalmi kísérőszöveget adnak arról, ami épp zajlik — az alertektől külön csatorna.",
        },
      },
      prezentáció: {
        behavior: "latest",
        cats: ["architektúra", "metrika"],
        pacing: { minDwellMs: 8000, crossFadeMs: 400 },
      },
      staging: {
        behavior: "latest",
        cats: ["előrejelzés"],
        pacing: { minDwellMs: 4000, crossFadeMs: 400 },
        policy: {
          // The predictive mandate lives in this box's policy (config, not `src/`):
          // prepare ahead, privately. Promotion to the public wall is a separate,
          // explicit gate — "prepared, not published" (predictive-staging D1/D5).
          instructions:
            "Ez a privát staging-doboz. A `silence`-ablakban rajzold ELŐRE a valószínű következő vizuált ide, `zone:\"private\"`, `staged:true` — ez felkészülés, nem publikálás. A publikus falra csak explicit promote emeli, ha a beszélgetés tényleg odaér. Egy fel nem használt jóslat elévül; ne üljön itt zajként.",
        },
      },
    },
  },
  {
    name: "fal",
    route: "/wall",
    zones: ["public", "both"],
    // The shared screen. Redaction on, private events never delivered — and now that is
    // what the window SAYS, so widening `zones` to show more can no longer switch it off.
    audience: "public",
    // The three-region layout lands on the PUBLIC wall (wall-three-region-layout): this is
    // where the operator wants the tasks pinned on the shared screen, and unlike the
    // private view there is no staging lane to give up for it. The private view keeps
    // `private-staging` and can switch at runtime with `wall-layout / három-régió` — the
    // layout is geometry, so the switch costs nothing but the staging lane.
    layout: "három-régió",
    boxes: {
      szöveg: {
        behavior: "scroll",
        cats: ["narráció", "tükör"],
        policy: {
          // Mandate, not zone, is what distinguishes this box from the private one
          // (box-policy). Its output is *processed* — condensed and filtered — and it
          // relies on the server-side redactor for safety, not on being careful.
          engagement: "reactive",
          instructions:
            "Ez a nyilvános narráló doboz — élő közönség láthatja. Foglald össze tömören, közönség-barátul, amiről szó van; ne a nyers átiratot közvetítsd. Belső részletet SOHA ne írj ki nyersen: jelöld `[belső]`-vel (a szerver kitakarja), vagy hagyd ki. Kétség esetén hagyd ki.",
          maxLines: 2,
        },
      },
      prezentáció: {
        // Also subscribes to `előrejelzés`: a staged prediction is private and never
        // reaches here on its own, but a PROMOTED one (lifted to a public zone) surfaces
        // in this public presentation box — the promote target (predictive-staging D3).
        behavior: "latest",
        cats: ["architektúra", "metrika", "előrejelzés"],
        pacing: { minDwellMs: 8000, crossFadeMs: 400 },
      },
      kitűzött: {
        // `latest` and deliberately NO pacing. `rowSize` reads `latest` + pacing as "this is
        // the paced hero canvas"; more importantly, a pacing-driven swap would be exactly the
        // "content moves on its own" behavior this region exists to prevent. Its geometry
        // comes from the layout's explicit `rows` anyway, so pacing would buy nothing.
        //
        // No new behavior kind was invented: `latest` already means replace-on-newer, which
        // is all a pinned box needs. `pinned` would be a synonym with a migration attached.
        behavior: "latest",
        cats: ["kitűzött"],
        policy: {
          instructions:
            "Ez a KITŰZÖTT doboz — ami ide kerül, ott is marad, a folyó üzenetek soha nem görgetik el. Ide a hivatkozási tartalom való: napirend, nyitott kérdések, rögzített döntések, feladatok. FONTOS: ez a doboz a teljes tartalmat CSERÉLI, nem fűzi hozzá — mindig a teljes blokkot küldd ki, különben a többi pont eltűnik. Ritkán frissítsd: ez nem egy második üzenetfolyam, hanem az, ami akkor is látszik, amikor a beszélgetés elment mellette.",
        },
      },
    },
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

/**
 * The shipped redaction taxonomy — deliberately domain-neutral (public-redaction:
 * "The default carries no project-specific vocabulary"). It matches only a *marking
 * convention*: an operator or the producer flags an internal span with `[belső]` /
 * `[internal]` (design D8, taught to the producer in the drawing contract), and
 * everything from the marker to the end of that string leaf is scrubbed on the way
 * to the public wall. No project names, no PII heuristics — a richer taxonomy is
 * opt-in `wall.redaction` config, so a fresh project never redacts against another
 * project's assumptions.
 *
 * The pattern uses literal brackets, not `\b`, so it is accent-safe by construction;
 * the engine compiles it with the `u` flag regardless.
 */
export const DEFAULT_REDACTION: RedactionConfig = {
  patterns: ["\\[(?:belső|internal)[^\\]]*\\][^\\n]*"],
  replacement: "[…]",
  // The length cap is the second half of the ReDoS bound (the first is the engine's
  // group-rejection + ≤2-unbounded-quantifier limit, which caps a pattern's worst-case
  // backtracking at quadratic). Quadratic × 1000² keeps even a deliberately
  // overlapping-quantifier config pattern (`\d+\d+$`) to a fraction of a second per leaf
  // — bounded, not the multi-second/minute stalls an unbounded pattern produces. A
  // content leaf longer than this is withheld fail-closed, which is fine: narration,
  // labels, captions, and titles are short; a 1000-char leaf is anomalous.
  //
  // Note: redaction patterns come only from config (never a producer or the transcript),
  // so this bounds a self-inflicted operator footgun, not a remote input. A project that
  // wants a HARD linear guarantee can swap the regex engine for a linear one (re2); the
  // taxonomy is config, the engine choice is a localized change in `redaction.ts`.
  maxInputLength: 1_000,
};

/** Recent scroll lines per category kept for connect-time replay (wall-scroll-replay). */
export const DEFAULT_SCROLL_HISTORY = 20;

/** How long a staged prediction stays promotable before it expires (predictive-staging). */
export const DEFAULT_STAGING_TTL_MS = 120_000;

export const DEFAULT_WALL: WallConfig = {
  port: 4180,
  categories: DEFAULT_CATEGORIES,
  redaction: DEFAULT_REDACTION,
  scrollHistory: DEFAULT_SCROLL_HISTORY,
  staging: { ttlMs: DEFAULT_STAGING_TTL_MS },
  layouts: DEFAULT_LAYOUTS,
  windows: DEFAULT_WINDOWS,
};

/**
 * Progress/acknowledgement phrases that are never wall material, HU + EN.
 *
 * These are regex sources matched against the WHOLE message (see `MirrorConfig`), so a
 * fragment is enough — `dolgozom` matches "Dolgozom rajta." but not a sentence that
 * merely mentions it. Word boundaries, where needed, use Unicode classes (`\p{L}\p{N}`)
 * and never `\b`, which treats `á` as a boundary and breaks every accented language.
 *
 * The operator's ask, verbatim: *"a fölösleges folyamatos visszajelző, várakozó
 * szövegsorok — ez a 'folyamatban', 'várok', 'csendben hallgatok' — ezek nélkül."*
 */
export const DEFAULT_FILLER_PHRASES: string[] = [
  // Progress statements. `[^.!?]*` lets the phrase carry the rest of ITS OWN sentence
  // ("Dolgozom rajta, mindjárt jelentkezem.") but stops at a sentence end — a message that
  // says it is working AND then says something is substantive and reaches the wall.
  "(dolgozom|folyamatban|megnézem|megnezem|nézem|nezem|várok|varok|figyelek|hallgatok|csendben)[^.!?]*",
  "(working on it|in progress|on it|one moment|standing by|listening|waiting|checking)[^.!?]*",
  // Bare acknowledgements. Deliberately NOT allowed a trailing clause: "Rendben, akkor a
  // következő lépés …" is a normal way to open a substantive line, so only the bare form
  // (plus punctuation) counts as filler here.
  "(rendben|oké|oke|értem|ertem|kész|kesz|megvan|persze)",
  "(ok|okay|done|got it|understood|sure|noted)",
];

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

/**
 * Exported for the setup diagnostics: the known-key set is DERIVED from this object
 * (`knownConfigKeys`), so a new config key cannot drift out of the checker.
 */
export const DEFAULTS: Omit<CopilotConfig, "sonioxApiKey" | "projectRoot"> = {
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
    deck: [],
  },
  copilot: {
    alerts: DEFAULT_ALERTS,
    engagement: "reactive",
    maxLines: 3,
    allowWebResearch: false,
    acknowledge: true,
    drawing: { enabled: true, conventions: DEFAULT_DRAWING_CONVENTIONS },
    narration: { enabled: true, verbosity: "normal", maxLines: 1 },
    mirror: {
      enabled: false,
      category: "tükör",
      minLength: 40,
      maxLength: 600,
      fillerPhrases: DEFAULT_FILLER_PHRASES,
      codeBlocks: "keep",
    },
    names: DEFAULT_NAMES,
  },
  detect: DEFAULT_DETECT,
  wall: DEFAULT_WALL,
  transcript: {
    speakers: {},
    stitchOnStop: true,
    completeWords: DEFAULT_COMPLETE_WORDS,
    pauseGapMs: 2500,
  },
};

const ENGAGEMENTS: Engagement[] = ["silent", "reactive", "participant"];
const NARRATION_VERBOSITIES: NarrationVerbosity[] = ["terse", "normal", "rich"];

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
/** Deck paths: a list of strings, or nothing. Anything else is dropped, loudly. */
export function normalizeDeck(raw: unknown, warn: (m: string) => void = console.warn): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    warn("[set-copilot] knowledge.deck must be a list of paths or globs — ignoring it");
    return [];
  }
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry === "string" && entry.trim()) out.push(entry);
    else warn(`[set-copilot] knowledge.deck: dropping non-string entry ${JSON.stringify(entry)}`);
  }
  return out;
}

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

/**
 * Keep the filler phrases that actually compile, drop the rest with a warning.
 *
 * Same posture as `compileDetector` for `detect.*`: these are user-supplied patterns on a
 * display path, so one bad entry must not break mirroring for the whole session. The `u`
 * flag matches how the phrases are used at match time, so a pattern that only fails under
 * Unicode mode is caught here rather than at the first turn of a live meeting.
 */
/**
 * `copilot.handoverCommand`, or undefined. A present-but-unusable value is a warning, not
 * a throw: this command runs after the archive, and nothing it can be must be able to stop
 * a transcript from being handed over.
 */
function validHandoverCommand(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  // An empty string is "not configured", silently — the same idiom the shipped example
  // config already uses for `copilot.instructions`, so the key can sit in the example as
  // its own documentation without warning on every load.
  if (typeof raw === "string") return raw.trim() || undefined;
  console.warn(`[set-copilot] Ignoring malformed copilot.handoverCommand: ${JSON.stringify(raw)}`);
  return undefined;
}

function validFillerPhrases(raw: unknown[]): string[] {
  const good: string[] = [];
  for (const p of raw) {
    if (typeof p !== "string" || !p.trim()) {
      console.warn(`[set-copilot] Ignoring malformed copilot.mirror.fillerPhrases entry: ${JSON.stringify(p)}`);
      continue;
    }
    try {
      new RegExp(p, "iu");
      good.push(p);
    } catch (err) {
      console.warn(
        `[set-copilot] Ignoring invalid copilot.mirror.fillerPhrases pattern ${JSON.stringify(p)}: ${(err as Error).message}`,
      );
    }
  }
  return good;
}

/**
 * Does this whole message read as filler?
 *
 * Anchored to the WHOLE trimmed message, never substring-present-anywhere: a legitimate
 * message that happens to contain "rendben" must still reach the wall. Trailing
 * punctuation is allowed so "Rendben." and "Ok!" classify like their bare forms.
 *
 * Exported because both the CLI (which hands the resolved policy to the hook) and the
 * tests need the one definition — the hook must never grow a second one.
 */
export function isFillerMessage(text: string, phrases: string[]): boolean {
  const trimmed = text.trim();
  if (!trimmed || !phrases.length) return false;
  for (const p of phrases) {
    try {
      if (new RegExp(`^[\\p{P}\\s]*(?:${p})[\\p{P}\\s]*$`, "iu").test(trimmed)) return true;
    } catch { /* already validated at load; a survivor that throws here is simply not a match */ }
  }
  return false;
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
  const transcript = { ...userCfg.transcript, ...projCfg.transcript };
  // Resolve redaction patterns fail-SAFE: this is a safety seam feeding a public
  // narration box that ships enabled, so it must never resolve to "no redaction". An
  // empty list is the obvious case; the subtler one is a non-empty list whose entries
  // are all regex-invalid or all repeated-group (ReDoS) — those pass a `typeof string`
  // filter but COMPILE to zero, which would silently publish raw. So the fallback is
  // keyed on the effective COMPILED count, not on the string count: if nothing usable
  // survives, fall back to the shipped marking convention (which compiles to one), loudly.
  const stringPatterns = Array.isArray(wall.redaction?.patterns)
    ? wall.redaction!.patterns.filter((p): p is string => typeof p === "string")
    : [];
  const candidatePatterns = stringPatterns.length ? stringPatterns : DEFAULT_REDACTION.patterns;
  const compiledCount = compileRedactor(
    { patterns: candidatePatterns, replacement: "", maxInputLength: 1 },
    () => { /* warnings are surfaced when the server compiles for real */ },
  ).patternCount;
  const resolvedPatterns = compiledCount > 0 ? candidatePatterns : DEFAULT_REDACTION.patterns;
  if (compiledCount === 0) {
    console.warn(
      "[set-copilot] wall.redaction: no usable pattern survived compilation (all invalid or ReDoS-rejected) — falling back to the default [belső]/[internal] marking convention so the public zone is never left unredacted",
    );
  }

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
      // A malformed value is dropped with a warning rather than killing the digest —
      // the same posture as a bad `detect.*` regex. An unusable deck must not take the
      // rest of the knowledge base down with it.
      deck: normalizeDeck(knowledge.deck),
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
      narration: {
        // Absent key → default (on). Only an explicit `false` disables it, mirroring
        // `acknowledge` — so a config that predates narration gets the louder default.
        enabled: copilot.narration?.enabled !== false,
        verbosity: NARRATION_VERBOSITIES.includes(copilot.narration?.verbosity as NarrationVerbosity)
          ? (copilot.narration!.verbosity as NarrationVerbosity)
          : DEFAULTS.copilot.narration.verbosity,
        maxLines:
          typeof copilot.narration?.maxLines === "number" && copilot.narration.maxLines > 0
            ? Math.floor(copilot.narration.maxLines)
            : DEFAULTS.copilot.narration.maxLines,
      },
      mirror: {
        // Off unless explicitly enabled: mirroring is an opt-in, so only `true` turns it
        // on (a missing/absent key stays off), the mirror of how `allowWebResearch` reads.
        // `COPILOT_MIRROR=1` is the per-session env opt-in the skill sets for `start … mirror`,
        // exactly as `SET_COPILOT_DIR` scopes the runtime dir — env wins over the file value.
        enabled: process.env.COPILOT_MIRROR === "1" || copilot.mirror?.enabled === true,
        category:
          typeof copilot.mirror?.category === "string" && copilot.mirror.category.trim()
            ? copilot.mirror.category.trim()
            : DEFAULTS.copilot.mirror.category,
        minLength:
          typeof copilot.mirror?.minLength === "number" && copilot.mirror.minLength >= 0
            ? Math.floor(copilot.mirror.minLength)
            : DEFAULTS.copilot.mirror.minLength,
        maxLength:
          typeof copilot.mirror?.maxLength === "number" && copilot.mirror.maxLength > 0
            ? Math.floor(copilot.mirror.maxLength)
            : DEFAULTS.copilot.mirror.maxLength,
        // An EMPTY list is a deliberate "length floor only" and is honoured, like
        // `transcript.completeWords`; only an absent or malformed key falls back. Invalid
        // entries are dropped with a warning, like `detect.*` — a bad phrase must not take
        // mirroring down with it.
        fillerPhrases: Array.isArray(copilot.mirror?.fillerPhrases)
          ? validFillerPhrases(copilot.mirror.fillerPhrases)
          : DEFAULTS.copilot.mirror.fillerPhrases,
        codeBlocks:
          copilot.mirror?.codeBlocks === "strip" || copilot.mirror?.codeBlocks === "collapse"
            ? copilot.mirror.codeBlocks
            : DEFAULTS.copilot.mirror.codeBlocks,
      },
      // A non-string (or a blank) is DROPPED with a warning rather than thrown, like a bad
      // `detect.*` regex: a malformed hand-off must not be able to take the stop down with
      // it — losing the hand-off costs a manual copy, losing the stop costs the transcript.
      handoverCommand: validHandoverCommand(copilot.handoverCommand),
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
      scrollHistory:
        typeof wall.scrollHistory === "number" && wall.scrollHistory > 0
          ? Math.floor(wall.scrollHistory)
          : DEFAULT_WALL.scrollHistory,
      staging: {
        ttlMs:
          typeof wall.staging?.ttlMs === "number" && wall.staging.ttlMs > 0
            ? Math.floor(wall.staging.ttlMs)
            : DEFAULT_WALL.staging.ttlMs,
      },
      // Redaction is validated (patterns compiled, bad ones dropped) where it is
      // consumed, in `compileRedactor`; here we only resolve the shape. A supplied
      // non-empty `patterns` replaces the default marking convention wholesale. But an
      // EMPTY (or all-invalid) list falls back to the default, never to "no patterns":
      // this is a SAFETY seam and its default must be fail-safe — a public narration
      // box ships enabled, so an empty list would silently publish raw `both`/`public`
      // text. Unlike `detect.*`, "no rules" here means "publish everything," which is
      // the one thing this mechanism exists to prevent.
      redaction: {
        patterns: resolvedPatterns,
        replacement:
          typeof wall.redaction?.replacement === "string"
            ? wall.redaction.replacement
            : DEFAULT_REDACTION.replacement,
        maxInputLength:
          typeof wall.redaction?.maxInputLength === "number" && wall.redaction.maxInputLength > 0
            ? Math.floor(wall.redaction.maxInputLength)
            : DEFAULT_REDACTION.maxInputLength,
      },
      // A project supplying its own layouts still gets the built-ins appended, so
      // `stacked` (the rollback arrangement) can never be configured away by accident.
      layouts: Array.isArray(wall.layouts)
        ? [...wall.layouts, ...DEFAULT_WALL.layouts.filter((d) => !wall.layouts!.some((l) => l.id === d.id))]
        : DEFAULT_WALL.layouts,
      windows: Array.isArray(wall.windows) ? wall.windows : DEFAULT_WALL.windows,
    },
    transcript: {
      speakers:
        transcript.speakers && typeof transcript.speakers === "object"
          ? Object.fromEntries(
              Object.entries(transcript.speakers).filter(
                ([, v]) => typeof v === "string" && !!v.trim(),
              ),
            )
          : DEFAULTS.transcript.speakers,
      // Absent key → on. Only an explicit `false` disables it, so a config predating
      // the stitch still gets the readable artifact.
      stitchOnStop: transcript.stitchOnStop !== false,
      // Unlike `wall.redaction`, an EMPTY list here is a legitimate "no heuristic":
      // it makes the stitch refuse to guess and take a space at every unmarked join.
      // That is a lossless, if less pretty, outcome — nothing leaks, so the fallback
      // fires only on an absent or malformed key, the way `detect.*` behaves.
      completeWords: Array.isArray(transcript.completeWords)
        ? transcript.completeWords.filter((w): w is string => typeof w === "string")
        : DEFAULTS.transcript.completeWords,
      pauseGapMs:
        typeof transcript.pauseGapMs === "number" && transcript.pauseGapMs > 0
          ? Math.floor(transcript.pauseGapMs)
          : DEFAULTS.transcript.pauseGapMs,
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
