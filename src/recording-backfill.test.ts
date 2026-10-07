/**
 * recording-handover: the built-in target and back-fill, against real temporary git repos.
 *
 * Every test points SET_COPILOT_HOME at a temp dir: `loadConfig` reads the user layer, and
 * nothing here may touch the developer's own ~/.config/set-copilot.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CONFIG_FILENAME, loadConfig } from "./config.js";
import { classifyRecordings, runBackfill, scanRecordings } from "./recording-backfill.js";
import {
  DEFAULT_TARGET_DIR, backfillMarkerPath, hasSpeech, localDate, persistToDefaultTarget, recordHandover, recordedAt, sha256File,
} from "./recording-store.js";

let repo: string;
let home: string;

const git = (...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd: repo, stdio: "pipe" }).toString();

/** A recording with real speech lines, written under `.set/copilot/<session>/`. */
function record(session: string, name: string, text = "Szia, ez egy teszt."): string {
  const dir = join(repo, ".set", "copilot", session);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, `${JSON.stringify({ ts: 1000, startTs: 0, speaker: "mic", text, final: true })}\n`);
  return path;
}

/** Every file under the repo and under SET_COPILOT_HOME, with its hash — "did anything change?". */
function snapshot(): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (base: string, d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.name === ".git") continue;
      if (e.isDirectory()) walk(base, p);
      else out[`${base}:${relative(base, p)}`] = createHash("sha256").update(readFileSync(p)).digest("hex");
    }
  };
  walk(repo, repo);
  walk(home, home);
  return out;
}

const NOON = "2026-10-05T12-00-00-000Z";
const DAY = localDate(new Date("2026-10-05T12:00:00.000Z"));

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "sc-backfill-repo-"));
  home = mkdtempSync(join(tmpdir(), "sc-backfill-home-"));
  process.env.SET_COPILOT_HOME = home;
  delete process.env.SET_COPILOT_DIR;
  git("init", "-q");
  writeFileSync(join(repo, ".gitignore"), ".set/\n");
  git("add", ".gitignore");
  git("commit", "-q", "-m", "init");
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(repo, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
  delete process.env.SET_COPILOT_HOME;
});

const quiet = () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
};

describe("recordedAt / hasSpeech", () => {
  it("reads the archive's UTC stamp, not the transcript's offsets", () => {
    expect(recordedAt(`/x/dictation-2026-10-05T17-27-54-794Z.jsonl`).toISOString()).toBe("2026-10-05T17:27:54.794Z");
  });

  it("speech is a line with text; silence/reconnect events and junk are not", () => {
    expect(hasSpeech('{"type":"silence","duration_ms":3000}\n')).toBe(false);
    expect(hasSpeech("not json\n")).toBe(false);
    expect(hasSpeech('{"ts":1,"speaker":"mic","text":"igen"}\n')).toBe(true);
  });
});

