import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TranscriptWriter, type TranscriptLine } from "./transcript-writer.js";
import type { TranscriptEvent } from "./soniox-rt.js";

let dir: string;
let out: string;
let writer: TranscriptWriter | null = null;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sc-tw-"));
  out = join(dir, "transcript.jsonl");
});

afterEach(() => {
  writer?.close();
  writer = null;
  vi.useRealTimers();
  rmSync(dir, { recursive: true, force: true });
});

/** Soniox v5 emits one token at a time, with the leading space baked in. */
const token = (text: string, speaker: "mic" | "system" = "mic", ts = 0): TranscriptEvent => ({
  speaker,
  text,
  isFinal: true,
  timestampMs: ts,
});

const lines = (): TranscriptLine[] =>
  existsSync(out)
    ? readFileSync(out, "utf-8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
    : [];

describe("TranscriptWriter", () => {
  it("flushes on a sentence boundary and concatenates tokens without adding spaces", () => {
    writer = new TranscriptWriter(out);
    writer.onTranscript(token("Add"));
    writer.onTranscript(token(" the"));
    writer.onTranscript(token(" invoice."));
    expect(lines().map((l) => l.text)).toEqual(["Add the invoice."]);
  });

  it("holds an unfinished sentence back", () => {
    writer = new TranscriptWriter(out);
    writer.onTranscript(token("no punctuation yet"));
    expect(lines()).toEqual([]);
    writer.close(); // close flushes what is buffered
    expect(lines().map((l) => l.text)).toEqual(["no punctuation yet"]);
  });

  it("ignores non-final tokens", () => {
    writer = new TranscriptWriter(out);
    writer.onTranscript({ ...token("partial."), isFinal: false });
    writer.close();
    expect(lines()).toEqual([]);
  });

  it("flushes the other speaker's buffer on a speaker change", () => {
    writer = new TranscriptWriter(out);
    writer.onTranscript(token("half a thought", "mic"));
    writer.onSpeakerChange("system");
    expect(lines().map((l) => [l.speaker, l.text])).toEqual([["mic", "half a thought"]]);
  });

  it("safety-flushes a buffer that never gets punctuation", () => {
    writer = new TranscriptWriter(out, { maxBufferWords: 3 });
    for (const w of [" a", " b", " c", " d", " e"]) writer.onTranscript(token(w));
    expect(lines().length).toBe(1);
  });

  it("emits exactly one silence event per silence period", () => {
    vi.useFakeTimers();
    writer = new TranscriptWriter(out, { silenceTimeoutMs: 50, checkIntervalMs: 10 });
    writer.onTranscript(token("Done."));
    vi.advanceTimersByTime(500);

    const silences = lines().filter((l) => (l as unknown as { type?: string }).type === "silence");
    expect(silences.length).toBe(1);

    writer.onTranscript(token("More."));
    vi.advanceTimersByTime(500);
    expect(lines().filter((l) => (l as unknown as { type?: string }).type === "silence").length).toBe(2);
  });

  it("flags urgency and questions with the default (en + hu) patterns", () => {
    writer = new TranscriptWriter(out);
    writer.onTranscript(token("The export is broken."));
    writer.onTranscript(token(" Why does it fail?"));
    writer.onTranscript(token(" Nem működik a számla."));
    const l = lines();
    expect(l[0]!.urgency).toBe("high");
    expect(l[1]!.question).toBe(true);
    expect(l[2]!.urgency).toBe("high");
  });

  it("leaves ordinary speech unflagged", () => {
    writer = new TranscriptWriter(out);
    writer.onTranscript(token("We shipped it on Tuesday."));
    const [line] = lines();
    expect(line!.urgency).toBeUndefined();
    expect(line!.question).toBeUndefined();
  });

  it("takes the detection patterns from config", () => {
    writer = new TranscriptWriter(out, {
      detect: { urgency: ["\\bawaria\\b"], question: ["\\?\\s*$"] },
    });
    writer.onTranscript(token("Mamy awarię... awaria w produkcji."));
    writer.onTranscript(token(" The export is broken."));
    const l = lines();
    expect(l[0]!.urgency).toBe("high"); // matched the Polish pattern
    expect(l[1]!.urgency).toBeUndefined(); // English default no longer applies
  });

  it("drops an invalid detect pattern instead of crashing the capture", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    writer = new TranscriptWriter(out, { detect: { urgency: ["("], question: [] } });
    writer.onTranscript(token("still writing."));
    expect(lines().map((l) => l.text)).toEqual(["still writing."]);
    expect(err).toHaveBeenCalledWith(expect.stringContaining("Ignoring invalid detect.urgency"));
    err.mockRestore();
  });

  it("annotates matched topics and omits the field when nothing matches", () => {
    writer = new TranscriptWriter(out, {
      topicMatcher: (t) => (t.includes("invoice") ? ["invoice"] : []),
    });
    writer.onTranscript(token("Send the invoice."));
    writer.onTranscript(token(" Unrelated chatter."));
    const l = lines();
    expect(l[0]!.topics).toEqual(["invoice"]);
    expect(l[1]!.topics).toBeUndefined();
  });
});
