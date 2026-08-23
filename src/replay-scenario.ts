/**
 * The replay scenario — what gets played, what the copilot is expected to notice,
 * and the fingerprint that says which measuring stick a score was taken against.
 *
 * A scenario is three files that travel together:
 *
 *   scenario.json      meta: name, the source material it was authored from, language
 *   script.jsonl       one record per entry — a transcript line (or a non-speech event)
 *                      wrapped with the authoring metadata that must NOT be played
 *   expectations.json  the planted moments: ground truth about what should happen
 *
 * plus a generated `timeline.md`, which is a view over the first three and never an
 * input (see `replay-timeline.ts`).
 *
 * Two decisions shape this file.
 *
 * **The wrapper exists so fixture metadata cannot reach the copilot.** A record knows
 * which section of the source material it belongs to; a Soniox line does not. Putting
 * `section` on the played line would hand the copilot a structured outline of the talk
 * it is supposed to be following by ear, and every score taken afterwards would be
 * measuring a copilot nobody will ever ship. `playableOf` is the only way a line leaves
 * this module, and it strips the wrapper.
 *
 * **Timestamps are relative to the scenario's start, not absolute.** A fixture with
 * absolute timestamps would be a recording of one afternoon; rebasing at play time makes
 * it a script that can be run any day and compared across runs. The player does the
 * rebasing, so what lands in the transcript looks exactly like a live capture.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { TranscriptLine } from "./transcript-writer.js";

/** File names inside a scenario directory. One place, so nothing guesses at them. */
export const SCENARIO_FILES = {
  meta: "scenario.json",
  script: "script.jsonl",
  expectations: "expectations.json",
  timeline: "timeline.md",
} as const;

/**
 * The planted roles a scenario must cover to be worth running.
 *
 * Default, not law: the names line up with the shipped `copilot.alerts` taxonomy, and a
 * project that renames its categories overrides `requiredKinds` in its scenario meta.
 * Hardcoding the shipped taxonomy in `src/` is exactly the failure mode this repo keeps
 * having, so the constant is a default and the scenario gets the last word.
 *
 * The reason a minimum exists at all: a scenario with nothing planted cannot tell a
 * working copilot from a silent one, and a silent copilot would score perfectly.
 */
export const DEFAULT_REQUIRED_KINDS = ["contradiction", "question", "decision"];

/** A non-speech event a scenario can play — the same shape the writer emits. */
export interface ScenarioEvent {
  type: string;
  duration_ms?: number;
  [k: string]: unknown;
}

/**
 * One entry of the script: what is played, plus authoring metadata that is not.
 *
 * `ts` (and `startTs`) are milliseconds from the scenario's start. `section` names the
 * part of the source material this entry belongs to and exists for the timeline only.
 */
export interface ScriptEntry {
  /** Section of the source material — timeline metadata, never played. */
  section?: string;
  /** A spoken line. Exactly one of `line` / `event` is present. */
  line?: TranscriptLine;
  /** A non-speech event (silence, reconnect). */
  event?: ScenarioEvent;
}

/** A planted moment: where it is, what the copilot should do, and what counts as right. */
export interface PlantedMoment {
  /** Stable id — a scorecard refers to moments by this, so renaming one breaks comparison. */
  id: string;
  /** Scenario time (ms from start) the moment becomes true. */
  at: number;
  /** What kind of reaction is expected. Free text: the alert taxonomy is a project's own. */
  kind: string;
  /** What a correct reaction contains, in a sentence a judge can rule on. */
  expect: string;
  /** How long after `at` a reaction still counts. Absent = the scenario's default window. */
  withinMs?: number;
  /** Author's note — why this was planted. Not scored. */
  note?: string;
}

export interface ScenarioMeta {
  name: string;
  /** What this scenario was authored from. Provenance only — never required on disk. */
  sourceMaterial?: string;
  description?: string;
  language?: string;
  /** Overrides `DEFAULT_REQUIRED_KINDS` for projects with their own alert taxonomy. */
  requiredKinds?: string[];
  /** Default reaction window for a planted moment that does not set its own. */
  defaultWithinMs?: number;
  /**
   * Which wall categories count as a *reaction* for precision.
   *
   * Absent means all of them. It exists because a copilot is also configured to do
   * continuous things — running narration, a pinned summary — that legitimately match no
   * planted moment. Counting those against precision punishes the copilot for obeying its
   * own policy, and measured on a real run it dragged precision from 1.0 to 0.375.
   *
   * The category names live HERE and not in `src/`: the taxonomy is a project's own
   * (`wall.categories`), and hardcoding the shipped Hungarian ids in the engine is exactly
   * the failure mode this repo keeps having.
   */
  reactionCategories?: string[];
  /**
   * The measured run-to-run noise of this scenario, per dimension, in the dimension's own
   * unit. A difference inside the band is reported as unchanged, not as a verdict.
   *
   * It lives on the scenario and not in the engine because noise is a property of THIS
   * script against THIS copilot, not a constant. Measured 2026-08-23: two runs of the
   * seven-moment version of this scenario moved coverage 0.857 → 0.571 with nothing
   * changed — a single-run comparison would have reported a regression. Widening the
   * scenario to eighteen moments cut that spread to 0.167, because one moment stopped
   * being worth a seventh of the score.
   *
   * A scenario with no band declared still compares, but the comparison says so: a
   * single-run difference is a reading, not evidence.
   */
  noiseBand?: Record<string, number>;
}