describe("persistToDefaultTarget — the built-in target", () => {
  it("copies raw, readable and stitched as <date>-<kind>-part1.*, the raw byte for byte, nothing staged", () => {
    const raw = record("s1", `dictation-${NOON}.jsonl`);
    const md = raw.replace(/\.jsonl$/, ".md");
    const st = raw.replace(/\.jsonl$/, "-stitched.jsonl");
    writeFileSync(md, "# readable\n");
    writeFileSync(st, "{}\n");
    const out = persistToDefaultTarget(repo, { archived: raw, markdown: md, structured: st }, "dictation");
    const base = join(repo, "docs", "inputs", "copilot", `${DAY}-dictation-part1-${sha256File(raw).slice(0, 8)}`);
    expect(out.written).toEqual([`${base}.jsonl`, `${base}.md`, `${base}-stitched.jsonl`]);
    expect(sha256File(`${base}.jsonl`)).toBe(sha256File(raw));
    expect(git("diff", "--cached", "--name-only")).toBe("");
  });

  it("skips content that is already in the work tree under ANY name, and says where", () => {
    const raw = record("s1", `transcript-${NOON}.jsonl`);
    mkdirSync(join(repo, "notes"), { recursive: true });
    writeFileSync(join(repo, "notes", "kept-copy.jsonl"), readFileSync(raw));
    git("add", "notes/kept-copy.jsonl");
    const out = persistToDefaultTarget(repo, { archived: raw }, "meeting");
    expect(out).toMatchObject({ written: [], existing: "notes/kept-copy.jsonl" });
    expect(existsSync(join(repo, "docs"))).toBe(false);
  });

  it("is idempotent: an untracked copy from the previous run counts", () => {
    const raw = record("s1", `dictation-${NOON}.jsonl`);
    expect(persistToDefaultTarget(repo, { archived: raw }, "dictation").written).toHaveLength(1);
    expect(persistToDefaultTarget(repo, { archived: raw }, "dictation").written).toEqual([]);
  });

  it("numbers parts past names used on disk and in HEAD, and the content hash keeps names unique", () => {
    const dir = join(repo, "docs", "inputs", "copilot");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${DAY}-meeting-part1-aaaaaaaa.md`), "on disk only\n");
    writeFileSync(join(dir, `${DAY}-meeting-part2-bbbbbbbb.jsonl`), "committed, then deleted locally\n");
    git("add", "docs");
    git("commit", "-q", "-m", "part2");
    rmSync(join(dir, `${DAY}-meeting-part2-bbbbbbbb.jsonl`));
    const raw = record("s1", `transcript-${NOON}.jsonl`);
    const out = persistToDefaultTarget(repo, { archived: raw }, "meeting");
    expect(out.written).toEqual([join(dir, `${DAY}-meeting-part3-${sha256File(raw).slice(0, 8)}.jsonl`)]);
  });

  it("a recording with no speech is not saved", () => {
    mkdirSync(join(repo, ".set", "copilot", "s1"), { recursive: true });
    const raw = join(repo, ".set", "copilot", "s1", `dictation-${NOON}.jsonl`);
    writeFileSync(raw, '{"type":"silence","duration_ms":3000}\n');
    expect(persistToDefaultTarget(repo, { archived: raw }, "dictation")).toMatchObject({ written: [], skipped: "nothing was said" });
  });

  it("runtime state never counts as a saved copy, even when .set/ is not ignored", () => {
    writeFileSync(join(repo, ".gitignore"), "");
    const raw = record("s1", `dictation-${NOON}.jsonl`);
    const out = persistToDefaultTarget(repo, { archived: raw }, "dictation");
    expect(out.existing).toBeUndefined();
    expect(out.written).toHaveLength(1);
  });

  it("outside a git work tree it creates nothing", () => {
    const loose = mkdtempSync(join(tmpdir(), "sc-loose-"));
    try {
      const raw = join(loose, "dictation-x.jsonl");
      writeFileSync(raw, '{"text":"x"}\n');
      expect(persistToDefaultTarget(loose, { archived: raw }, "dictation")).toEqual({ written: [], skipped: "not inside a git work tree" });
      expect(readdirSync(loose)).toEqual(["dictation-x.jsonl"]);
    } finally { rmSync(loose, { recursive: true, force: true }); }
  });
});

describe("scanRecordings / classifyRecordings", () => {
  it("finds archives and nested recordings; skips stitched files, speechless files and a live capture's file", () => {
    record("s1", `dictation-${NOON}.jsonl`);
    record("s1", `dictation-${NOON}-stitched.jsonl`);
    record("s2", "transcript.jsonl"); // live name, no capture → a recording
    record("s3", "transcript.jsonl"); // live name, capture alive → left alone
    writeFileSync(join(repo, ".set", "copilot", "s3", "capture.pid"), String(process.pid));
    record(join("s4", ".set", "copilot", "s4"), `transcript-${NOON}.jsonl`, "nested"); // the nested shape a survey found
    record("s6", "transcript.jsonl", "replayed fixture");
    writeFileSync(join(repo, ".set", "copilot", "s6", "replay-run.json"), "{}");
    mkdirSync(join(repo, ".set", "copilot", "s5"), { recursive: true });
    writeFileSync(join(repo, ".set", "copilot", "s5", "dictation-x.jsonl"), '{"type":"silence","duration_ms":3000}\n');
    const scan = scanRecordings(repo);
    expect(scan.recordings.map((r) => relative(join(repo, ".set", "copilot"), r.path)).sort()).toEqual([
      `s1/dictation-${NOON}.jsonl`, "s2/transcript.jsonl", `s4/.set/copilot/s4/transcript-${NOON}.jsonl`,
    ].sort());
    expect(scan.live).toEqual([join(repo, ".set", "copilot", "s3", "transcript.jsonl")]);
    expect(scan.speechless).toBe(1);
  });

  it("a recording handed to a project command (recovery ledger) is saved without a byte copy", () => {
    const raw = record("s1", `dictation-${NOON}.jsonl`);
    const other = record("s1", `dictation-2026-10-06T12-00-00-000Z.jsonl`, "másik");
    recordHandover(repo, sha256File(raw), raw, { via: "command", kind: "dictation", key: "copilot.dictationHandoverCommand" });
    const c = classifyRecordings(repo, scanRecordings(repo).recordings)!;
    expect(c.unsaved.map((r) => r.path)).toEqual([other]);
    expect(c.saved[0].evidence).toContain("recovery ledger");
  });
});

describe("runBackfill", () => {
  const cfg = () => loadConfig(repo);

  it("--dry-run lists and writes nothing anywhere", () => {
    record("s1", `dictation-${NOON}.jsonl`);
    const before = snapshot();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(runBackfill(cfg(), "dry-run")).toBe(0);
    expect(snapshot()).toEqual(before);
    expect(log.mock.calls.flat().join("\n")).toContain("would save  dictation");
  });

  it("saves through the built-in target with the readable file, never commits, and a second run does nothing", () => {
    const raw = record("s1", `dictation-${NOON}.jsonl`);
    const rawBytes = readFileSync(raw);
    quiet();
    expect(runBackfill(cfg(), "run")).toBe(0);
    const dir = join(repo, "docs", "inputs", "copilot");
    const base = `${DAY}-dictation-part1-${sha256File(raw).slice(0, 8)}`;
    expect(readdirSync(dir).sort()).toEqual([`${base}-stitched.jsonl`, `${base}.jsonl`, `${base}.md`]);
    expect(readFileSync(raw)).toEqual(rawBytes); // copied, never moved or changed
    expect(git("diff", "--cached", "--name-only")).toBe("");
    const marker = JSON.parse(readFileSync(backfillMarkerPath(repo), "utf-8"));
    expect(marker.handedOver).toEqual([expect.objectContaining({ kind: "dictation", via: "default", ok: true })]);

    const after = snapshot();
    expect(runBackfill(cfg(), "run")).toBe(0);
    const again = snapshot();
    // Only the marker's timestamp may move; nothing else.
    delete after[`${repo}:${relative(repo, backfillMarkerPath(repo))}`];
    delete again[`${repo}:${relative(repo, backfillMarkerPath(repo))}`];
    expect(again).toEqual(after);
  });

  it("hands a kind with a configured command to that command, with SET_COPILOT_BACKFILL=1", () => {
    record("s1", `transcript-${NOON}.jsonl`);
    const proof = join(repo, ".set", "proof.txt");
    writeFileSync(join(repo, ".set", "dump.cjs"), "require('fs').appendFileSync(process.argv[2], process.env.SET_COPILOT_KIND + ':' + process.env.SET_COPILOT_BACKFILL + ':' + !!process.env.SET_COPILOT_TRANSCRIPT_MD + '\\n')");
    writeFileSync(join(repo, CONFIG_FILENAME), JSON.stringify({ copilot: { handoverCommand: `node ${JSON.stringify(join(repo, ".set", "dump.cjs"))} ${JSON.stringify(proof)}` } }));
    quiet();
    expect(runBackfill(cfg(), "run")).toBe(0);
    expect(readFileSync(proof, "utf-8")).toBe("meeting:1:true\n");
    expect(existsSync(join(repo, "docs"))).toBe(false);
    // Recorded as handed over: the next run does not call the command again.
    expect(runBackfill(cfg(), "run")).toBe(0);
    expect(readFileSync(proof, "utf-8")).toBe("meeting:1:true\n");
  });

  it("--check is silent when everything is saved, one line otherwise, and always exits 0", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(runBackfill(cfg(), "check")).toBe(0);
    expect(log).not.toHaveBeenCalled();
    record("s1", `dictation-${NOON}.jsonl`);
    record("s1", `dictation-2026-10-06T12-00-00-000Z.jsonl`, "második");
    record("s2", `transcript-${NOON}.jsonl`, "meeting");
    expect(runBackfill(cfg(), "check")).toBe(0);
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toMatch(/3 recording\(s\).*\(2 dictation, 1 meeting\).*set-copilot backfill/);
    expect(statSync(repo).isDirectory()).toBe(true);
  });
});

describe("back-fill under the default-target stand-down (default-target-stands-down-on-public)", () => {
  const addRemote = (url: string) =>
    execFileSync("git", ["remote", "add", "origin", url], { cwd: repo, stdio: "pipe" });

  it("a github remote keeps recordings back: one summary line, exit 0, nothing copied", () => {
    addRemote("git@github.com:owner/repo.git");
    record("s1", "dictation-1.jsonl", "Első dikatált mondat.");
    record("s2", "dictation-2.jsonl", "Második diktált mondat.");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    const code = runBackfill(loadConfig(repo), "run");

    expect(code).toBe(0);
    // Nothing was copied — the gate sits before the copy.
    expect(existsSync(join(repo, "docs"))).toBe(false);
    // The suppression is reported ONCE for the run, not per recording.
    const summary = log.mock.calls.map((c) => String(c[0])).join("\n");
    expect(summary).toContain("2 kept back (public remote: github.com)");
    expect(summary.match(/public remote: github\.com/g)?.length).toBe(1);
    expect(summary).not.toContain("failed");
  });

  it("--check stays silent when the only unsaved recordings are kept back", () => {
    addRemote("https://github.com/owner/repo.git");
    record("s1", "dictation-1.jsonl");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    runBackfill(loadConfig(repo), "check");
    expect(log).not.toHaveBeenCalled();
  });

  it("--dry-run lists kept recordings with the reason", () => {
    addRemote("git@github.com:owner/repo.git");
    record("s1", "dictation-1.jsonl");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    runBackfill(loadConfig(repo), "dry-run");
    const out = log.mock.calls.map((c) => String(c[0])).join("\n");
    expect(out).toContain("kept back");
    expect(out).toContain("public remote: github.com");
  });

  it("a private cache mark restores the copy", () => {
    addRemote("git@github.com:owner/repo.git");
    record("s1", "dictation-1.jsonl");
    writeFileSync(
      join(home, "repo-visibility.json"),
      JSON.stringify({ [realpathSync(repo)]: "private" }),
    );
    vi.spyOn(console, "log").mockImplementation(() => {});

    const code = runBackfill(loadConfig(repo), "run");

    expect(code).toBe(0);
    expect(readdirSync(join(repo, DEFAULT_TARGET_DIR)).some((f) => f.endsWith(".jsonl"))).toBe(true);
  });

  it('copilot.defaultHandover "on" forces the copy; "off" keeps back with the config reason', () => {
    addRemote("git@github.com:owner/repo.git");
    record("s1", "dictation-1.jsonl", "Első diktált mondat.");
    record("s2", "dictation-2.jsonl", "Második diktált mondat.");
    vi.spyOn(console, "log").mockImplementation(() => {});

    const on = { ...loadConfig(repo), copilot: { ...loadConfig(repo).copilot, defaultHandover: "on" } } as ReturnType<typeof loadConfig>;
    expect(runBackfill(on, "run")).toBe(0);
    expect(readdirSync(join(repo, DEFAULT_TARGET_DIR)).some((f) => f.endsWith(".jsonl"))).toBe(true);

    record("s3", "dictation-3.jsonl", "Harmadik diktált mondat.");
    const off = { ...loadConfig(repo), copilot: { ...loadConfig(repo).copilot, defaultHandover: "off" } } as ReturnType<typeof loadConfig>;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(runBackfill(off, "run")).toBe(0);
    expect(log.mock.calls.map((c) => String(c[0])).join("\n")).toContain('kept back (copilot.defaultHandover: "off")');
  });

  it("a configured dictation command is never gated, even on a public-host remote", () => {
    addRemote("git@github.com:owner/repo.git");
    record("s1", "dictation-1.jsonl");
    const cfg = loadConfig(repo);
    (cfg.copilot as { dictationHandoverCommand?: string }).dictationHandoverCommand = "true";
    vi.spyOn(console, "log").mockImplementation(() => {});

    const code = runBackfill(cfg, "run");

    expect(code).toBe(0);
    expect(existsSync(join(repo, "docs"))).toBe(false); // the command, not the default target, ran
  });
});
