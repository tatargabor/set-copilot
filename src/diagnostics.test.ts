import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  diagnoseConfig,
  diagnoseMirror,
  knownConfigKeys,
  stopHookRegistered,
  type HookSource,
} from "./diagnostics.js";

const PROJ = "/proj/set-copilot.config.json";
const USER = "/home/u/.config/set-copilot/set-copilot.config.json";

const file = (path: string, data: Record<string, unknown>) => ({ path, data });

describe("diagnoseConfig — keywords", () => {
  it("reports declared and effective counts when a flat string list normalizes to zero", () => {
    // The real 2026-07-28 set-promo value: 15 bare strings, none with topic/stems.
    const keywords = [
      "raketa", "promo", "kampány", "ügyfél", "árazás", "határidő", "szállítás",
      "raktár", "számla", "ajánlat", "szerződés", "partner", "termék", "kedvezmény", "logisztika",
    ];
    const findings = diagnoseConfig([file(PROJ, { knowledge: { keywords } })]);
    const kw = findings.filter((f) => f.message.includes("knowledge.keywords"));
    expect(kw).toHaveLength(1);
    expect(kw[0].level).toBe("warn");
    expect(kw[0].message).toContain("15");
    expect(kw[0].message).toContain("0");
    expect(kw[0].fix).toContain("topic");
    expect(kw[0].fix).toContain("stems");
  });

  it("says nothing when every declared keyword survives normalization", () => {
    const keywords = [{ topic: "raketa", stems: ["raket"] }, { topic: "promo", stems: ["promó"] }];
    const findings = diagnoseConfig([file(PROJ, { knowledge: { keywords } })]);
    expect(findings.filter((f) => f.message.includes("keywords"))).toHaveLength(0);
  });

  it("counts the legacy grouped shape by its flattened entries", () => {
    const keywords = { partners: [{ topic: "acme", stems: ["acme"] }], broken: ["nope"] };
    const findings = diagnoseConfig([file(PROJ, { knowledge: { keywords } })]);
    const kw = findings.filter((f) => f.message.includes("knowledge.keywords"));
    expect(kw).toHaveLength(1);
    expect(kw[0].message).toContain("2");
    expect(kw[0].message).toContain("1");
  });
});

describe("diagnoseConfig — unknown keys", () => {
  it("names an unknown key, at top level and one level in", () => {
    const findings = diagnoseConfig([
      file(PROJ, { langauge: "hu", audio: { micSorce: "x" } }),
    ]);
    const unknown = findings.filter((f) => f.message.includes("ismeretlen kulcs"));
    expect(unknown).toHaveLength(1);
    expect(unknown[0].message).toContain("langauge");
    expect(unknown[0].message).toContain("audio.micSorce");
    expect(unknown[0].level).toBe("warn");
  });

  it("yields no finding for a config of only known keys", () => {
    const findings = diagnoseConfig([
      file(PROJ, {
        language: "hu",
        sonioxMode: "rt",
        whisper: { bin: "whisper-cli", model: "" },
        audio: { micSource: "mic", monitorSource: "" },
        knowledge: { adapter: "markdown", sources: ["docs"], autoKeywords: true },
        copilot: { instructions: "…", engagement: "reactive" },
        wall: { port: 4180 },
        transcript: { stitchOnStop: true },
      }),
    ]);
    expect(findings).toEqual([]);
  });

  it("accepts the shipped example config without a single finding", () => {
    const example = JSON.parse(
      readFileSync(join(process.cwd(), "set-copilot.config.example.json"), "utf-8"),
    ) as Record<string, unknown>;
    expect(diagnoseConfig([file(PROJ, example)])).toEqual([]);
  });

  it("reports a malformed file once, and diagnoses nothing else in it", () => {
    const findings = diagnoseConfig([{ path: PROJ, parseError: "Unexpected token }" }]);
    expect(findings).toHaveLength(1);
    expect(findings[0].level).toBe("warn");
    expect(findings[0].message).toContain("érvénytelen JSON");
  });
});