export interface Scenario {
  dir: string;
  meta: ScenarioMeta;
  script: ScriptEntry[];
  moments: PlantedMoment[];
  /**
   * Content fingerprint of script + expectations. A scorecard records it, and a
   * comparison across two different fingerprints refuses a verdict: a moved measuring
   * stick looks like a result, which is worse than having no result.
   */
  fingerprint: string;
  /** Scenario duration in ms — the last entry's timestamp. */
  durationMs: number;
}

/** Raised for anything that makes a scenario unloadable or unrunnable. */
export class ScenarioError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScenarioError";
  }
}

/** The playable half of an entry: what actually reaches the transcript. */
export function playableOf(entry: ScriptEntry): TranscriptLine | ScenarioEvent {
  if (entry.line) return entry.line;
  if (entry.event) return entry.event;
  throw new ScenarioError("script entry has neither a line nor an event");
}

/** Scenario time of an entry, in ms from the scenario's start. */
export function entryTs(entry: ScriptEntry): number {
  const p = playableOf(entry) as { ts?: number };
  return typeof p.ts === "number" ? p.ts : 0;
}

function readJson(path: string, what: string): unknown {
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (err) {
    throw new ScenarioError(`cannot read ${what} (${path}): ${(err as Error).message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new ScenarioError(`${what} is not valid JSON (${path}): ${(err as Error).message}`);
  }
}

/**
 * Validate one script entry. Returns the reason it is bad, or null.
 *
 * The position is reported by the caller: a malformed line has to be findable, and
 * "one of your 900 lines is wrong" is not a usable error message.
 */
function entryProblem(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return "not an object";
  const e = raw as ScriptEntry;
  const hasLine = e.line !== undefined;
  const hasEvent = e.event !== undefined;
  if (hasLine === hasEvent) return "must carry exactly one of `line` / `event`";
  if (hasEvent) {
    const ev = e.event as ScenarioEvent;
    if (typeof ev.type !== "string" || !ev.type) return "event is missing `type`";
    if (typeof ev.ts !== "number") return "event is missing a numeric `ts`";
    return null;
  }
  const l = e.line as TranscriptLine;
  if (l.speaker !== "mic" && l.speaker !== "system") return 'line `speaker` must be "mic" or "system"';
  if (typeof l.text !== "string" || !l.text.trim()) return "line `text` must be non-empty";
  if (typeof l.ts !== "number" || !Number.isFinite(l.ts) || l.ts < 0) {
    return "line `ts` must be a non-negative number of ms from the scenario start";
  }
  if (l.startTs !== undefined && (typeof l.startTs !== "number" || l.startTs > l.ts)) {
    return "line `startTs` must be a number no later than `ts`";
  }
  return null;
}

/** Load a scenario's three files, validating shape but not yet its planted minimums. */
export function loadScenario(dir: string): Scenario {
  for (const key of ["meta", "script", "expectations"] as const) {
    const path = join(dir, SCENARIO_FILES[key]);
    if (!existsSync(path)) {
      throw new ScenarioError(`scenario at ${dir} is missing ${SCENARIO_FILES[key]}`);
    }
  }

  const meta = readJson(join(dir, SCENARIO_FILES.meta), "scenario meta") as ScenarioMeta;
  if (!meta || typeof meta.name !== "string" || !meta.name) {
    throw new ScenarioError(`scenario meta must carry a name (${join(dir, SCENARIO_FILES.meta)})`);
  }

  const scriptRaw = readFileSync(join(dir, SCENARIO_FILES.script), "utf-8");
  const script: ScriptEntry[] = [];
  const lines = scriptRaw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].trim();
    if (!text) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new ScenarioError(`script.jsonl line ${i + 1}: not valid JSON (${(err as Error).message})`);
    }
    const problem = entryProblem(parsed);
    if (problem) throw new ScenarioError(`script.jsonl line ${i + 1}: ${problem}`);
    script.push(parsed as ScriptEntry);
  }
  if (script.length === 0) throw new ScenarioError(`scenario ${meta.name} has an empty script`);

  // Monotonic time. Out-of-order entries would make the player either sleep backwards
  // or silently reorder the conversation; both would be a fixture that does not mean
  // what it reads as.
  for (let i = 1; i < script.length; i++) {
    if (entryTs(script[i]) < entryTs(script[i - 1])) {
      throw new ScenarioError(
        `script.jsonl entry ${i + 1}: timestamp ${entryTs(script[i])} goes backwards from ${entryTs(script[i - 1])}`,
      );
    }
  }

  const expectations = readJson(join(dir, SCENARIO_FILES.expectations), "expectations") as {
    moments?: PlantedMoment[];
  };
  const moments = Array.isArray(expectations?.moments) ? expectations.moments : [];
  for (let i = 0; i < moments.length; i++) {
    const m = moments[i];
    if (!m || typeof m.id !== "string" || !m.id) throw new ScenarioError(`planted moment ${i + 1} is missing an id`);
    if (typeof m.at !== "number" || m.at < 0) throw new ScenarioError(`planted moment "${m.id}" needs a numeric \`at\``);
    if (typeof m.kind !== "string" || !m.kind) throw new ScenarioError(`planted moment "${m.id}" is missing a kind`);
    if (typeof m.expect !== "string" || !m.expect.trim()) {
      throw new ScenarioError(`planted moment "${m.id}" must say what a correct reaction contains`);
    }
  }
  const ids = new Set<string>();
  for (const m of moments) {
    if (ids.has(m.id)) throw new ScenarioError(`duplicate planted moment id "${m.id}"`);
    ids.add(m.id);
  }

  // The fingerprint covers the meta too, not just the script and the expectations.
  // The meta CHANGES THE SCORE — `reactionCategories` decides what counts as a reaction,
  // `defaultWithinMs` decides how long a reaction may lag — so leaving it out would let
  // two runs be declared comparable while having been measured with different rulers.
  // Caught while setting the first baseline, editing `reactionCategories` and watching
  // precision move with the fingerprint unchanged.
  const fingerprint = createHash("sha256")
    .update(readFileSync(join(dir, SCENARIO_FILES.meta), "utf-8"))
    .update(scriptRaw)
    .update(readFileSync(join(dir, SCENARIO_FILES.expectations), "utf-8"))
    .digest("hex")
    .slice(0, 16);

  return {
    dir,
    meta,
    script,
    moments,
    fingerprint,
    durationMs: entryTs(script[script.length - 1]),
  };
}

