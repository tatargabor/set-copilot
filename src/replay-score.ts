/**
 * Scoring one replay run against its scenario.
 *
 * The point of this module is to answer one question honestly: **better or worse than
 * last time?** Everything in it serves that, which is why so much of it is about
 * refusing to produce a number rather than producing one.
 *
 * Three rules shape it.
 *
 * **Evidence only.** A score is computed from what the run left behind — the wall event
 * log, the played transcript, the run record. Nothing is added to the copilot to make it
 * observable, because an instrumented copilot is not the copilot that ships. Where a
 * dimension's evidence is missing, it is reported unmeasured *with the reason*, never
 * filled in.
 *
 * **Mechanical and judged are kept apart.** Counting, timing, and ratios are pure
 * functions here, identical on every run. Whether a given reaction actually *addressed*
 * a planted moment is a judgement, supplied from outside as a matching. Letting a
 * non-deterministic verdict leak into a counted dimension would destroy the one property
 * a regression measure needs.
 *
 * **A run may only claim what its playback speed supports.** Latency from a sped-up run
 * is not a smaller number, it is not a number: the model's thinking time does not scale
 * with playback. The same applies when the player itself fell behind, or when an event
 * carries no emission time.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { DEFAULT_FILLER_PHRASES, isFillerMessage, type CopilotConfig } from "./config.js";
import type { ReplayRunRecord } from "./replay.js";
import type { PlantedMoment, Scenario } from "./replay-scenario.js";

/** Beyond this much player lateness, the run's own timing is not trustworthy either. */
export const LATENESS_INVALIDATES_MS = 2000;

/** One event as it sits in the canonical wall log. */
export interface WallEventRecord {
  category?: string;
  zone?: string;
  text?: string;
  emittedAt?: number;
  staged?: boolean;
  visual?: string;
  /**
   * Commands (`promote`, `pending`, `show`) are tagged with `kind` at the TOP level —
   * `{kind:"promote", category, visual, zone}` — not nested under a key of their own.
   * Getting this wrong made the scorer count commands as wall content AND never find a
   * promotion, so the prediction rate read 0 on the one run where it was 1/1.
   */
  kind?: string;
  [k: string]: unknown;
}

/** The artifacts a run leaves behind. */
export interface RunArtifacts {
  events: WallEventRecord[];
  record: ReplayRunRecord | null;
  /** Why a piece of evidence is absent, if it is. */
  missing: string[];
}

/**
 * A judged correspondence between a planted moment and a reaction.
 *
 * `eventIndex` null means the judge found nothing that addressed the moment. Supplied
 * from outside precisely so that this module stays deterministic.
 */
export interface Match {
  momentId: string;
  eventIndex: number | null;
  /**
   * Every OTHER candidate that also addresses this moment (never the credited one).
   *
   * `eventIndex` is the earliest addressing event, because that is what latency means.
   * But precision asks a different question — "did the copilot react to things nobody
   * planted?" — and a second event on an answered moment is not noise. Crediting only
   * the earliest made every follow-up count against the copilot: measured on the
   * 2026-08-23 promote run, precision read 0.10 while 31 narration events had absorbed
   * the credit for moments its `súgás` lines had genuinely addressed.
   *
   * Absent on a card judged before this field existed; precision then falls back to the
   * credited match alone, which is the old, harsher reading — never a silent upgrade.
   */
  alsoAddressing?: number[];
  /** The judge's reasoning — recorded so a disputed score can be inspected, not re-run. */
  reasoning?: string;
}

/** A measured dimension, or a stated refusal to measure it. */
export type Dimension =
  | { measured: true; source: "computed" | "judged"; value: number; unit: string; detail?: string }
  | { measured: false; reason: string };

