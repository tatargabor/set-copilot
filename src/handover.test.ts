import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handoverTranscriptOnce, lastTranscript, printTranscriptOnce } from "./handover.js";
import type { CopilotConfig } from "./config.js";

let dir: string;
let cfg: CopilotConfig;

// The handover functions only read runtimeDir + dictationOutput; the rest of the
// config is irrelevant to the "exactly once" logic under test.
function makeConfig(runtimeDir: string): CopilotConfig {
  return {
    runtimeDir,
    dictationOutput: join(runtimeDir, "dictation.jsonl"),
  } as CopilotConfig;
}

// Meeting mode: the capture drops a `capture.output` marker naming the file it
// wrote, so lastTranscript() follows it instead of the dictation default.
function markMeetingOutput(path: string): void {
  writeFileSync(join(dir, "capture.output"), path);
}

function archives(): string[] {
  return readdirSync(dir).filter((f) => /transcript-.*\.jsonl$/.test(f));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sc-handover-"));
  cfg = makeConfig(dir);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe("handoverTranscriptOnce (meeting path)", () => {
  it("archives once: renames to a timestamped file, reports the path, withholds contents", () => {
    const live = join(dir, "transcript.jsonl");
    markMeetingOutput(live);
    writeFileSync(live, '{"text":"hello"}\n');
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    const saved = handoverTranscriptOnce(cfg);

    // Path reported, no live transcript remains, contents NOT printed.
    expect(saved).toMatch(/transcript-.*\.jsonl$/);
    expect(readdirSync(dir)).not.toContain("transcript.jsonl");
    expect(archives()).toHaveLength(1);
    expect(write).not.toHaveBeenCalled();
    // Never truncates: the archived file stays readable with its original body.
    expect(readFileSync(saved!, "utf-8")).toBe('{"text":"hello"}\n');
  });

  it("a repeated handover does not re-archive (idempotent)", () => {
    const live = join(dir, "transcript.jsonl");
    markMeetingOutput(live);
    writeFileSync(live, '{"text":"hello"}\n');

    expect(handoverTranscriptOnce(cfg)).not.toBeNull();
    expect(handoverTranscriptOnce(cfg)).toBeNull(); // nothing left to hand over
    expect(archives()).toHaveLength(1); // still exactly one archive
  });

  it("is a no-op on an empty transcript", () => {
    const live = join(dir, "transcript.jsonl");
    markMeetingOutput(live);
    writeFileSync(live, "");

    expect(handoverTranscriptOnce(cfg)).toBeNull();
    expect(archives()).toHaveLength(0);
  });

  it("is a no-op when there is no transcript at all", () => {
    markMeetingOutput(join(dir, "transcript.jsonl"));
    expect(handoverTranscriptOnce(cfg)).toBeNull();
  });
});

describe("printTranscriptOnce (dictation path)", () => {
  it("emits the contents AND archives exactly once", () => {
    // No capture.output marker → dictation mode, lastTranscript uses dictationOutput.
    const live = cfg.dictationOutput;
    writeFileSync(live, '{"text":"typed by voice"}\n');
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    const saved = printTranscriptOnce(cfg);

    expect(lastTranscript(cfg)).toBe(live); // sanity: dictation mode resolved
    expect(write).toHaveBeenCalledWith('{"text":"typed by voice"}\n');
    expect(saved).toMatch(/dictation-.*\.jsonl$/);
    expect(readdirSync(dir)).not.toContain("dictation.jsonl");
  });

  it("a second dictation stop prints nothing and archives nothing", () => {
    writeFileSync(cfg.dictationOutput, '{"text":"once"}\n');
    printTranscriptOnce(cfg);

    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const saved = printTranscriptOnce(cfg);

    expect(saved).toBeNull();
    expect(write).not.toHaveBeenCalled();
  });
});
