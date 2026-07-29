/**
 * Setup diagnostics — the pure half.
 *
 * The governing rule of this module: **a precondition whose absence is silent must be
 * reported explicitly.** Two live meetings degraded on 2026-07-28 without a single error
 * anywhere: a `knowledge.keywords` list of bare strings normalized to zero entries, and a
 * chat→wall mirror whose `Stop` hook was never registered (the hook self-gates, so an
 * unregistered hook and a working-but-idle one look identical from outside).
 *
 * Everything here is pure: it takes already-parsed config objects, already-parsed
 * `settings.json` objects, and booleans for "file exists" / "wall running". The file and
 * OS access lives in `doctor.ts` / `cli.ts` — the same split as the stitch
 * (`transcript-build.ts` pure, `transcript-stitch-run.ts` file-facing), and it is what
 * makes this testable under the project's "tests cover pure logic only" rule.
 *
 * Diagnostics REPORT, never repair: nothing here or in its callers rewrites a user's
 * config or settings as a side effect of being asked what is wrong.
 */

import { DEFAULTS, normalizeKeywords } from "./config.js";

// ---- finding ----------------------------------------------------------------

/**
 * `warn` = this silently changed behavior (the engine is not doing what the file says).
 * `info` = accurate but worth knowing (a dead value, a default in force).
 *
 * Severity is decided here, once, so a renderer prints without re-deciding it.
 */
export type FindingLevel = "info" | "warn";

export interface Finding {
  level: FindingLevel;
  message: string;
  /** The corrective action, in the user's hands — diagnostics never apply it. */
  fix?: string;
}

// ---- known keys (D2) --------------------------------------------------------

/**
 * Supported config keys that legitimately have no entry in `DEFAULTS` — they are
 * optional and resolve to `undefined`. Kept explicit and small; the guard test in
 * `diagnostics.test.ts` fails when a new key is added to `loadConfig` without being
 * taught here, so this list cannot rot into a false "unknown key" report.
 */
export const EXTRA_KNOWN_KEYS: readonly string[] = [
  "knowledge.decisions",
  "knowledge.decisionIdPrefix",
  "copilot.instructions",
  "wall.categoriesModule",
];

/**
 * The known-key set, DERIVED from the defaults rather than hand-listed — a
 * hand-maintained list would make the drift detector itself a source of drift.
 *
 * One level into each nested section (`audio.micSource`, `wall.port`, …). Deeper keys
 * (`copilot.narration.verbosity`) are not checked: the section is known, and the aim is
 * the handful of drifts that silently changed behavior, not exhaustive validation.
 */
export function knownConfigKeys(): Set<string> {
  const keys = new Set<string>(EXTRA_KNOWN_KEYS);
  for (const [k, v] of Object.entries(DEFAULTS as Record<string, unknown>)) {
    keys.add(k);
    if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const nested of Object.keys(v as Record<string, unknown>)) keys.add(`${k}.${nested}`);
    }
  }
  return keys;
}

// ---- config diagnosis -------------------------------------------------------

/** One config file as it participates in resolution: its path and its parsed contents. */
export interface RawConfigFile {
  path: string;
  /** Parsed JSON, or `undefined` when the file does not exist. */
  data?: Record<string, unknown>;
  /** Parse error message, when the file exists but is not valid JSON. */
  parseError?: string;
}

export interface ConfigDiagnosisContext {
  /** `SET_COPILOT_DIR`, when set — it beats any `runtimeDir` in a file. */
  envRuntimeDir?: string;
  /** Does this project actually use a wall? Only then is a missing `wall` section worth a line. */
  hasWall?: boolean;
}

/** Count the entries a `knowledge.keywords` value DECLARES, before normalization. */
function declaredKeywordCount(raw: unknown): number {
  if (Array.isArray(raw)) return raw.length;
  if (raw && typeof raw === "object") {
    let n = 0;
    for (const group of Object.values(raw)) if (Array.isArray(group)) n += group.length;
    return n;
  }
  return 0;
}

/**
 * Diagnose the config files that participate in resolution.
 *
 * Every "effective value" finding is produced by the code that computes the effective
 * value (`normalizeKeywords` for keywords) — a diagnostic that re-derives behavior can
 * disagree with the engine, which is the one failure mode a diagnostic must not have.
 */
