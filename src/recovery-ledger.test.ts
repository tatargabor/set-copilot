/**
 * The recovery ledger's migration semantics.
 *
 * These are named for the property being fenced, not the function being called: the ledger
 * exists so an expensive model pass over a whole meeting runs **once per transcript, ever**,
 * and every test here is a way that guarantee could quietly stop holding.
 *
 * The CLI-level behaviours (skip by default, `--force`, `recovery status` mutating nothing)
 * are exercised through the real `set-copilot` binary, because "the second run does nothing"
 * is a claim about the command, not about a function.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  appendEntry, danglingClaims, doneEntry, entriesFor, fingerprintFile, isDone, ledgerPath,
  makeEntry, readLedger, stepStatus, STITCH_VERSION,
} from "./recovery-ledger.js";
import type { CopilotConfig } from "./config.js";

const CLI = join(process.cwd(), "dist", "cli.js");

let root: string;
let ledger: string;

/** A transcript with two speakers, enough for the stitch to produce sentences. */
function transcript(dir: string, name: string, marker = "alap"): string {
  const path = join(dir, name);
  writeFileSync(
    path,
    [
      JSON.stringify({ ts: 1000, speaker: "mic", text: `Ez a ${marker} szövege.`, final: true }),
      JSON.stringify({ ts: 4000, speaker: "system", text: "Rendben, értem.", final: true }),
    ].join("\n") + "\n",
  );
  return path;
}

/**
 * Run the real CLI against this project root.
 *
 * `spawnSync`, not `execFileSync`: several of these assertions are about what the command
 * *reports* on stderr (how many it skipped, how many are stale), and `execFileSync` only
 * hands back stderr on a non-zero exit — the successful runs are exactly the ones under test.
 */
function cli(args: string[], opts: { input?: string } = {}): { out: string; err: string; code: number } {
  const r = spawnSync("node", [CLI, ...args], {
    cwd: root,
    encoding: "utf-8",
    input: opts.input ?? "",
    env: { ...process.env, SET_COPILOT_DIR: join(root, ".set", "copilot", "sess") },
  });
  return { out: r.stdout ?? "", err: r.stderr ?? "", code: r.status ?? 1 };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "sc-ledger-"));
  mkdirSync(join(root, ".set", "copilot", "sess"), { recursive: true });
  ledger = ledgerPath({ projectRoot: root } as CopilotConfig);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("the ledger file itself", () => {
  it("treats a missing ledger as everything pending, not as an error", () => {
    expect(readLedger(ledger)).toEqual([]);
    expect(isDone([], "abc", "stitch")).toBe(false);
  });

  it("skips a malformed line instead of losing the whole record", () => {
    // One bad append must never cost the other 200 entries — the ledger is append-only and
    // there is no second copy of the history.
    mkdirSync(join(root, ".set", "copilot"), { recursive: true });
    appendEntry(ledger, makeEntry("aaa", "stitch", "done"));
    writeFileSync(ledger, readFileSync(ledger, "utf-8") + "{ ez nem json\n\n" + '{"nincs":"fingerprint"}\n');
    appendEntry(ledger, makeEntry("bbb", "review", "done"));

    const entries = readLedger(ledger);
    expect(entries.map((e) => e.fingerprint)).toEqual(["aaa", "bbb"]);
  });

  it("never rewrites: a second entry for the same file leaves both in the history", () => {
    appendEntry(ledger, makeEntry("aaa", "stitch", "done", { at: "2026-01-01T00:00:00.000Z" }));
    appendEntry(ledger, makeEntry("aaa", "stitch", "done", { at: "2026-02-01T00:00:00.000Z" }));
    expect(entriesFor(readLedger(ledger), "aaa")).toHaveLength(2);
  });
});

