import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  loadConfig, normalizeKeywords, namePattern, isFillerMessage,
  DEFAULT_ALERTS, DEFAULT_REDACTION, DEFAULT_FILLER_PHRASES, CONFIG_FILENAME,
} from "./config.js";

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
  delete process.env.COPILOT_MIRROR;
});

afterEach(() => {
  rmSync(userHome, { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
  delete process.env.SET_COPILOT_HOME;
  delete process.env.COPILOT_MIRROR;
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

  it("defaults copilot.acknowledge on, and only off when explicitly false", () => {
    expect(loadConfig(project).copilot.acknowledge).toBe(true);
    writeCfg(project, { copilot: { acknowledge: false } });
    expect(loadConfig(project).copilot.acknowledge).toBe(false);
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

describe("chat-mirror config (wall-chat-mirror)", () => {
  it("defaults mirroring off, targeting the tükör category", () => {
    const cfg = loadConfig(project);
    expect(cfg.copilot.mirror.enabled).toBe(false);
    expect(cfg.copilot.mirror.category).toBe("tükör");
  });

  it("enables mirroring only on an explicit true, or the COPILOT_MIRROR env opt-in", () => {
    writeCfg(project, { copilot: { mirror: { enabled: true } } });
    expect(loadConfig(project).copilot.mirror.enabled).toBe(true);

    writeCfg(project, {}); // back to default (off)
    expect(loadConfig(project).copilot.mirror.enabled).toBe(false);
    process.env.COPILOT_MIRROR = "1"; // the skill's start-time opt-in
    expect(loadConfig(project).copilot.mirror.enabled).toBe(true);
  });

  it("lets a project rename the mirror target category", () => {
    writeCfg(project, { copilot: { mirror: { enabled: true, category: "chat" } } });
    expect(loadConfig(project).copilot.mirror.category).toBe("chat");
  });

  it("ships the tükör category and the chat-wide layout with the expected geometry", () => {
    const cfg = loadConfig(project);
    expect(cfg.wall.categories.find((c) => c.id === "tükör")?.render).toBe("text");
    // Named `chat-wide`, not `mirror`, so the layout id can't collide with the
    // `copilot.mirror` feature (a field session proved that collision costs confusion).
    const wide = cfg.wall.layouts.find((l) => l.id === "chat-wide");
    expect(wide).toBeDefined();
    // Two equal columns, one row: big chat mirror on the left, visuals on the right — no
    // unfilled dead region (the summary third is deferred, not shipped empty).
    expect(wide!.areas).toEqual([["szöveg", "prezentáció"]]);
    expect(wide!.columns).toEqual(["1fr", "1fr"]);
  });
});

describe("mirror content policy (wall-text-formatting-and-mirror-policy)", () => {
  it("resolves the shipped defaults, including keeping code blocks", () => {
    const m = loadConfig(project).copilot.mirror;
    expect(m.minLength).toBe(40);
    expect(m.maxLength).toBe(600);
    expect(m.codeBlocks).toBe("keep"); // deliberate change from the old unconditional strip
    expect(m.fillerPhrases).toEqual(DEFAULT_FILLER_PHRASES);
  });

  it("lets a project override the numbers and the code-block handling", () => {
    writeCfg(project, { copilot: { mirror: { minLength: 10, maxLength: 2000, codeBlocks: "collapse" } } });
    const m = loadConfig(project).copilot.mirror;
    expect(m.minLength).toBe(10);
    expect(m.maxLength).toBe(2000);
    expect(m.codeBlocks).toBe("collapse");
  });

  it("falls back on a malformed value rather than resolving to nonsense", () => {
    writeCfg(project, { copilot: { mirror: { minLength: "lots", maxLength: 0, codeBlocks: "shred" } } });
    const m = loadConfig(project).copilot.mirror;
    expect(m.minLength).toBe(40);
    expect(m.maxLength).toBe(600);
    expect(m.codeBlocks).toBe("keep");
  });

  it("honours an explicitly empty phrase list as 'length floor only'", () => {
    // Same posture as transcript.completeWords, the opposite of wall.redaction: nothing
    // leaks by suppressing less, so "no rules" is a legitimate answer here.
    writeCfg(project, { copilot: { mirror: { fillerPhrases: [] } } });
    expect(loadConfig(project).copilot.mirror.fillerPhrases).toEqual([]);
  });

  it("falls back to defaults when the key is absent or malformed", () => {
    writeCfg(project, { copilot: { mirror: { fillerPhrases: "nope" } } });
    expect(loadConfig(project).copilot.mirror.fillerPhrases).toEqual(DEFAULT_FILLER_PHRASES);
  });

  it("drops an invalid pattern with a warning and keeps the rest", () => {
    const warnings: string[] = [];
    const orig = console.warn;
    console.warn = (msg: string) => warnings.push(String(msg));
    try {
      writeCfg(project, { copilot: { mirror: { fillerPhrases: ["jó", "(unclosed", 7] } } });
      expect(loadConfig(project).copilot.mirror.fillerPhrases).toEqual(["jó"]);
    } finally {
      console.warn = orig;
    }
    expect(warnings.join("\n")).toContain("fillerPhrases");
    expect(warnings).toHaveLength(2); // the bad regex and the non-string
  });
});

describe("isFillerMessage", () => {
  it("suppresses a progress statement even when it is over the length floor", () => {
    const msg = "Dolgozom rajta, mindjárt jelentkezem az eredménnyel";
    expect(msg.length).toBeGreaterThan(40); // the length floor alone would let it through
    expect(isFillerMessage(msg, DEFAULT_FILLER_PHRASES)).toBe(true);
  });

  it("suppresses a bare acknowledgement", () => {
    for (const s of ["Rendben.", "  ok!  ", "Megvan", "Understood."]) {
      expect(isFillerMessage(s, DEFAULT_FILLER_PHRASES)).toBe(true);
    }
  });

  it("does not suppress a substantive line that merely opens with an acknowledgement", () => {
    expect(isFillerMessage("Rendben, akkor a következő lépés a redakció bekötése.", DEFAULT_FILLER_PHRASES)).toBe(false);
  });

  it("does not suppress a message that says it is working AND says something", () => {
    expect(isFillerMessage("Dolgozom a javításon. A hiba a redakciós sétában volt.", DEFAULT_FILLER_PHRASES)).toBe(false);
  });

  it("matches the whole message, never a substring anywhere in it", () => {
    expect(isFillerMessage("A teszt eredménye rendben van, mehet a deploy.", DEFAULT_FILLER_PHRASES)).toBe(false);
  });

  it("suppresses nothing when the phrase list is empty", () => {
    expect(isFillerMessage("Rendben.", [])).toBe(false);
  });
});

describe("stt backend config", () => {
  it("defaults to the soniox backend with a whisper-cli fallback binary", () => {
    const cfg = loadConfig(project);
    expect(cfg.sttBackend).toBe("soniox");
    expect(cfg.whisper.bin).toBe("whisper-cli");
    // Default model lives under the (temp) user config dir.
    expect(cfg.whisper.model).toBe(join(userHome, "models", "ggml-small.en.bin"));
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

describe("copilot.names → detect.command", () => {
  it("ships 'copilot' as the default address form", () => {
    const cfg = loadConfig(project);
    expect(cfg.copilot.names).toEqual(["copilot"]);
    expect(cfg.detect.command).toEqual([namePattern("copilot")]);
  });

  it("lets a project use its own nicknames", () => {
    writeFileSync(
      join(project, CONFIG_FILENAME),
      JSON.stringify({ copilot: { names: ["copilot", "tesa"] } }),
    );
    const cfg = loadConfig(project);
    expect(cfg.copilot.names).toEqual(["copilot", "tesa"]);
    expect(cfg.detect.command).toEqual([namePattern("copilot"), namePattern("tesa")]);
  });

  it("merges names with raw detect.command patterns rather than overriding", () => {
    // Names are the friendly front door; detect.command the raw-regex one. Both
    // set the same flag, so a project can use either or both.
    writeFileSync(
      join(project, CONFIG_FILENAME),
      JSON.stringify({ copilot: { names: ["tesa"] }, detect: { command: ["^hey\\b"] } }),
    );
    const cfg = loadConfig(project);
    expect(cfg.detect.command).toEqual([namePattern("tesa"), "^hey\\b"]);
  });

  it("drops blank and non-string names", () => {
    writeFileSync(
      join(project, CONFIG_FILENAME),
      JSON.stringify({ copilot: { names: ["copilot", "  ", 42, ""] } }),
    );
    expect(loadConfig(project).copilot.names).toEqual(["copilot"]);
  });
});

describe("namePattern", () => {
  it("anchors the left side with a Unicode boundary, never \\b", () => {
    // \b treats á as a boundary and silently breaks every accented language.
    expect(namePattern("copilot")).toContain("\\p{L}");
    expect(namePattern("copilot")).not.toContain("\\b");
  });

  it("escapes regex metacharacters — a name is a word, not a pattern", () => {
    const re = new RegExp(namePattern("c++"), "iu");
    expect(re.test("hey c++ do this")).toBe(true);
    expect(re.test("hey cccc do this")).toBe(false);
  });

  it("leaves the right side open so suffixes still match", () => {
    const re = new RegExp(namePattern("copilot"), "iu");
    expect(re.test("megkérdeztem a copilotot")).toBe(true);
    expect(re.test("beszéltem a copilottal")).toBe(true);
  });

  it("does not match a vowel-final name whose stem changes when suffixed", () => {
    // Hungarian lengthens a final -a before a suffix (tesa → tesá-), so the bare
    // stem is genuinely absent from the inflected form. Documented, not fixed:
    // guessing at morphology would cost false positives. Configure both forms.
    const re = new RegExp(namePattern("tesa"), "iu");
    expect(re.test("tesa, nézd")).toBe(true);
    expect(re.test("tesám, nézd")).toBe(false);
  });
});

describe("wall.redaction config (safety seam)", () => {
  it("ships the domain-neutral default when nothing is configured", () => {
    const cfg = loadConfig(project);
    expect(cfg.wall.redaction.patterns).toEqual(["\\[(?:belső|internal)[^\\]]*\\][^\\n]*"]);
    expect(cfg.wall.redaction.replacement).toBe("[…]");
  });

  it("falls back to the default on an EMPTY pattern list (fail-safe, not fail-open)", () => {
    // A safety seam whose "no rules" state means "publish everything raw" is the
    // wrong sign — an empty list must not silently disable redaction while the public
    // narration box keeps shipping.
    writeCfg(project, { wall: { redaction: { patterns: [] } } });
    expect(loadConfig(project).wall.redaction.patterns.length).toBeGreaterThan(0);
  });

  it("honours a project's own non-empty patterns wholesale", () => {
    writeCfg(project, { wall: { redaction: { patterns: ["Project\\s+Hush"], replacement: "[x]" } } });
    const cfg = loadConfig(project);
    expect(cfg.wall.redaction.patterns).toEqual(["Project\\s+Hush"]);
    expect(cfg.wall.redaction.replacement).toBe("[x]");
  });

  it("falls back to the default when patterns are all invalid or all ReDoS-rejected", () => {
    // These pass a `typeof string` filter (non-empty) but COMPILE to zero — the
    // subtle fail-open a config author hits by typing one bad or catastrophic pattern.
    // The fallback is keyed on the compiled count, so the public zone is never left raw.
    for (const patterns of [["(", "(unclosed", "*bad"], ["(a+)+$", "(b*)*$"], ["(([a-z])+)+$"]]) {
      writeCfg(project, { wall: { redaction: { patterns } } });
      expect(loadConfig(project).wall.redaction.patterns).toEqual(DEFAULT_REDACTION.patterns);
    }
  });

  it("keeps a partly-valid list (drops the bad ones at compile, no fallback)", () => {
    writeCfg(project, { wall: { redaction: { patterns: ["(a+)+$", "Project\\s+Hush"] } } });
    // One survives compilation, so the operator's intent is honoured (the ReDoS one is
    // dropped with a warning by the server's real compile).
    expect(loadConfig(project).wall.redaction.patterns).toEqual(["(a+)+$", "Project\\s+Hush"]);
  });
});

describe("wall.scrollHistory config", () => {
  it("defaults to 20", () => {
    expect(loadConfig(project).wall.scrollHistory).toBe(20);
  });
  it("honours a positive override and ignores a bad one", () => {
    writeCfg(project, { wall: { scrollHistory: 5 } });
    expect(loadConfig(project).wall.scrollHistory).toBe(5);
    writeCfg(project, { wall: { scrollHistory: -3 } });
    expect(loadConfig(project).wall.scrollHistory).toBe(20);
  });
});

describe("narráció category + private box subscription (live-narration)", () => {
  it("resolves the narráció category and the private text box subscribes to it", () => {
    const cfg = loadConfig(project);
    expect(cfg.wall.categories.some((c) => c.id === "narráció" && c.render === "text")).toBe(true);
    const priv = cfg.wall.windows.find((w) => w.route === "/");
    const textBox = (priv!.boxes as Record<string, { cats: string[] }>).szöveg;
    expect(textBox.cats).toContain("narráció");
    // Still the private hint box — narration joins riasztás/súgás, doesn't replace them.
    expect(textBox.cats).toEqual(expect.arrayContaining(["riasztás", "súgás", "narráció"]));
  });

  it("a project can rename the category from config without touching src", () => {
    writeCfg(project, {
      wall: { categories: [{ id: "narr", label: "N", icon: "💬", render: "text" }] },
    });
    const cfg = loadConfig(project);
    expect(cfg.wall.categories.map((c) => c.id)).toContain("narr");
  });
});

describe("copilot.narration config (verbosity lever)", () => {
  it("defaults to enabled, normal, 1 line — louder than reactive silence", () => {
    const n = loadConfig(project).copilot.narration;
    expect(n).toEqual({ enabled: true, verbosity: "normal", maxLines: 1 });
  });
  it("honours overrides and merges key by key", () => {
    writeCfg(project, { copilot: { narration: { verbosity: "rich", maxLines: 3 } } });
    const n = loadConfig(project).copilot.narration;
    expect(n).toEqual({ enabled: true, verbosity: "rich", maxLines: 3 });
  });
  it("only an explicit false disables it", () => {
    writeCfg(project, { copilot: { narration: { enabled: false } } });
    expect(loadConfig(project).copilot.narration.enabled).toBe(false);
  });
  it("drops a bad verbosity / non-positive maxLines back to default", () => {
    writeCfg(project, { copilot: { narration: { verbosity: "loud", maxLines: 0 } } });
    const n = loadConfig(project).copilot.narration;
    expect(n.verbosity).toBe("normal");
    expect(n.maxLines).toBe(1);
  });
});

describe("predictive-staging config", () => {
  it("ships the előrejelzés category, a private staging box, and a promote-able public box", () => {
    const cfg = loadConfig(project);
    expect(cfg.wall.categories.some((c) => c.id === "előrejelzés" && c.render === "graph")).toBe(true);
    const priv = cfg.wall.windows.find((w) => w.route === "/")!;
    const staging = (priv.boxes as Record<string, { cats: string[] }>).staging;
    expect(staging.cats).toEqual(["előrejelzés"]);
    // A promoted (public-zone) prediction has somewhere to land on the public wall.
    const pub = cfg.wall.windows.find((w) => w.route === "/wall")!;
    const pubPrez = (pub.boxes as Record<string, { cats: string[] }>).prezentáció;
    expect(pubPrez.cats).toContain("előrejelzés");
  });

  it("defaults staging.ttlMs and honours a positive override, ignoring a bad one", () => {
    expect(loadConfig(project).wall.staging.ttlMs).toBe(120_000);
    writeCfg(project, { wall: { staging: { ttlMs: 5000 } } });
    expect(loadConfig(project).wall.staging.ttlMs).toBe(5000);
    writeCfg(project, { wall: { staging: { ttlMs: -1 } } });
    expect(loadConfig(project).wall.staging.ttlMs).toBe(120_000);
  });
});

describe("transcript config (the stitch seam)", () => {
  it("defaults: stitch on, no speaker names, HU+EN complete words, 2.5s pause gap", () => {
    const t = loadConfig(project).transcript;
    expect(t.stitchOnStop).toBe(true);
    expect(t.speakers).toEqual({});
    expect(t.pauseGapMs).toBe(2500);
    expect(t.completeWords).toContain("illetve"); // hu
    expect(t.completeWords).toContain("just"); // en
  });

  it("a project replaces completeWords and speakers without restating the rest", () => {
    writeCfg(project, {
      transcript: { completeWords: ["e", "o", "que"], speakers: { mic: "Gábor", system: "Robi" } },
    });
    const t = loadConfig(project).transcript;
    expect(t.completeWords).toEqual(["e", "o", "que"]);
    expect(t.speakers).toEqual({ mic: "Gábor", system: "Robi" });
    // untouched keys keep their defaults
    expect(t.stitchOnStop).toBe(true);
    expect(t.pauseGapMs).toBe(2500);
  });

  it("merges key by key over the user-level config", () => {
    writeCfg(userHome, { transcript: { speakers: { mic: "Gábor" }, pauseGapMs: 4000 } });
    writeCfg(project, { transcript: { stitchOnStop: false } });
    const t = loadConfig(project).transcript;
    expect(t.stitchOnStop).toBe(false);
    expect(t.speakers).toEqual({ mic: "Gábor" });
    expect(t.pauseGapMs).toBe(4000);
  });

  it("only an explicit false disables stop-time stitching", () => {
    writeCfg(project, { transcript: {} });
    expect(loadConfig(project).transcript.stitchOnStop).toBe(true);
    writeCfg(project, { transcript: { stitchOnStop: false } });
    expect(loadConfig(project).transcript.stitchOnStop).toBe(false);
  });

  it("an EMPTY completeWords list is honoured — 'never guess' is a valid, lossless choice", () => {
    writeCfg(project, { transcript: { completeWords: [] } });
    expect(loadConfig(project).transcript.completeWords).toEqual([]);
  });

  it("drops malformed entries back to defaults", () => {
    writeCfg(project, {
      transcript: { completeWords: "nem lista", pauseGapMs: -1, speakers: { mic: 42, system: "Robi" } },
    });
    const t = loadConfig(project).transcript;
    expect(t.completeWords).toContain("illetve");
    expect(t.pauseGapMs).toBe(2500);
    expect(t.speakers).toEqual({ system: "Robi" });
  });
});