describe("diagnoseConfig — runtimeDir override", () => {
  it("reports one info finding naming the environment as the winner", () => {
    const findings = diagnoseConfig(
      [file(PROJ, { runtimeDir: "/tmp/set-copilot" })],
      { envRuntimeDir: "/proj/.set/copilot/abc" },
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].level).toBe("info");
    expect(findings[0].message).toContain("/tmp/set-copilot");
    expect(findings[0].message).toContain("/proj/.set/copilot/abc");
    expect(findings[0].message).toContain("SET_COPILOT_DIR");
  });

  it("says nothing when the environment does not override", () => {
    const findings = diagnoseConfig([file(PROJ, { runtimeDir: "/tmp/set-copilot" })], {});
    expect(findings).toEqual([]);
  });

  it("reports once when both files set it, naming the value that would have won", () => {
    const findings = diagnoseConfig(
      [file(USER, { runtimeDir: "/tmp/user" }), file(PROJ, { runtimeDir: "/tmp/proj" })],
      { envRuntimeDir: "/scoped" },
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('runtimeDir="/tmp/proj"');
    expect(findings[0].message).toContain(USER);
  });
});

describe("diagnoseConfig — missing wall section", () => {
  it("is informational, never a warning", () => {
    const findings = diagnoseConfig([file(PROJ, { language: "hu" })], { hasWall: true });
    expect(findings).toHaveLength(1);
    expect(findings[0].level).toBe("info");
    expect(findings[0].message).toContain("wall");
  });

  it("is not reported when some file does configure a wall", () => {
    const findings = diagnoseConfig(
      [file(USER, { wall: { port: 4180 } }), file(PROJ, { language: "hu" })],
      { hasWall: true },
    );
    expect(findings).toEqual([]);
  });

  it("is not reported for a project with no wall at all", () => {
    expect(diagnoseConfig([file(PROJ, { language: "hu" })], { hasWall: false })).toEqual([]);
  });
});

describe("stopHookRegistered", () => {
  const stop = (command: string) => ({
    hooks: { Stop: [{ matcher: "", hooks: [{ type: "command", command }] }] },
  });

  it("matches the project-scope command string", () => {
    const s = stop('bash "$CLAUDE_PROJECT_DIR/.claude/hooks/wall-mirror.sh"');
    expect(stopHookRegistered(s, "wall-mirror.sh")).toBe(true);
  });

  it("matches the global-scope command string", () => {
    const s = stop('bash "/home/u/.claude/hooks/wall-mirror.sh"');
    expect(stopHookRegistered(s, "wall-mirror.sh")).toBe(true);
  });

  it("matches a wrapped command", () => {
    const s = stop('cd /x && bash ./hooks/wall-mirror.sh 2>/dev/null || true');
    expect(stopHookRegistered(s, "wall-mirror.sh")).toBe(true);
  });

  it("reports absent when only unrelated Stop hooks are registered", () => {
    const s = stop('bash "$CLAUDE_PROJECT_DIR/.claude/hooks/other.sh"');
    expect(stopHookRegistered(s, "wall-mirror.sh")).toBe(false);
    expect(stopHookRegistered({}, "wall-mirror.sh")).toBe(false);
    expect(stopHookRegistered({ hooks: {} }, "wall-mirror.sh")).toBe(false);
  });

  it("returns unknown for a malformed settings object, and never throws", () => {
    expect(stopHookRegistered("not an object", "wall-mirror.sh")).toBe("unknown");
    expect(stopHookRegistered({ hooks: { Stop: "nope" } }, "wall-mirror.sh")).toBe("unknown");
    expect(stopHookRegistered({ hooks: { Stop: [{ hooks: 7 }] } }, "wall-mirror.sh")).toBe("unknown");
    expect(stopHookRegistered({ hooks: [] }, "wall-mirror.sh")).toBe("unknown");
  });
});