export interface Scorecard {
  scenario: string;
  /** Content fingerprint — a comparison across two different ones is refused. */
  fingerprint: string;
  speed: number;
  realTime: boolean;
  /** Which planted moments drew a reaction, and which passed unnoticed. */
  covered: string[];
  missed: { id: string; kind: string; expect: string }[];
  /**
   * The judged matching, per moment, with the delay it produced and the judge's own
   * reasoning.
   *
   * Persisted because a judged verdict is not reproducible: re-running a
   * non-deterministic step to check it turns a disagreement into a coin flip. It also
   * removes the temptation that produced a wrong report on 2026-08-23 — with no
   * per-moment record in the card, "the first event inside the window" gets used as a
   * stand-in for the judged match, and it is not one. Those two numbers disagreed by a
   * factor of two.
   */
  judgement: {
    momentId: string;
    kind: string;
    eventIndex: number | null;
    /** Other events the judge said also address this moment — precision's input, recorded. */
    alsoAddressing?: number[];
    /** ms from the moment becoming true to the matched event; null when not measurable. */
    delayMs: number | null;
    reasoning?: string;
  }[];
  /** Reactions matching no planted moment — a copilot that reacts to everything is not good. */
  unmatchedReactions: number;
  dimensions: Record<string, Dimension>;
  notes: string[];
}

/** Load a run's evidence. Absent pieces are reported, never guessed at. */
export function loadRunArtifacts(runtimeDir: string): RunArtifacts {
  const missing: string[] = [];

  const eventsPath = join(runtimeDir, "wall-events.jsonl");
  let events: WallEventRecord[] = [];
  if (!existsSync(eventsPath)) {
    missing.push(`no wall event log at ${eventsPath} — nothing reached the wall, or the wall never ran`);
  } else {
    for (const raw of readFileSync(eventsPath, "utf-8").split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      try {
        events.push(JSON.parse(line) as WallEventRecord);
      } catch {
        // A corrupt line is skipped, not fatal: the artifacts are advisory evidence and
        // one unreadable event must not cost the whole measurement.
        missing.push("a wall event line was unreadable and was skipped");
      }
    }
  }

  const recordPath = join(runtimeDir, "replay-run.json");
  let record: ReplayRunRecord | null = null;
  if (!existsSync(recordPath)) {
    missing.push(`no run record at ${recordPath} — the run's speed and start time are unknown`);
  } else {
    try {
      record = JSON.parse(readFileSync(recordPath, "utf-8")) as ReplayRunRecord;
    } catch (err) {
      missing.push(`run record unreadable: ${(err as Error).message}`);
    }
  }

  return { events, record, missing };
}

/** Events that are actual wall content — a command names a visual, it is not one. */
export function contentEvents(events: WallEventRecord[]): WallEventRecord[] {
  return events.filter((e) => e.kind === undefined && typeof e.category === "string");
}

/** Visuals a `promote` command lifted public. */
export function promotedVisuals(events: WallEventRecord[]): Set<string> {
  return new Set(
    events
      .filter((e) => e.kind === "promote" && typeof e.visual === "string")
      .map((e) => e.visual as string),
  );
}

/** Does this event carry a drawn payload rather than text? */
export function isDrawn(e: WallEventRecord): boolean {
  return e.graph !== undefined || e.chart !== undefined || e.image !== undefined || e.webpage !== undefined;
}

/**
 * Why a latency figure may not be reported for this run, or null if it may.
 *
 * Collected in one place because every latency dimension has to answer the same question,
 * and three separate copies of "is this run timeable" is how one of them ends up lenient.
 */
export function latencyRefusal(record: ReplayRunRecord | null): string | null {
  if (!record) return "no run record — the run's speed and start time are unknown";
  if (!record.realTime) {
    return `run played at speed ${record.speed}, not real time — a model's thinking time does not scale with playback, so elapsed-time figures from it are not latencies`;
  }
  if ((record.maxLatenessMs ?? 0) > LATENESS_INVALIDATES_MS) {
    return `the player itself fell ${Math.round(record.maxLatenessMs as number)}ms behind schedule — these figures would describe the player, not the copilot`;
  }
  return null;
}

