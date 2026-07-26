import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TranscriptWriter, type TranscriptLine } from "./transcript-writer.js";
import { namePattern } from "./config.js";
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

  it("regression: the other channel speaking does NOT cut an unfinished sentence", () => {
    // The two channels are independent: real conversation overlaps, and a backchannel
    // ("mhm") used to flush the other speaker's buffer wherever the token stream stood
    // — severing a word in half. The interjection must leave the sentence intact.
    writer = new TranscriptWriter(out);
    writer.onTranscript(token("I cannot edit", "system"));
    writer.onTranscript(token(" Mhm.", "mic"));
    writer.onTranscript(token(" it anymore.", "system"));

    expect(lines().map((l) => [l.speaker, l.text])).toEqual([
      ["mic", "Mhm."],
      ["system", "I cannot edit it anymore."],
    ]);
  });

  it("regression: a backchannel does not split a word in half", () => {
    // The measured shape of the bug: "szerkeszten" + "i." written as two lines.
    writer = new TranscriptWriter(out);
    writer.onTranscript(token(" szerkeszten", "system"));
    writer.onTranscript(token(" Aha.", "mic"));
    writer.onTranscript(token("i.", "system"));

    const system = lines().filter((l) => l.speaker === "system");
    expect(system.map((l) => l.text)).toEqual(["szerkeszteni."]);
  });

  it("records the utterance start so overlapping speech can be ordered", () => {
    writer = new TranscriptWriter(out);
    writer.onTranscript(token("A long", "system", 1000));
    writer.onTranscript(token(" Mhm.", "mic", 3000));
    writer.onTranscript(token(" thought.", "system", 5000));

    const system = lines().find((l) => l.speaker === "system")!;
    // `ts` is where it ended, `startTs` where it began — the mic line sits between them
    expect([system.startTs, system.ts]).toEqual([1000, 5000]);
  });

  it("marks a severed line and how its continuation resumes", () => {
    vi.useFakeTimers();
    writer = new TranscriptWriter(out, { silenceTimeoutMs: 50, checkIntervalMs: 10 });

    writer.onTranscript(token("cut mid-wo"));
    vi.advanceTimersByTime(200); // own silence → partial flush
    writer.onTranscript(token("rd here."));

    const speech = lines().filter((l) => !("type" in l));
    expect(speech.map((l) => [l.text, l.partial, l.cont, l.midWord])).toEqual([
      ["cut mid-wo", true, undefined, undefined],
      ["rd here.", undefined, true, true], // midWord: no leading space → one word
    ]);
  });

  it("a continuation that starts a new word is not marked midWord", () => {
    vi.useFakeTimers();
    writer = new TranscriptWriter(out, { silenceTimeoutMs: 50, checkIntervalMs: 10 });

    writer.onTranscript(token("a whole word"));
    vi.advanceTimersByTime(200);
    writer.onTranscript(token(" follows."));

    const speech = lines().filter((l) => !("type" in l));
    expect(speech.map((l) => [l.text, l.cont, l.midWord])).toEqual([
      ["a whole word", undefined, undefined],
      ["follows.", true, undefined],
    ]);
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

describe("addressing the copilot by name", () => {
  const cmd = { urgency: [], question: [], command: [namePattern("copilot")] };

  it("flags a line where the mic speaker names the copilot", () => {
    writer = new TranscriptWriter(out, { detect: cmd });
    writer.onTranscript(token("Copilot, draw the pipeline."));
    expect(lines()[0]!.command).toBe(true);
  });

  it("matches an agglutinated form — Hungarian suffixes attach to the stem", () => {
    writer = new TranscriptWriter(out, { detect: cmd });
    writer.onTranscript(token("Megkérdeztem a copilotot."));
    writer.onTranscript(token(" Beszéltem a copilottal."));
    expect(lines().map((l) => l.command)).toEqual([true, true]);
  });

  it("does NOT match the name inside another word", () => {
    // The leading boundary is what stops this; a trailing one would break the
    // agglutinated forms above, so only the left side is anchored.
    writer = new TranscriptWriter(out, { detect: cmd });
    writer.onTranscript(token("The autocopilot handles it."));
    expect(lines()[0]!.command).toBeUndefined();
  });

  it("ignores the name on the system channel — that is someone else's meeting", () => {
    writer = new TranscriptWriter(out, { detect: cmd });
    writer.onTranscript(token("Copilot, show the chart.", "system"));
    expect(lines()[0]!.command).toBeUndefined();
  });

  it("leaves ordinary speech unflagged", () => {
    writer = new TranscriptWriter(out, { detect: cmd });
    writer.onTranscript(token("We shipped it on Tuesday."));
    expect(lines()[0]!.command).toBeUndefined();
  });

  it("supports a project's own nickname", () => {
    writer = new TranscriptWriter(out, {
      detect: { urgency: [], question: [], command: [namePattern("tesa")] },
    });
    writer.onTranscript(token("Tesa, rajzold ki."));
    writer.onTranscript(token(" Copilot, rajzold ki."));
    expect(lines().map((l) => l.command)).toEqual([true, undefined]);
  });
});
