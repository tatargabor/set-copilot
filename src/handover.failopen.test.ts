/**
 * The fail-open branch of the dictation print path (dictation-output), with the stitch
 * itself made to throw.
 *
 * Its own file because the mock has to replace `transcript-build` for the whole module
 * graph, and the rest of `handover.test.ts` deliberately exercises the real stitch.
 *
 * This is the posture the rest of the project inverts: `wall.redaction` withholds when in
 * doubt, because there a mistake *publishes*. Here a mistake would *swallow the user's
 * instruction* — they have already spoken and have no copy — so doubt prints.
 */

import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CopilotConfig } from "./config.js";

vi.mock("./transcript-build.js", () => ({
  stitchText: () => { throw new Error("szintetikus stitch-hiba"); },
}));

let dir: string;
let cfg: CopilotConfig;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sc-failopen-"));
  cfg = { runtimeDir: dir, dictationOutput: join(dir, "dictation.jsonl") } as CopilotConfig;
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe("printTranscriptOnce when the stitch throws", () => {
  it("prints the raw contents, still archives exactly once, and reports the failure", async () => {
    const { printTranscriptOnce } = await import("./handover.js");
    const raw = `${JSON.stringify({ ts: 0, speaker: "mic", text: "Ezt mondtam.", final: true })}\n`;
    writeFileSync(cfg.dictationOutput, raw);
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    const saved = printTranscriptOnce(cfg);

    // Nothing is lost: the words still reach the caller, just unassembled.
    expect(write.mock.calls.map((c) => String(c[0])).join("")).toBe(raw);
    // And the failure is visible — a persistent one must not read as normal output.
    expect(err).toHaveBeenCalled();
    expect(String(err.mock.calls[0][0])).toContain("szintetikus stitch-hiba");
    // The archival invariant is independent of the output format and holds regardless.
    expect(saved).toMatch(/dictation-.*\.jsonl$/);
    expect(readdirSync(dir)).not.toContain("dictation.jsonl");
    expect(readFileSync(saved!, "utf-8")).toBe(raw);
  });
});