/** Absolute wall-clock time a planted moment becomes true, given when the run started. */
export function momentTime(m: PlantedMoment, record: ReplayRunRecord): number {
  return record.startedAt + m.at;
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * Candidate reactions for a planted moment: content events emitted inside its window.
 *
 * This is what a judge is asked about. Mechanical narrowing, judged selection — a judge
 * given the whole log would be re-deriving the timeline on every question.
 */
export function candidatesFor(
  m: PlantedMoment,
  events: WallEventRecord[],
  record: ReplayRunRecord,
  defaultWithinMs: number,
): { index: number; event: WallEventRecord }[] {
  const from = momentTime(m, record);
  const to = from + (m.withinMs ?? defaultWithinMs);
  return events
    .map((event, index) => ({ index, event }))
    .filter(({ event }) => typeof event.emittedAt === "number" && event.emittedAt >= from && event.emittedAt <= to);
}

/**
 * Score a run.
 *
 * `matches` is the judged correspondence. With none supplied, coverage is reported as
 * unmeasured rather than assumed to be zero — "nobody judged this run" and "the copilot
 * noticed nothing" are very different facts and must never look alike.
 */
export function scoreRun(
  scenario: Scenario,
  artifacts: RunArtifacts,
  matches: Match[],
  cfg?: Pick<CopilotConfig, "copilot">,
): Scorecard {
  const { events, record } = artifacts;
  const notes = [...artifacts.missing];
  const dimensions: Record<string, Dimension> = {};

  const content = contentEvents(events);
  const refusal = latencyRefusal(record);

  /**
   * An event with no emission time can never fall inside a moment's window, so it can
   * never be judged a reaction. If ANY content event is unstamped, a real reaction may
   * have been invisible to the windowing — and reporting that as "0 covered, 3 missed"
   * would blame the copilot for a gap in the evidence. Caught by scoring a run recorded
   * before `emittedAt` existed, which read as a total copilot failure.
   */
  const unstampedContent = content.filter((e) => typeof e.emittedAt !== "number").length;
  // The gap invalidates the run only when NOTHING is stamped — a log written before
  // emission times existed. A few unstamped events are excluded from candidacy and noted;
  // letting one stray event declare a 45-event run unmeasurable was the rule overshooting
  // its purpose, which is to stop a stamp-less log from reading as a silent copilot.
  const evidenceGap = content.length > 0 && unstampedContent === content.length
    ? `none of this run's ${content.length} wall event(s) carry an emittedAt — they cannot fall inside any moment's window, so coverage and precision are unmeasurable (a log written before emission times existed)`
    : null;
  if (unstampedContent > 0 && !evidenceGap) {
    notes.push(`${unstampedContent} of ${content.length} wall event(s) carry no emittedAt and were excluded from matching — never substituted`);
  }

  const byId = new Map(matches.map((m) => [m.momentId, m]));
  const judged = matches.length > 0;
  const covered: string[] = [];
  const missed: Scorecard["missed"] = [];
  const matchedIndexes = new Set<number>();

  for (const m of scenario.moments) {
    const match = byId.get(m.id);
    if (match && match.eventIndex !== null) {
      covered.push(m.id);
      matchedIndexes.add(match.eventIndex);
    } else if (judged && !evidenceGap) {
      missed.push({ id: m.id, kind: m.kind, expect: m.expect });
    }
  }

  if (evidenceGap) {
    notes.push(evidenceGap);
    dimensions.coverage = { measured: false, reason: evidenceGap };
    dimensions.reactionLatency = { measured: false, reason: evidenceGap };
    dimensions.precision = { measured: false, reason: evidenceGap };
  } else if (!judged) {
    notes.push("no judged matching supplied — coverage, misses, and reaction latency are unmeasured, NOT zero");
    dimensions.coverage = { measured: false, reason: "no judged matching supplied" };
    dimensions.reactionLatency = { measured: false, reason: "no judged matching supplied" };
  } else {
    dimensions.coverage = {
      measured: true,
      source: "judged",
      value: scenario.moments.length ? covered.length / scenario.moments.length : 0,
      unit: "ratio",
      detail: `${covered.length}/${scenario.moments.length} planted moments drew a reaction`,
    };

    if (refusal) {
      dimensions.reactionLatency = { measured: false, reason: refusal };
    } else {
      const delays: number[] = [];
      let unstamped = 0;
      for (const m of scenario.moments) {
        const match = byId.get(m.id);
        if (!match || match.eventIndex === null) continue;
        const ev = events[match.eventIndex];
        if (typeof ev?.emittedAt !== "number") { unstamped++; continue; }
        delays.push(ev.emittedAt - momentTime(m, record as ReplayRunRecord));
      }
      if (unstamped > 0) notes.push(`${unstamped} matched event(s) carry no emittedAt — excluded from latency, never substituted`);
      dimensions.reactionLatency = delays.length
        ? { measured: true, source: "computed", value: Math.round(mean(delays)), unit: "ms", detail: `${delays.length} matched reaction(s)` }
        : { measured: false, reason: "no matched reaction carried an emission time" };
    }
  }

  // Reactions with nothing planted behind them. Counted, never ignored: a copilot that
  // reacts to everything scores perfect coverage and is unusable in a real meeting.
  // Precision counts only what the scenario calls a reaction. A copilot is also
  // configured to do continuous things — running narration, a pinned summary — which
  // legitimately match no planted moment; counting those punishes it for following its
  // own policy. Measured on a real run: precision read 0.375 while every planted moment
  // had in fact been answered.
  //
  // Two things this counted wrongly until 2026-08-23, both found by reading a precision
  // of 0.10 that the run did not deserve:
  //
  // 1. INDEX SPACE. The judge's `eventIndex` points into the full event log; this filter
  //    numbered the *content* events (commands removed). After the first `promote` the
  //    two numberings diverge, so a matched reaction was compared against a stranger's
  //    index. Reactions are numbered in the event log's own space now.
  // 2. ONE CREDIT PER MOMENT. `eventIndex` is deliberately the EARLIEST addressing event
  //    (latency), so every later event on an answered moment fell through as "matched
  //    nothing planted". The judge now also names the others (`alsoAddressing`), and a
  //    reaction counts as addressed if it appears in either.
  const reactionCats = scenario.meta.reactionCategories;
  const addressed = new Set(matchedIndexes);
  for (const m of matches) for (const i of m.alsoAddressing ?? []) addressed.add(i);
  const liftedForPrecision = promotedVisuals(events);
  const reactions = events
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.kind === undefined && typeof e.category === "string")
    // A staged prediction nobody promoted was never on the public wall — it is a private
    // guess, and the contract calls letting a wrong one expire correct. Counting it as an
    // unmatched reaction would penalise exactly the behaviour the wall asks for.
    .filter(({ e }) => !(e.staged === true && !(e.visual && liftedForPrecision.has(e.visual))))
    .filter(({ e }) => (reactionCats ? reactionCats.includes(e.category ?? "") : true));
  const unmatched = judged && !evidenceGap ? reactions.filter(({ i }) => !addressed.has(i)).length : 0;
  if (!evidenceGap) dimensions.precision = judged
    ? {
        measured: true,
        source: "judged",
        value: reactions.length ? (reactions.length - unmatched) / reactions.length : 0,
        unit: "ratio",
        detail: `${unmatched} of ${reactions.length} reaction event(s) matched no planted moment` +
          (reactionCats ? ` (categories counted as reactions: ${reactionCats.join(", ")})` : " (every category counted — the scenario declares no reactionCategories)"),
      }
    : { measured: false, reason: "no judged matching supplied" };

  // Drawing. Mechanical: a drawn payload is one a reader can see without judgement.
  const drawn = content.filter(isDrawn);
  dimensions.draws = { measured: true, source: "computed", value: drawn.length, unit: "count" };

  // Prediction: staged private guesses against the ones a promote actually lifted.
  const staged = content.filter((e) => e.staged === true);
  const lifted = promotedVisuals(events);
  const promoted = staged.filter((e) => e.visual && lifted.has(e.visual)).length;
  dimensions.predictionsStaged = { measured: true, source: "computed", value: staged.length, unit: "count" };
  dimensions.predictionsPromoted = staged.length
    ? {
        measured: true, source: "computed", value: promoted / staged.length, unit: "ratio",
        detail: `${promoted} of ${staged.length} staged prediction(s) were promoted; the rest expired unused`,
      }
    : { measured: false, reason: "nothing was staged in this run" };

  // Filler. The field measurement that motivated this dimension: ~31% of a live session's
  // output was empty acknowledgement, some of it read aloud to a room.
  const texts = content.map((e) => e.text).filter((t): t is string => typeof t === "string");
  // Falls back to the shipped list rather than to "nothing is filler": an absent config
  // must not silently report a filler-free run.
  const fillerPhrases = cfg?.copilot.mirror.fillerPhrases ?? DEFAULT_FILLER_PHRASES;
  const filler = texts.filter((t) => isFillerMessage(t, fillerPhrases)).length;
  dimensions.fillerShare = texts.length
    ? { measured: true, source: "computed", value: filler / texts.length, unit: "ratio", detail: `${filler} of ${texts.length} text event(s)` }
    : { measured: false, reason: "the run produced no text events" };

  if (refusal) notes.push(refusal);

  // The per-moment record. Built from the same matching every dimension used, so the
  // card cannot disagree with itself.
  const judgement = scenario.moments.map((m) => {
    const match = byId.get(m.id);
    const idx = match?.eventIndex ?? null;
    const ev = idx !== null ? events[idx] : undefined;
    const delayMs = !refusal && record && ev && typeof ev.emittedAt === "number"
      ? ev.emittedAt - momentTime(m, record)
      : null;
    return { momentId: m.id, kind: m.kind, eventIndex: idx, alsoAddressing: match?.alsoAddressing, delayMs, reasoning: match?.reasoning };
  });

  return {
    scenario: scenario.meta.name,
    fingerprint: scenario.fingerprint,
    speed: record?.speed ?? NaN,
    realTime: record?.realTime ?? false,
    covered,
    missed,
    judgement,
    unmatchedReactions: unmatched,
    dimensions,
    notes,
  };
}