describe("identity is the content, not the path", () => {
  it("recognises a renamed or moved file", () => {
    const a = transcript(root, "transcript.jsonl");
    const fp = fingerprintFile(a);
    const moved = join(root, "elvitt-nev.jsonl");
    writeFileSync(moved, readFileSync(a));
    // The handover renames every file it archives and recordings get copied between repos,
    // so a path-keyed ledger would re-review the same meeting after every archive.
    expect(fingerprintFile(moved)).toBe(fp);
  });

  it("treats two identical copies as one transcript, and changed content as a new one", () => {
    const a = transcript(root, "a.jsonl");
    const b = join(root, "b.jsonl");
    writeFileSync(b, readFileSync(a));
    expect(fingerprintFile(b)).toBe(fingerprintFile(a));

    writeFileSync(b, readFileSync(a, "utf-8") + JSON.stringify({ ts: 9000, speaker: "mic", text: "Új mondat.", final: true }) + "\n");
    // Edited content is content that has not been reviewed — correct behaviour, not a miss.
    expect(fingerprintFile(b)).not.toBe(fingerprintFile(a));
  });
});

describe("a step's status", () => {
  it("does not let one step imply another: stitched is not reviewed", () => {
    appendEntry(ledger, makeEntry("aaa", "stitch", "done"));
    const entries = readLedger(ledger);
    expect(stepStatus(entries, "aaa", "stitch")).toBe("done");
    expect(stepStatus(entries, "aaa", "review")).toBe("pending");
  });

  it("counts a claim as CLAIMED — never as done, never as merely pending", () => {
    // The distinction is the point: "someone started this and did not finish" is
    // information, and both of the other readings throw it away.
    appendEntry(ledger, makeEntry("aaa", "review", "claimed"));
    const entries = readLedger(ledger);
    expect(stepStatus(entries, "aaa", "review")).toBe("claimed");
    expect(isDone(entries, "aaa", "review")).toBe(false);
    expect(danglingClaims(entries).map((e) => e.fingerprint)).toEqual(["aaa"]);
  });

  it("returns an abandoned transcript to pending, keeping both entries in the history", () => {
    appendEntry(ledger, makeEntry("aaa", "review", "claimed"));
    appendEntry(ledger, makeEntry("aaa", "review", "abandoned", { reason: "kifutott az időből" }));
    const entries = readLedger(ledger);
    expect(stepStatus(entries, "aaa", "review")).toBe("pending");
    expect(danglingClaims(entries)).toHaveLength(0);
    expect(entriesFor(entries, "aaa").map((e) => e.state)).toEqual(["claimed", "abandoned"]);
  });

  it("lets a later attempt complete a transcript whose earlier claim dangled", () => {
    appendEntry(ledger, makeEntry("aaa", "review", "claimed"));
    appendEntry(ledger, makeEntry("aaa", "review", "claimed"));
    appendEntry(ledger, makeEntry("aaa", "review", "done", { outcome: { findings: 2 } }));
    const entries = readLedger(ledger);
    expect(stepStatus(entries, "aaa", "review")).toBe("done");
    expect(danglingClaims(entries)).toHaveLength(0);
  });

  it("counts an older-version entry as done and reports the version it was done under", () => {
    // A stale entry must never trigger a redo: the algorithm changed twice in one session,
    // and under redo-when-stale each change would have invalidated every prior result.
    appendEntry(ledger, { fingerprint: "aaa", step: "stitch", state: "done", at: "2026-01-01T00:00:00.000Z", version: 0 });
    const entries = readLedger(ledger);
    expect(isDone(entries, "aaa", "stitch")).toBe(true);
    expect(doneEntry(entries, "aaa", "stitch")?.version).toBe(0);
    expect(STITCH_VERSION).toBeGreaterThan(0);
  });
});