/** A validation finding. `ok` scenarios have none. */
export interface ValidationProblem {
  code: string;
  message: string;
}

/**
 * Check that a loaded scenario can actually measure anything.
 *
 * Shape is already guaranteed by `loadScenario`; this is the harder question — does the
 * scenario discriminate? A run against a scenario that plants nothing produces a perfect
 * score for a copilot that says nothing at all.
 */
export function validateScenario(s: Scenario): ValidationProblem[] {
  const problems: ValidationProblem[] = [];

  if (s.moments.length === 0) {
    problems.push({
      code: "no-planted-moments",
      message: "no planted moments — a run against this scenario cannot distinguish a working copilot from a silent one",
    });
  }

  const required = s.meta.requiredKinds ?? DEFAULT_REQUIRED_KINDS;
  const kinds = new Set(s.moments.map((m) => m.kind));
  for (const kind of required) {
    if (!kinds.has(kind)) {
      problems.push({ code: "missing-kind", message: `no planted moment of kind "${kind}"` });
    }
  }

  const spoken = s.script.filter((e) => e.line).map((e) => e.line as TranscriptLine);
  if (!spoken.some((l) => l.speaker === "system")) {
    problems.push({
      code: "single-channel",
      message: "no system-channel speech — a single-channel scenario never exercises the two-channel path, which is the reason this package exists",
    });
  }
  if (!spoken.some((l) => l.speaker === "mic")) {
    problems.push({ code: "no-mic", message: "no mic-channel speech" });
  }
  if (!spoken.some((l) => l.command)) {
    problems.push({
      code: "no-direct-address",
      message: "nothing addresses the copilot directly — the direct-instruction path goes unmeasured",
    });
  }

  const beyond = s.moments.filter((m) => m.at > s.durationMs);
  for (const m of beyond) {
    problems.push({
      code: "moment-after-end",
      message: `planted moment "${m.id}" is at ${m.at}ms, after the scenario ends at ${s.durationMs}ms`,
    });
  }

  return problems;
}

/** Load and validate in one step, throwing on any problem. The strict entry point. */
export function loadValidScenario(dir: string): Scenario {
  const s = loadScenario(dir);
  const problems = validateScenario(s);
  if (problems.length > 0) {
    throw new ScenarioError(
      `scenario "${s.meta.name}" is not runnable:\n` + problems.map((p) => `  - ${p.message}`).join("\n"),
    );
  }
  return s;
}
