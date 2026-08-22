/**
 * The scenario loader and validator.
 *
 * The loader's rejections are all about being FINDABLE — a bad line names its position,
 * because "one of your 900 lines is wrong" is not an error message. The validator's
 * rejections are about being MEANINGFUL: a scenario that plants nothing gives a silent
 * copilot a perfect score, which is the one failure that would quietly invalidate every
 * measurement taken afterwards.
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEFAULT_REQUIRED_KINDS, ScenarioError, entryTs, loadScenario, loadValidScenario, playableOf,
  validateScenario, type PlantedMoment, type ScriptEntry,
} from "./replay-scenario.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "set-copilot-scenario-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function line(ts: number, speaker: "mic" | "system", text: string, extra: Record<string, unknown> = {}): ScriptEntry {
  return { section: "S1", line: { ts, speaker, text, final: true, ...extra } as never };
}

const FULL_SCRIPT: ScriptEntry[] = [
  line(0, "mic", "Kezdjük a bevezetővel."),
  line(4000, "system", "Elnézést, ez melyik évre vonatkozik?"),
  line(8000, "mic", "Copilot, rajzold fel a rétegeket.", { command: true }),
  line(12_000, "mic", "Három hét alatt megvagyunk vele."),
];

const FULL_MOMENTS: PlantedMoment[] = [
  { id: "m1", at: 12_000, kind: "contradiction", expect: "flags that the source material says six weeks, not three" },
  { id: "m2", at: 4000, kind: "question", expect: "notes the year is unanswered" },
  { id: "m3", at: 8000, kind: "decision", expect: "records the layer decision" },
];

function write(script: ScriptEntry[] = FULL_SCRIPT, moments: PlantedMoment[] = FULL_MOMENTS, meta: object = {}): string {
  writeFileSync(join(dir, "scenario.json"), JSON.stringify({ name: "t", ...meta }));
  writeFileSync(join(dir, "script.jsonl"), script.map((e) => JSON.stringify(e)).join("\n") + "\n");
  writeFileSync(join(dir, "expectations.json"), JSON.stringify({ moments }));
  return dir;
}

describe("loadScenario", () => {
  it("names the missing file when a part is absent", () => {
    writeFileSync(join(dir, "scenario.json"), JSON.stringify({ name: "t" }));
    expect(() => loadScenario(dir)).toThrow(/script\.jsonl/);
  });

  it("loads the three parts together", () => {
    const s = loadScenario(write());
    expect(s.meta.name).toBe("t");
    expect(s.script).toHaveLength(4);
    expect(s.moments).toHaveLength(3);
    expect(s.durationMs).toBe(12_000);
  });

  it("reports a malformed line with its position, not just that one exists", () => {
    write();
    writeFileSync(join(dir, "script.jsonl"), [
      JSON.stringify(line(0, "mic", "jó")),
      "{ not json",
    ].join("\n"));
    expect(() => loadScenario(dir)).toThrow(/line 2/);
  });

  it("rejects a line with no speaker channel", () => {
    write();
    writeFileSync(join(dir, "script.jsonl"), JSON.stringify({ line: { ts: 0, speaker: "nobody", text: "x", final: true } }));
    expect(() => loadScenario(dir)).toThrow(/speaker/);
  });

  it("rejects an entry carrying both a line and an event", () => {
    write();
    writeFileSync(join(dir, "script.jsonl"), JSON.stringify({
      line: { ts: 0, speaker: "mic", text: "x", final: true },
      event: { type: "silence", ts: 0 },
    }));
    expect(() => loadScenario(dir)).toThrow(/exactly one/);
  });

  it("rejects timestamps that go backwards", () => {
    write([line(0, "mic", "a"), line(5000, "mic", "b"), line(1000, "mic", "c")]);
    expect(() => loadScenario(dir)).toThrow(/backwards/);
  });

  it("rejects a duplicate planted moment id — a scorecard refers to moments by id", () => {
    write(FULL_SCRIPT, [
      { id: "dup", at: 0, kind: "question", expect: "x" },
      { id: "dup", at: 1, kind: "decision", expect: "y" },
    ]);
    expect(() => loadScenario(dir)).toThrow(/duplicate/);
  });

  it("rejects a planted moment that does not say what a correct reaction contains", () => {
    write(FULL_SCRIPT, [{ id: "m", at: 0, kind: "question", expect: "  " }]);
    expect(() => loadScenario(dir)).toThrow(/correct reaction/);
  });

  it("fingerprints content, so an edit to the script changes the measuring stick", () => {
    const before = loadScenario(write()).fingerprint;
    const after = loadScenario(write([...FULL_SCRIPT, line(16_000, "mic", "És még valami.")])).fingerprint;
    expect(after).not.toBe(before);
  });

  it("gives an identical fingerprint to identical content", () => {
    const a = loadScenario(write()).fingerprint;
    const b = loadScenario(write()).fingerprint;
    expect(b).toBe(a);
  });
});

describe("playableOf", () => {
  it("strips the authoring metadata — the section must never reach the copilot", () => {
    const played = playableOf(line(0, "mic", "szia")) as Record<string, unknown>;
    expect(played.section).toBeUndefined();
    expect(played.text).toBe("szia");
  });

  it("reads the timestamp of an event as well as a line", () => {
    expect(entryTs({ event: { type: "silence", ts: 900 } })).toBe(900);
  });
});

describe("validateScenario", () => {
  it("passes a scenario that plants all the required roles and both channels", () => {
    expect(validateScenario(loadScenario(write()))).toEqual([]);
  });

  it("rejects a scenario with no planted moments — a silent copilot would score perfectly", () => {
    const problems = validateScenario(loadScenario(write(FULL_SCRIPT, [])));
    expect(problems.map((p) => p.code)).toContain("no-planted-moments");
  });

  it("reports each missing required kind", () => {
    const problems = validateScenario(loadScenario(write(FULL_SCRIPT, [FULL_MOMENTS[0]])));
    const missing = problems.filter((p) => p.code === "missing-kind");
    expect(missing).toHaveLength(DEFAULT_REQUIRED_KINDS.length - 1);
  });

  it("honours a scenario's own required kinds — the alert taxonomy is a project's, not ours", () => {
    const problems = validateScenario(loadScenario(
      write(FULL_SCRIPT, [{ id: "m", at: 0, kind: "árazás", expect: "x" }], { requiredKinds: ["árazás"] }),
    ));
    expect(problems.filter((p) => p.code === "missing-kind")).toEqual([]);
  });

  it("rejects a single-channel scenario", () => {
    const micOnly = FULL_SCRIPT.filter((e) => e.line?.speaker === "mic");
    const problems = validateScenario(loadScenario(write(micOnly)));
    expect(problems.map((p) => p.code)).toContain("single-channel");
  });

  it("rejects a scenario that never addresses the copilot directly", () => {
    const noCommand = FULL_SCRIPT.map((e) => ({ ...e, line: { ...e.line, command: undefined } as never }));
    const problems = validateScenario(loadScenario(write(noCommand)));
    expect(problems.map((p) => p.code)).toContain("no-direct-address");
  });

  it("reports a planted moment that falls after the scenario ends", () => {
    const problems = validateScenario(loadScenario(
      write(FULL_SCRIPT, [...FULL_MOMENTS, { id: "late", at: 99_000, kind: "question", expect: "x" }]),
    ));
    expect(problems.map((p) => p.code)).toContain("moment-after-end");
  });
});

describe("loadValidScenario", () => {
  it("throws with every problem named, so one fix pass can address them all", () => {
    write(FULL_SCRIPT.filter((e) => e.line?.speaker === "mic"), []);
    try {
      loadValidScenario(dir);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ScenarioError);
      expect((err as Error).message).toMatch(/no planted moments/);
      expect((err as Error).message).toMatch(/system-channel/);
    }
  });

  it("returns the scenario when it is runnable", () => {
    expect(loadValidScenario(write()).meta.name).toBe("t");
  });
});