export type Direction = "improved" | "regressed" | "unchanged" | "unmeasurable";

export interface Comparison {
  comparable: boolean;
  /** Present when the comparison is refused outright. */
  refusal?: string;
  dimensions: Record<string, { before: Dimension; after: Dimension; direction: Direction; note?: string }>;
}

/** Dimensions where a smaller number is better. */
const LOWER_IS_BETTER = new Set(["reactionLatency", "fillerShare"]);
/** Dimensions that are counts of activity, not quality — reported, never graded. */
const NOT_GRADED = new Set(["draws", "predictionsStaged"]);

/**
 * Compare two scorecards of the same scenario.
 *
 * Refuses outright across fingerprints: comparing against a moved measuring stick looks
 * like a result, which is worse than having no result. Refuses latency across mismatched
 * speeds for the same reason a sped-up run may not report it at all.
 */
export function compareScorecards(
  before: Scorecard,
  after: Scorecard,
  noiseBand?: Record<string, number>,
): Comparison {
  if (before.fingerprint !== after.fingerprint) {
    return {
      comparable: false,
      refusal: `the scenario itself changed (${before.fingerprint} → ${after.fingerprint}) — these runs measured different things`,
      dimensions: {},
    };
  }

  const speedsDiffer = before.speed !== after.speed;
  const out: Comparison["dimensions"] = {};
  const keys = new Set([...Object.keys(before.dimensions), ...Object.keys(after.dimensions)]);

  for (const key of keys) {
    const b = before.dimensions[key] ?? { measured: false as const, reason: "absent from the earlier scorecard" };
    const a = after.dimensions[key] ?? { measured: false as const, reason: "absent from the later scorecard" };

    if (speedsDiffer && LOWER_IS_BETTER.has(key) && key === "reactionLatency") {
      out[key] = { before: b, after: a, direction: "unmeasurable", note: `speeds differ (${before.speed} vs ${after.speed}) — latency is not comparable across them` };
      continue;
    }
    if (!b.measured || !a.measured) {
      out[key] = { before: b, after: a, direction: "unmeasurable", note: !b.measured ? b.reason : (a as { reason: string }).reason };
      continue;
    }
    if (NOT_GRADED.has(key) || a.value === b.value) {
      out[key] = { before: b, after: a, direction: "unchanged", note: NOT_GRADED.has(key) ? "activity count — reported, not graded" : undefined };
      continue;
    }
    // Inside the scenario's measured run-to-run noise, a difference is not a verdict.
    // Without this, two identical builds produce "regressed" — which is exactly what
    // happened on the first two runs of this harness.
    const band = noiseBand?.[key];
    if (band !== undefined && Math.abs(a.value - b.value) <= band) {
      out[key] = {
        before: b, after: a, direction: "unchanged",
        note: `difference ${Math.abs(a.value - b.value).toPrecision(3)} is inside this scenario's measured noise band (±${band}) — not evidence of a change`,
      };
      continue;
    }
    const better = LOWER_IS_BETTER.has(key) ? a.value < b.value : a.value > b.value;
    out[key] = {
      before: b, after: a, direction: better ? "improved" : "regressed",
      note: band === undefined
        ? "no noise band declared for this scenario — a single-run difference is a reading, not evidence"
        : undefined,
    };
  }

  return { comparable: true, dimensions: out };
}