export function diagnoseConfig(files: RawConfigFile[], ctx: ConfigDiagnosisContext = {}): Finding[] {
  const findings: Finding[] = [];
  const known = knownConfigKeys();
  const present = files.filter((f) => f.data);

  for (const file of files) {
    if (file.parseError) {
      findings.push({
        level: "warn",
        message: `${file.path}: érvénytelen JSON — ${file.parseError}`,
        fix: "javítsd a szintaxist; addig a fájl egésze figyelmen kívül marad",
      });
      continue;
    }
    if (!file.data) continue;

    // 1. Unknown keys, by name — a typo or a removed setting is dropped in resolution
    //    without a word, so naming it is the entire point.
    const unknown: string[] = [];
    for (const [key, value] of Object.entries(file.data)) {
      if (!known.has(key)) { unknown.push(key); continue; }
      if (value && typeof value === "object" && !Array.isArray(value)) {
        for (const nested of Object.keys(value as Record<string, unknown>)) {
          if (!known.has(`${key}.${nested}`)) unknown.push(`${key}.${nested}`);
        }
      }
    }
    if (unknown.length) {
      findings.push({
        level: "warn",
        message: `${file.path}: ismeretlen kulcs: ${unknown.join(", ")}`,
        fix: "elgépelés vagy megszűnt beállítás — a betöltés némán eldobja; javítsd vagy töröld",
      });
    }

    // 2. knowledge.keywords that normalizes to fewer entries than it declares. A list
    //    resolved to zero is indistinguishable from an unconfigured one, so both counts
    //    are the finding.
    const knowledge = file.data.knowledge as Record<string, unknown> | undefined;
    if (knowledge && knowledge.keywords !== undefined) {
      const declared = declaredKeywordCount(knowledge.keywords);
      const effective = normalizeKeywords(knowledge.keywords).length;
      if (effective < declared) {
        findings.push({
          level: "warn",
          message: `${file.path}: knowledge.keywords — deklarált ${declared}, ténylegesen érvényes ${effective}`,
          fix: 'a várt alak [{ "topic": "...", "stems": ["...", "..."] }] — a topic/stems nélküli bejegyzéseket a betöltés eldobja',
        });
      }
    }
  }

  // 3. No `wall` section on a project that has a wall: the built-in defaults are in
  //    force. Accurate, not an error — hence `info` (see the spec scenario).
  if (ctx.hasWall && !present.some((f) => f.data!.wall)) {
    findings.push({
      level: "info",
      message: "nincs `wall` szekció egyik config fájlban sem — a beépített wall-alapértékek vannak érvényben (layout, boxok, redakció)",
      fix: "projekt-specifikus falhoz vedd fel a `wall` szekciót (layouts / windows / redaction)",
    });
  }

  // 4. runtimeDir in a file while the environment sets it: the file value is dead, not
  //    in conflict. Stating the winner is what makes a scope mismatch visible.
  //
  //    ONE finding even when both files set it: only the value that would have won is
  //    news, and two near-identical lines is the "operators stop reading" failure mode.
  //    Later file wins, mirroring `{ ...userCfg, ...projCfg }` in `loadConfig`.
  if (ctx.envRuntimeDir) {
    const setters = present.filter((f) => typeof f.data!.runtimeDir === "string" && f.data!.runtimeDir);
    const winner = setters[setters.length - 1];
    if (winner) {
      const also = setters.length > 1 ? ` (és ${setters.slice(0, -1).map((f) => f.path).join(", ")})` : "";
      findings.push({
        level: "info",
        message: `${winner.path}${also}: runtimeDir="${winner.data!.runtimeDir as string}" hatástalan — a SET_COPILOT_DIR="${ctx.envRuntimeDir}" felülírja (a /ds, /dd és /meeting-copilot skillek mindig beállítják)`,
        fix: "a config-beli érték elhagyható; a futásidejű könyvtárat a session-scope adja",
      });
    }
  }

  return findings;
}

// ---- mirror readiness -------------------------------------------------------

/** A tri-state: `"unknown"` is what a malformed `settings.json` yields — never a crash, never a false "missing". */
export type HookState = boolean | "unknown";

/** Does this command string invoke the hook script? Basename match — see `stopHookRegistered`. */
function commandInvokes(command: unknown, scriptBasename: string): boolean {
  return typeof command === "string" && command.includes(scriptBasename);
}

/**
 * Is a `Stop` hook registered that runs `scriptBasename`?
 *
 * Matches the script's BASENAME anywhere in a `hooks.Stop[].hooks[].command`, not the
 * exact command string: `init` writes a different string for a project
 * (`$CLAUDE_PROJECT_DIR/...`) than for `--global` (an absolute home path), and a user may
 * have wrapped it. A false negative here is the worse error — it would send an operator
 * to reinstall something that already works.
 *
 * Returns `"unknown"` for anything it cannot read (a malformed settings object), matching
 * `registerStopHook`'s refusal to guess about a user's hook config.
 */
