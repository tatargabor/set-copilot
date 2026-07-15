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
  delete process.env.STT_BACKEND;
  delete process.env.WHISPER_MODEL;
  delete process.env.WHISPER_BIN;
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

describe("stt backend config", () => {
  it("defaults to the soniox backend with a whisper-cli fallback binary", () => {
    const cfg = loadConfig(project);
    expect(cfg.sttBackend).toBe("soniox");
    expect(cfg.whisper.bin).toBe("whisper-cli");
    // Default model lives under the (temp) user config dir.
    expect(cfg.whisper.model).toBe(join(userHome, "models", "ggml-base.bin"));
  });

  it("selects whisper from the config file", () => {
    writeCfg(project, { sttBackend: "whisper", whisper: { bin: "/opt/whisper", model: "/models/hu.bin" } });
    const cfg = loadConfig(project);
    expect(cfg.sttBackend).toBe("whisper");
    expect(cfg.whisper.bin).toBe("/opt/whisper");
    expect(cfg.whisper.model).toBe("/models/hu.bin");
  });

  it("lets STT_BACKEND / WHISPER_MODEL env vars win over the file", () => {
    writeCfg(project, { sttBackend: "soniox", whisper: { model: "/from/file.bin" } });
    process.env.STT_BACKEND = "whisper";
    process.env.WHISPER_MODEL = "/from/env.bin";
    const cfg = loadConfig(project);
    expect(cfg.sttBackend).toBe("whisper");
    expect(cfg.whisper.model).toBe("/from/env.bin");
  });

  it("falls back to soniox for an unknown backend value", () => {
    process.env.STT_BACKEND = "nonsense";
    expect(loadConfig(project).sttBackend).toBe("soniox");
  });
});

describe("copilot engagement config", () => {
  it("defaults to a reactive watcher, 3 lines, no web research", () => {
    const cfg = loadConfig(project);
    expect(cfg.copilot.engagement).toBe("reactive");
    expect(cfg.copilot.maxLines).toBe(3);
    expect(cfg.copilot.allowWebResearch).toBe(false);
  });

  it("takes engagement, maxLines and allowWebResearch from the project config", () => {
    writeCfg(project, {
      copilot: { engagement: "participant", maxLines: 6, allowWebResearch: true },
    });
    const cfg = loadConfig(project);
    expect(cfg.copilot.engagement).toBe("participant");
    expect(cfg.copilot.maxLines).toBe(6);
    expect(cfg.copilot.allowWebResearch).toBe(true);
  });

  it("falls back to the default on a bogus engagement rather than passing it to the prompt", () => {
    writeCfg(project, { copilot: { engagement: "chatty", maxLines: -4 } });
    const cfg = loadConfig(project);
    expect(cfg.copilot.engagement).toBe("reactive");
    expect(cfg.copilot.maxLines).toBe(3);
  });
});