describe("through the CLI", () => {
  it("stitches once, then does nothing on a second run", () => {
    const t = transcript(join(root, ".set", "copilot", "sess"), "transcript-2026-01-01T00-00-00-000Z.jsonl");
    const first = cli(["transcript", "--input", t]);
    expect(first.code).toBe(0);
    expect(readLedger(ledger).filter((e) => e.step === "stitch")).toHaveLength(1);

    const second = cli(["transcript", "--input", t]);
    expect(second.code).toBe(0);
    expect(second.err).toContain("already stitched");
    expect(readLedger(ledger).filter((e) => e.step === "stitch")).toHaveLength(1);
  });

  it("still processes a NEW file in a directory whose others are done", () => {
    const dir = join(root, ".set", "copilot", "sess");
    transcript(dir, "transcript-2026-01-01T00-00-00-000Z.jsonl", "első");
    cli(["transcript", "--input", dir]);
    transcript(dir, "transcript-2026-02-01T00-00-00-000Z.jsonl", "második");

    const run = cli(["transcript", "--input", dir]);
    expect(run.err).toContain("Stitched 1/1");
    expect(run.err).toContain("skipped 1");
    expect(readLedger(ledger).filter((e) => e.step === "stitch")).toHaveLength(2);
  });

  it("--force redoes the work and leaves BOTH entries", () => {
    const t = transcript(join(root, ".set", "copilot", "sess"), "transcript-2026-01-01T00-00-00-000Z.jsonl");
    cli(["transcript", "--input", t]);
    const forced = cli(["transcript", "--input", t, "--force"]);
    expect(forced.code).toBe(0);
    expect(readLedger(ledger).filter((e) => e.step === "stitch")).toHaveLength(2);
  });

  it("records nothing for a no-op stitch", () => {
    // A silence-only transcript produces no artifacts, so there is nothing to have done.
    const dir = join(root, ".set", "copilot", "sess");
    const t = join(dir, "transcript-2026-03-01T00-00-00-000Z.jsonl");
    writeFileSync(t, `${JSON.stringify({ type: "silence", duration_ms: 1000, ts: 0 })}\n`);
    const run = cli(["transcript", "--input", t]);
    expect(run.code).not.toBe(0);
    expect(readLedger(ledger)).toHaveLength(0);
  });

  it("records nothing when the stitch fails", () => {
    const dir = join(root, ".set", "copilot", "sess");
    const t = join(dir, "transcript-2026-04-01T00-00-00-000Z.jsonl");
    writeFileSync(t, "ez egyáltalán nem transzkript\n");
    cli(["transcript", "--input", t]);
    expect(readLedger(ledger)).toHaveLength(0);
  });

  it("recovery status mutates nothing — no ledger write, no artifacts", () => {
    const dir = join(root, ".set", "copilot", "sess");
    const t = transcript(dir, "transcript-2026-01-01T00-00-00-000Z.jsonl");
    cli(["transcript", "--input", t]);
    const before = readFileSync(ledger, "utf-8");
    const filesBefore = readdirSync(dir).sort();

    const status = cli(["recovery", "status", "--input", t]);
    expect(status.code).toBe(0);
    expect(readFileSync(ledger, "utf-8")).toBe(before);
    expect(readdirSync(dir).sort()).toEqual(filesBefore);
  });

  it("a pre-ledger stitch reads as `artifacts`, not as pending — the disk is the evidence", () => {
    // Found against a real project's archive: 4 of 33 transcripts had their `.md` and
    // `-stitched.jsonl` on disk from before the ledger existed, and the status reported all
    // 33 as untouched. Reporting work that plainly happened as not-happened is the one thing
    // this whole command exists to prevent.
    const dir = join(root, ".set", "copilot", "sess");
    const t = transcript(dir, "transcript-2026-01-01T00-00-00-000Z.jsonl");
    cli(["transcript", "--input", t]);
    rmSync(ledger); // exactly the state of every recording made before the ledger shipped

    const json = JSON.parse(cli(["recovery", "status", "--input", t, "--json"]).out) as {
      transcripts: { stitch: string; review: string }[];
      pending: { stitch: string[]; review: string[] };
      artifactsOnly: string[];
    };
    expect(json.transcripts[0].stitch).toBe("artifacts");
    expect(json.pending.stitch).toHaveLength(0);
    expect(json.artifactsOnly).toEqual([t]);
    // Stitched says nothing about reviewed: the expensive pass is still outstanding.
    expect(json.pending.review).toEqual([t]);
  });

  it("only BOTH artifacts count — a lone .md is an interrupted run, not a finished one", () => {
    const dir = join(root, ".set", "copilot", "sess");
    const t = transcript(dir, "transcript-2026-01-01T00-00-00-000Z.jsonl");
    cli(["transcript", "--input", t]);
    rmSync(ledger);
    rmSync(t.replace(/\.jsonl$/, "-stitched.jsonl"));

    const json = JSON.parse(cli(["recovery", "status", "--input", t, "--json"]).out) as {
      pending: { stitch: string[] }; artifactsOnly: string[];
    };
    expect(json.artifactsOnly).toHaveLength(0);
    expect(json.pending.stitch).toEqual([t]);
  });

  it("prints a path outside the project absolutely, never as a ../.. escape", () => {
    // The global runtime dir (/tmp/set-copilot) rendered as
    // `../../../../../set-copilot/transcript.jsonl` — which reads like a project file.
    const outside = mkdtempSync(join(tmpdir(), "sc-outside-"));
    try {
      const t = transcript(outside, "transcript-2026-01-01T00-00-00-000Z.jsonl");
      const status = cli(["recovery", "status", "--input", t]);
      expect(status.out).toContain(t);
      expect(status.out).not.toContain("..");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("reports a claimed transcript as dangling in --json, not as pending", () => {
    const t = transcript(join(root, ".set", "copilot", "sess"), "transcript-2026-01-01T00-00-00-000Z.jsonl");
    cli(["transcript", "--input", t]);
    cli(["recovery", "claim", t, "--step", "review"]);

    const status = cli(["recovery", "status", "--input", t, "--json"]);
    const json = JSON.parse(status.out) as {
      pending: { review: string[] };
      dangling: { file: string; step: string }[];
      hookInstalled: boolean;
    };
    expect(json.dangling).toHaveLength(1);
    expect(json.dangling[0].step).toBe("review");
    expect(json.pending.review).toHaveLength(0);
    expect(typeof json.hookInstalled).toBe("boolean");
  });

  it("mark REQUIRES the findings payload — the record cannot be written without the result", () => {
    // Delivery and record are one act on purpose: recording a completion with no findings
    // would assert a review whose output went nowhere.
    const t = transcript(join(root, ".set", "copilot", "sess"), "transcript-2026-01-01T00-00-00-000Z.jsonl");
    cli(["transcript", "--input", t]);
    const bad = cli(["recovery", "mark", t, "--step", "review"]);
    expect(bad.code).not.toBe(0);
    expect(bad.err).toContain("findings");
    expect(readLedger(ledger).filter((e) => e.step === "review")).toHaveLength(0);

    const ok = cli(["recovery", "mark", t, "--step", "review"], { input: '[{"quote":"…","note":"…"}]' });
    expect(ok.code).toBe(0);
    const review = readLedger(ledger).filter((e) => e.step === "review");
    expect(review).toHaveLength(1);
    expect(review[0].outcome).toEqual({ findings: 1 });
  });

  it("rejects an unknown step and a missing file rather than writing a bad entry", () => {
    const t = transcript(join(root, ".set", "copilot", "sess"), "transcript-2026-01-01T00-00-00-000Z.jsonl");
    const badStep = cli(["recovery", "claim", t, "--step", "nincs-ilyen"]);
    expect(badStep.code).not.toBe(0);
    expect(badStep.err).toContain("unknown step");

    const missing = cli(["recovery", "claim", join(root, "nincs.jsonl"), "--step", "review"]);
    expect(missing.code).not.toBe(0);
    expect(readLedger(ledger)).toHaveLength(0);
  });

  it("abandon returns the transcript to pending", () => {
    const t = transcript(join(root, ".set", "copilot", "sess"), "transcript-2026-01-01T00-00-00-000Z.jsonl");
    cli(["transcript", "--input", t]);
    cli(["recovery", "claim", t, "--step", "review"]);
    cli(["recovery", "abandon", t, "--step", "review", "--reason", "megszakadt"]);

    const json = JSON.parse(cli(["recovery", "status", "--input", t, "--json"]).out) as {
      pending: { review: string[] }; dangling: unknown[];
    };
    expect(json.dangling).toHaveLength(0);
    expect(json.pending.review).toHaveLength(1);
  });
});