export function stopHookRegistered(settings: unknown, scriptBasename: string): HookState {
  if (settings === undefined || settings === null) return false;
  if (typeof settings !== "object" || Array.isArray(settings)) return "unknown";
  const hooks = (settings as Record<string, unknown>).hooks;
  if (hooks === undefined) return false;
  if (typeof hooks !== "object" || hooks === null || Array.isArray(hooks)) return "unknown";
  const stop = (hooks as Record<string, unknown>).Stop;
  if (stop === undefined) return false;
  if (!Array.isArray(stop)) return "unknown";
  for (const group of stop) {
    if (!group || typeof group !== "object") return "unknown";
    const entries = (group as Record<string, unknown>).hooks;
    if (entries === undefined) continue;
    if (!Array.isArray(entries)) return "unknown";
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") return "unknown";
      if (commandInvokes((entry as Record<string, unknown>).command, scriptBasename)) return true;
    }
  }
  return false;
}

/** One settings file's answer, with the path so the report can name where it looked. */
export interface HookSource {
  path: string;
  registered: HookState;
}

export interface MirrorInputs {
  /** One entry per settings file consulted (project + user), each already resolved by `stopHookRegistered`. */
  hookCommands: HookSource[];
  /** Is the hook script itself present on disk? */
  scriptExists: boolean;
  /** Is the `wall-mirror.enabled` opt-in marker set for `runtimeDir`? */
  markerExists: boolean;
  /** Is a wall running for `runtimeDir`? */
  wallRunning: boolean;
  /** The runtime dir all three were evaluated against — named in the report, because a scope mismatch is itself a common cause of "the mirror does nothing". */
  runtimeDir: string;
}

export interface MirrorState {
  ok: boolean | "unknown";
  message: string;
  fix?: string;
}

export interface MirrorReport {
  runtimeDir: string;
  hook: MirrorState;
  marker: MirrorState;
  wall: MirrorState;
  /** All three met — mirroring is actually live. Never a substitute for the three states. */
  ready: boolean;
  /** The gate `doctor --mirror` exits on: the marker and the wall may legitimately come later. */
  hookRegistered: HookState;
}

/** The command that installs the hook — named in every finding that reports it missing. */
export const INSTALL_HOOK_COMMAND = "set-copilot init";

/**
 * Report mirror readiness as three INDEPENDENT states, never one verdict: the operator's
 * next action differs per state, and collapsing them is what made the 2026-07-28 failure
 * unattributable (a marker with no hook and a hook with no marker look the same from the
 * wall — both produce an empty wall and no error).
 */
export function diagnoseMirror(inp: MirrorInputs): MirrorReport {
  const found = inp.hookCommands.find((h) => h.registered === true);
  const anyUnknown = inp.hookCommands.some((h) => h.registered === "unknown");
  const where = inp.hookCommands.map((h) => h.path).join(", ") || "(nincs settings.json)";

  let hook: MirrorState;
  if (found) {
    hook = inp.scriptExists
      ? { ok: true, message: `Stop hook regisztrálva (${found.path})` }
      : {
          ok: false,
          message: `Stop hook regisztrálva (${found.path}), de a wall-mirror.sh szkript nincs a lemezen`,
          fix: `${INSTALL_HOOK_COMMAND} — újratelepíti a hook szkriptet`,
        };
  } else if (anyUnknown) {
    hook = {
      ok: "unknown",
      message: `Stop hook: nem eldönthető — hibás settings.json (${where})`,
      fix: "javítsd a settings.json szintaxisát, majd futtasd újra",
    };
  } else {
    hook = {
      ok: false,
      message: `Stop hook nincs regisztrálva — nem található wall-mirror.sh a Stop hookok között (megnézve: ${where})`,
      fix: `${INSTALL_HOOK_COMMAND} — enélkül a tükrözés soha nem fut le, hibaüzenet nélkül`,
    };
  }

  const marker: MirrorState = inp.markerExists
    ? { ok: true, message: "opt-in jelölő megvan (wall-mirror.enabled)" }
    : {
        ok: false,
        message: "opt-in jelölő nincs beállítva (wall-mirror.enabled hiányzik)",
        fix: "/meeting-copilot start wall mirror — a skill hozza létre a session runtime dirjében",
      };

  const wall: MirrorState = inp.wallRunning
    ? { ok: true, message: "fut a fal ehhez a runtime dirhez" }
    : {
        ok: false,
        message: "nem fut fal ehhez a runtime dirhez",
        fix: "set-copilot wall — indításkor ez még nem hiba, tükrözéskor viszont kell",
      };

  return {
    runtimeDir: inp.runtimeDir,
    hook,
    marker,
    wall,
    ready: hook.ok === true && marker.ok === true && wall.ok === true,
    hookRegistered: found ? true : anyUnknown ? "unknown" : false,
  };
}
