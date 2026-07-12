import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadConfig, normalizeKeywords, DEFAULT_ALERTS, CONFIG_FILENAME } from "./config.js";

/** loadConfig() reads the real user config dir — point it at an empty temp dir so
 *  the developer's own ~/.config/set-copilot cannot leak into the assertions. */
let userHome: string;
let project: string;

beforeEach(() => {
  userHome = mkdtempSync(join(tmpdir(), "sc-home-"));
  project = mkdtempSync(join(tmpdir(), "sc-proj-"));
  process.env.SET_COPILOT_HOME = userHome;
  delete process.env.SET_COPILOT_DIR;
  delete process.env.SONIOX_MODE;
  delete process.env.SET_COPILOT_LANGUAGE;
});

afterEach(() => {
  rmSync(userHome, { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
  delete process.env.SET_COPILOT_HOME;
});

const writeCfg = (dir: string, cfg: unknown): void =>
  writeFileSync(join(dir, CONFIG_FILENAME), JSON.stringify(cfg));

describe("normalizeKeywords", () => {
  it("passes a flat list through", () => {
    expect(normalizeKeywords([{ topic: "invoice", stems: ["invoic"] }])).toEqual([
      { topic: "invoice", stems: ["invoic"] },
    ]);
  });

  it("flattens named groups, including the legacy partners/features shape", () => {
    const flat = normalizeKeywords({
      partners: [{ topic: "Acme", stems: ["acme"] }],
      features: [{ topic: "invoice", stems: ["invoic"] }],
    });
    expect(flat.map((k) => k.topic)).toEqual(["Acme", "invoice"]);
  });

  it("drops entries with no topic or no stems", () => {
    const flat = normalizeKeywords([
      { topic: "ok", stems: ["ok"] },
      { topic: "no stems", stems: [] },
      { stems: ["orphan"] },
      null,
    ]);
    expect(flat.map((k) => k.topic)).toEqual(["ok"]);
  });
});

describe("loadConfig", () => {
  it("defaults to English and the built-in alert taxonomy", () => {
    const cfg = loadConfig(project);
    expect(cfg.language).toBe("en");
    expect(cfg.copilot.alerts).toEqual(DEFAULT_ALERTS);
    expect(cfg.knowledge.autoKeywords).toBe(true);
  });

  it("lets the project override the user config key by key", () => {
    writeCfg(userHome, { language: "hu", audio: { micSource: "user-mic" } });
    writeCfg(project, { audio: { monitorSource: "proj-monitor" } });
    const cfg = loadConfig(project);
    expect(cfg.language).toBe("hu"); // inherited from the user config
    expect(cfg.audio.monitorSource).toBe("proj-monitor");
  });

  it("merges nested sections rather than replacing them wholesale", () => {
    writeCfg(userHome, { knowledge: { keywords: [{ topic: "shared", stems: ["shared"] }] } });
    writeCfg(project, { knowledge: { sources: ["docs"] } });
    const cfg = loadConfig(project);
    expect(cfg.knowledge.sources).toEqual(["docs"]);
    expect(cfg.knowledge.keywords.map((k) => k.topic)).toEqual(["shared"]);
  });

  it("accepts a custom alert taxonomy and drops malformed entries", () => {
    writeCfg(project, {
      copilot: {
        alerts: [
          { key: "pricing", emoji: "💰", priority: "high", when: "a price is quoted" },
          { key: "broken", priority: "low" },
        ],
      },
    });
    const cfg = loadConfig(project);
    expect(cfg.copilot.alerts.map((a) => a.key)).toEqual(["pricing"]);
  });

  it("falls back to the default taxonomy when alerts is empty", () => {
    writeCfg(project, { copilot: { alerts: [] } });
    expect(loadConfig(project).copilot.alerts).toEqual(DEFAULT_ALERTS);
  });

  it("keeps env overrides above the config file", () => {
    writeCfg(project, { sonioxMode: "rt", runtimeDir: "/tmp/from-file" });
    process.env.SONIOX_MODE = "chunk";
    process.env.SET_COPILOT_DIR = "/tmp/from-env";
    const cfg = loadConfig(project);
    expect(cfg.sonioxMode).toBe("chunk");
    expect(cfg.runtimeDir).toBe("/tmp/from-env");
    expect(cfg.transcriptOutput).toBe("/tmp/from-env/transcript.jsonl");
  });

  it("rejects an unknown sonioxMode instead of passing it to Soniox", () => {
    process.env.SONIOX_MODE = "nonsense";
    expect(loadConfig(project).sonioxMode).toBe("rt");
  });

  it("throws with the offending path when a config file is malformed", () => {
    writeFileSync(join(project, CONFIG_FILENAME), "{ not json");
    expect(() => loadConfig(project)).toThrow(/Failed to parse .*set-copilot\.config\.json/);
  });
});
