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

/** A dictation line as the writer emits it. */
const dline = (ts: number, text: string, extra: Record<string, unknown> = {}) =>
  `${JSON.stringify({ ts, speaker: "mic", text, final: true, ...extra })}\n`;

/** What reached stdout across all writes, joined. */
function printed(write: ReturnType<typeof vi.spyOn>): string {
  return write.mock.calls.map((c) => String(c[0])).join("");
}

describe("printTranscriptOnce (dictation path)", () => {
  it("emits the reassembled text AND archives exactly once", () => {
    // No capture.output marker → dictation mode, lastTranscript uses dictationOutput.
    const live = cfg.dictationOutput;
    writeFileSync(live, dline(0, "Typed by voice."));
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    const saved = printTranscriptOnce(cfg);

    expect(lastTranscript(cfg)).toBe(live); // sanity: dictation mode resolved
    expect(printed(write)).toBe("Typed by voice.\n");
    expect(saved).toMatch(/dictation-.*\.jsonl$/);
    expect(readdirSync(dir)).not.toContain("dictation.jsonl");
    // No derived artifacts on this path: a dictation is a message, not a document.
    expect(readdirSync(dir).filter((f) => /\.md$|-stitched\.jsonl$/.test(f))).toHaveLength(0);
  });

  it("joins a continued line with a SPACE when the resumption was not mid-word", () => {
    writeFileSync(
      cfg.dictationOutput,
      dline(11580, "Az lenne a kérdésem, hogy a SetPromo-ból", { partial: true }) +
        dline(16140, "ide a meetingek át lettek szedve?", { cont: true, startTs: 12000 }),
    );
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    printTranscriptOnce(cfg);
    expect(printed(write)).toBe("Az lenne a kérdésem, hogy a SetPromo-ból ide a meetingek át lettek szedve?\n");
  });

  it("joins with NO separator when the capture recorded a mid-word cut (the real failure)", () => {
    // The regression fixture, synthetic but shaped like the observed dictation: concatenated
    // literally this reads "…a ide, ameetingek…" — the user's own question corrupted before
    // the model ever saw it, with no recording to go back to.
    writeFileSync(
      cfg.dictationOutput,
      dline(11580, "Az lenne a kérdésem, hogy a SetPromo-ból a ide, a meet", { partial: true }) +
        dline(16140, "ingek át lettek szedve?", { cont: true, midWord: true, startTs: 12000 }),
    );
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    printTranscriptOnce(cfg);

    const out = printed(write);
    expect(out).toContain("a meetingek át lettek szedve?");
    expect(out).not.toContain("ameetingek");
    expect(out).not.toContain("meet ingek");
  });

  it("emits no timestamps, no speaker labels and no JSON", () => {
    writeFileSync(
      cfg.dictationOutput,
      dline(1000, "Első mondat.") + dline(4000, "Második mondat."),
    );
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    printTranscriptOnce(cfg);

    const out = printed(write);
    expect(out).toBe("Első mondat. Második mondat.\n");
    expect(out).not.toMatch(/\d{2}:\d{2}:\d{2}/);
    expect(out).not.toContain("mic");
    expect(out).not.toContain("{");
    expect(out).not.toContain("**");
  });

  it("produces no text from silence events, and prints nothing at all for a silence-only transcript", () => {
    writeFileSync(
      cfg.dictationOutput,
      `${JSON.stringify({ type: "silence", duration_ms: 3000, ts: 1000 })}\n`,
    );
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const saved = printTranscriptOnce(cfg);

    expect(printed(write)).toBe("");
    // It still counts as a handover: the file existed and is consumed exactly once.
    expect(saved).toMatch(/dictation-.*\.jsonl$/);
  });

  it("drops a silence event from between two sentences without disturbing them", () => {
    writeFileSync(
      cfg.dictationOutput,
      dline(1000, "Előtte.") +
        `${JSON.stringify({ type: "silence", duration_ms: 3000, ts: 1000 })}\n` +
        dline(9000, "Utána."),
    );
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    printTranscriptOnce(cfg);
    expect(printed(write)).toBe("Előtte. Utána.\n");
  });

  it("is a no-op on an empty transcript: nothing printed, nothing archived, null returned", () => {
    writeFileSync(cfg.dictationOutput, "");
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    expect(printTranscriptOnce(cfg)).toBeNull();
    expect(write).not.toHaveBeenCalled();
    expect(readdirSync(dir).filter((f) => /dictation-.*\.jsonl$/.test(f))).toHaveLength(0);
  });

  it("a second dictation stop prints nothing and archives nothing", () => {
    writeFileSync(cfg.dictationOutput, dline(0, "Once."));
    printTranscriptOnce(cfg);

    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const saved = printTranscriptOnce(cfg);

    expect(saved).toBeNull();
    expect(write).not.toHaveBeenCalled();
  });

  it("falls back to the RAW contents when reassembly cannot read the transcript, and says so", () => {
    // Fail open, the deliberate opposite of the wall's posture: a badly joined word boundary
    // is recoverable by the reader; a swallowed instruction is not — the user has already
    // spoken and has no copy. Lines the parser cannot make sense of take this path.
    const raw = "nem is json\nse ez\n";
    writeFileSync(cfg.dictationOutput, raw);
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    const saved = printTranscriptOnce(cfg);

    expect(printed(write)).toBe(raw);
    expect(err).toHaveBeenCalled(); // the fallback is never silent
    expect(saved).toMatch(/dictation-.*\.jsonl$/); // and the archive still happened, once
    expect(readdirSync(dir)).not.toContain("dictation.jsonl");
  });
});