describe("diagnoseMirror", () => {
  const base = {
    followerPid: null as number | null,
    markerExists: false,
    wallRunning: false,
    lastEmission: null as string | null,
    runtimeDir: "/d",
  };

  it("blames the missing follower when the marker is set and a wall runs (the 2026-07-28 field case)", () => {
    // A marker with no delivery mechanism and a mechanism with no marker look identical from
    // the wall — both an empty wall, no error. So each is answered separately, by name.
    const r = diagnoseMirror({
      ...base, markerExists: true, wallRunning: true, runtimeDir: "/proj/.set/copilot/abc",
    });
    expect(r.follower.ok).toBe(false);
    expect(r.marker.ok).toBe(true);
    expect(r.wall.ok).toBe(true);
    expect(r.ready).toBe(false);
    expect(r.followerRunning).toBe(false);
    expect(r.follower.fix).toContain("mirror-follow");
    expect(r.runtimeDir).toBe("/proj/.set/copilot/abc");
  });

  it("is ready only when all three hold", () => {
    const r = diagnoseMirror({ ...base, followerPid: 4242, markerExists: true, wallRunning: true });
    expect([r.follower.ok, r.marker.ok, r.wall.ok]).toEqual([true, true, true]);
    expect(r.ready).toBe(true);
    expect(r.follower.fix).toBeUndefined();
    expect(r.follower.message).toContain("4242");
  });

  it("answers each state separately when none hold", () => {
    const r = diagnoseMirror(base);
    expect([r.follower.ok, r.marker.ok, r.wall.ok, r.activity.ok]).toEqual([false, false, false, false]);
    expect(r.ready).toBe(false);
    for (const st of [r.follower, r.marker, r.wall, r.activity]) expect(st.fix).toBeTruthy();
  });

  it("reports when the mirror last emitted — the state whose absence caused a misdiagnosis", () => {
    // 2026-07-29: a wall believed to have stopped mirroring at 20:52 had in fact delivered
    // its last message at 20:57:40. A reported last-emission time makes that unmistakable.
    const r = diagnoseMirror({ ...base, followerPid: 7, lastEmission: "2026-07-29T18:57:40.000Z" });
    expect(r.activity.ok).toBe(true);
    expect(r.activity.message).toContain("18:57:40");
  });

  it("warns about a retired mirror Stop hook that is still registered", () => {
    // Not a precondition — the opposite: with the follower running it would double every line.
    const r = diagnoseMirror({
      ...base,
      followerPid: 9,
      staleHook: [{ path: "/proj/.claude/settings.json", registered: true }],
    });
    expect(r.staleHook?.ok).toBe(false);
    expect(r.staleHook?.message).toContain("/proj/.claude/settings.json");
    expect(r.staleHook?.fix).toContain("set-copilot init");
  });

  it("says nothing about a stale hook when none is registered", () => {
    const r = diagnoseMirror({
      ...base, staleHook: [{ path: "/proj/.claude/settings.json", registered: false }],
    });
    expect(r.staleHook).toBeUndefined();
  });
});

describe("known-key set (D2 guard)", () => {
  /**
   * WEAKENING THIS TEST SILENTLY NARROWS THE CHECKER.
   *
   * The unknown-key check can only be as complete as `knownConfigKeys()`, and that set is
   * derived from `DEFAULTS` + `EXTRA_KNOWN_KEYS`. A config key that `loadConfig` reads but
   * the set does not contain would be reported to a user as "unknown" — the drift detector
   * becoming a source of drift. So: scan what `loadConfig` actually reads and require the
   * set to cover it. If this fails, add the key to `EXTRA_KNOWN_KEYS` (or to `DEFAULTS`),
   * never a skip or a loosened assertion here.
   */
  it("covers every config key loadConfig reads", () => {
    const src = readFileSync(join(process.cwd(), "src", "config.ts"), "utf-8");
    const start = src.indexOf("export function loadConfig");
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf("\n}\n", start));

    const read = new Set<string>();
    // `fileCfg.audio?.micSource` / `userCfg.knowledge` — the raw file objects.
    for (const m of body.matchAll(/\b(?:fileCfg|userCfg|projCfg)\.(\w+)\??\.?(\w+)?/g)) {
      read.add(m[1]);
      if (m[2]) read.add(`${m[1]}.${m[2]}`);
    }
    // The per-section merged objects, read one level deep. The lookbehind keeps string
    // literals out (`join(runtimeDir, "transcript.jsonl")` is a path, not a config read).
    for (const m of body.matchAll(/(?<!["'`\w.])(knowledge|copilot|detect|wall|transcript)\??\.(\w+)/g)) {
      read.add(`${m[1]}.${m[2]}`);
    }

    // A scan that finds nothing would pass vacuously — that is the silent narrowing this
    // test exists to prevent, so assert it actually saw the config surface.
    expect(read.size).toBeGreaterThan(30);
    expect(read.has("knowledge.keywords")).toBe(true);
    expect(read.has("audio.micSource")).toBe(true);

    const known = knownConfigKeys();
    const missing = [...read].filter((k) => !known.has(k)).sort();
    expect(missing).toEqual([]);
  });
});
