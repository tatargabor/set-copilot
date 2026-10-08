/**
 * The poll's per-tick decision.
 *
 * The case that matters most is the last one in this file: a dead capture with unread
 * lines. Before 2026-08-23 the poll reported death *before* reading the transcript, so
 * everything written between a consumer's previous poll and the capture's exit was
 * discarded — the closing minutes of a meeting, where decisions get made. It was
 * invisible because a capture that ended quietly and one that ended with unheard words
 * produced identical output.
 */

import { describe, expect, it } from "vitest";

import { pollDecision } from "./poll.js";

const speech = (text: string, extra = ""): string =>
  `{"ts":1,"speaker":"mic","text":"${text}","final":true${extra}}`;

const PLAIN = speech("Csak beszélgetünk.");
const QUESTION = speech("Ez melyik évre vonatkozik?", ',"question":true');
const COMMAND = speech("Copilot, rajzold fel.", ',"command":true');
const URGENT = speech("Elromlott a build.", ',"urgency":"high"');
const SILENCE = '{"type":"silence","ts":1,"duration_ms":3000}';

describe("pollDecision — live capture", () => {
  it("waits when nothing new has arrived", () => {
    expect(pollDecision(true, [PLAIN], 1)).toEqual({ kind: "wait" });
  });

  it("waits on ordinary new speech — an ambient batch is not urgent", () => {
    expect(pollDecision(true, [PLAIN], 0)).toEqual({ kind: "wait" });
  });

  it("returns early on a question", () => {
    expect(pollDecision(true, [QUESTION], 0)).toEqual({ kind: "ready", reason: "early" });
  });

  it("returns early on a direct address — an instruction must not sit behind an ambient gate", () => {
    expect(pollDecision(true, [COMMAND], 0)).toEqual({ kind: "ready", reason: "early" });
  });

  it("returns early on an urgent line", () => {
    expect(pollDecision(true, [URGENT], 0)).toEqual({ kind: "ready", reason: "early" });
  });

  it("returns early on a silence that closes speech, but not on silence alone", () => {
    expect(pollDecision(true, [PLAIN, SILENCE], 0)).toEqual({ kind: "ready", reason: "early" });
    expect(pollDecision(true, [SILENCE], 0)).toEqual({ kind: "wait" });
  });
});

describe("pollDecision — accumulated speech (poll-bounded-speech-dwell)", () => {
  // Measured: from a spoken line to the next silence event is 30.7s on average during a
  // presentation, and that wait was almost the whole of the copilot's ~34s reaction
  // latency. The model reacts promptly once it sees a line; the gate was the slow part.

  // Distinct lines on purpose: identical ones are deduped as mic/system echo before the
  // count ever sees them, which is the existing filter doing its job.
  const A = speech("Az első mondat.");
  const B = speech("A második mondat.");
  const C = speech("A harmadik mondat.");

  it("returns once enough new speech has accumulated", () => {
    expect(pollDecision(true, [A, B, C], 0, 3)).toEqual({ kind: "ready", reason: "dwell" });
  });

  it("keeps waiting below the threshold", () => {
    expect(pollDecision(true, [A, B], 0, 3)).toEqual({ kind: "wait" });
  });

  it("counts what survives the echo filter, not raw lines", () => {
    // Three lines on the wire, one line of content: an echoed sentence must not push the
    // poll over its threshold.
    expect(pollDecision(true, [A, A, A], 0, 3)).toEqual({ kind: "wait" });
  });

  it("does not count non-speech events — a run of events is not something to react to", () => {
    expect(pollDecision(true, [SILENCE, SILENCE, SILENCE], 0, 3)).toEqual({ kind: "wait" });
  });

  it("counts only what is unread, not the whole file", () => {
    expect(pollDecision(true, [A, B, C, speech("Negyedik.")], 3, 3)).toEqual({ kind: "wait" });
  });

  it("is off at zero — the previous gating, exactly", () => {
    expect(pollDecision(true, [A, B, C, speech("Negyedik."), speech("Ötödik.")], 0, 0)).toEqual({ kind: "wait" });
  });

  it("lets an existing trigger win, so a question never waits for the count", () => {
    expect(pollDecision(true, [QUESTION], 0, 5)).toEqual({ kind: "ready", reason: "early" });
  });

  it("does not fire on a dead capture path — the drain decides there", () => {
    expect(pollDecision(false, [A, B, C], 0, 3)).toEqual({ kind: "ready", reason: "capture-gone" });
  });
});

describe("pollDecision — the capture is gone", () => {
  it("hands over the unread lines instead of reporting death over them", () => {
    // The regression this whole change exists for.
    expect(pollDecision(false, [PLAIN, QUESTION], 0)).toEqual({ kind: "ready", reason: "capture-gone" });
  });

  it("reports death once there is nothing left unread", () => {
    expect(pollDecision(false, [PLAIN, QUESTION], 2)).toEqual({ kind: "dead" });
  });

  it("reports death immediately when the capture ended with an empty transcript", () => {
    expect(pollDecision(false, [], 0)).toEqual({ kind: "dead" });
  });

  it("drains ordinary speech too — the last words of a meeting are rarely marked urgent", () => {
    expect(pollDecision(false, [PLAIN], 0)).toEqual({ kind: "ready", reason: "capture-gone" });
  });

  it("reports death when everything unread is filtered away as noise", () => {
    // A batch that filters to nothing is nothing to hand over: reporting `ready` would
    // return an empty batch and then loop back to the same state forever.
    expect(pollDecision(false, ["", "..."], 0)).toEqual({ kind: "dead" });
  });

  it("does not depend on death and content arriving in a particular order", () => {
    // Lines land, THEN the process exits: the common real sequence, and the one that used
    // to lose them.
    expect(pollDecision(true, [PLAIN], 1)).toEqual({ kind: "wait" });
    expect(pollDecision(false, [PLAIN], 1)).toEqual({ kind: "dead" });
    expect(pollDecision(false, [PLAIN, QUESTION], 1)).toEqual({ kind: "ready", reason: "capture-gone" });
  });
});

describe("the fast lane reaches the copilot at once", () => {
  const cmd = '{"type":"command","speaker":"mic","text":"rajzold meg az ábrát","urgency":"high"}';
  const abandoned = '{"type":"command-abandoned","speaker":"mic","partial":"mutasd","reason":"timeout"}';

  it("returns on a command event without waiting for the ambient gate", () => {
    // No silence, no question, fewer speech lines than the dwell — nothing else here
    // would have ended the poll.
    expect(pollDecision(true, [cmd], 0, 4)).toEqual({ kind: "ready", reason: "early" });
  });

  it("returns on an abandoned command too — the operator must know it did not take", () => {
    expect(pollDecision(true, [abandoned], 0, 4)).toEqual({ kind: "ready", reason: "early" });
  });

  it("never lets the echo dedup swallow a repeated command", () => {
    // The same instruction said twice is a second instruction, not an echo.
    expect(pollDecision(true, [cmd, cmd], 0, 0)).toEqual({ kind: "ready", reason: "early" });
  });
});

// ---- the wall-input seam (wall-input-to-session) ----

import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPoll, wallInputsFrom } from "./poll.js";
import type { CopilotConfig } from "./config.js";

const input = (text: string, extra = ""): string =>
  `${JSON.stringify({ ts: 1, route: "/wall", text })}${extra}`;

describe("wallInputsFrom — the pure extraction", () => {
  it("returns the texts and the offset past everything consumed", () => {
    const lines = [input("első"), input("második")];
    expect(wallInputsFrom(lines, 0)).toEqual({ texts: ["első", "második"], next: 2 });
  });

  it("skips blank and malformed lines without handing them over", () => {
    const lines = ["", "not json", input("harmadik"), '{"route":"/wall"}'];
    expect(wallInputsFrom(lines, 0)).toEqual({ texts: ["harmadik"], next: 4 });
  });

  it("yields nothing when the offset is at or beyond the end", () => {
    const lines = [input("egy")];
    expect(wallInputsFrom(lines, 1)).toEqual({ texts: [], next: 1 });
    expect(wallInputsFrom(lines, 5)).toEqual({ texts: [], next: 5 });
  });

  it("resumes mid-file from a stored offset", () => {
    const lines = [input("elso,"), input("masodik")];
    expect(wallInputsFrom(lines, 1)).toEqual({ texts: ["masodik"], next: 2 });
  });
});

describe("runPoll drains wall input — drain-before-dead, at command priority", () => {
  const writes: string[] = [];
  let orig: typeof process.stdout.write;

  const capture = (dir: string): CopilotConfig =>
    ({
      runtimeDir: dir,
      transcriptOutput: join(dir, "transcript.jsonl"),
      copilot: { pollDwell: 0 },
    }) as unknown as CopilotConfig;

  const withCapturedStdout = async (fn: () => Promise<void>): Promise<void> => {
    writes.length = 0; // a fresh buffer per capture — leftovers would fake ordering
    orig = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      await fn();
    } finally {
      process.stdout.write = orig;
    }
  };

  it("hands the input over FIRST, even with the capture gone and the transcript unread", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wall-poll-"));
    writeFileSync(join(dir, "wall-input.jsonl"), `${input("rajzold újra")}\n`);
    writeFileSync(join(dir, "transcript.jsonl"), `${speech("addig is beszélünk.")}\n`);

    await withCapturedStdout(() => runPoll(capture(dir), 0.3));
    expect(writes.join("")).toBe(`{"type":"wall-input","text":"rajzold újra"}\n`);

    // The transcript offset was NOT advanced by the input: the next poll gets the speech.
    writes.length = 0;
    await withCapturedStdout(() => runPoll(capture(dir), 0.3));
    expect(writes.join("")).toContain("addig is beszélünk.");
    expect(writes.join("")).not.toContain("wall-input");

    // And only when nothing is left does the dead verdict arrive.
    writes.length = 0;
    await withCapturedStdout(() => runPoll(capture(dir), 0.3));
    expect(writes.join("")).toBe('{"type":"capture-dead"}\n');
  });

  it("delivers a repeated input twice — operator input is never echo-deduped", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wall-poll-"));
    writeFileSync(join(dir, "wall-input.jsonl"), `${input("ugyanaz")}\n${input("ugyanaz")}\n`);

    await withCapturedStdout(() => runPoll(capture(dir), 0.3));
    const out = writes.join("");
    expect(out).toBe(`{"type":"wall-input","text":"ugyanaz"}\n{"type":"wall-input","text":"ugyanaz"}\n`);
    expect(existsSync(join(dir, "wall-input-offset"))).toBe(true);
    expect(readFileSync(join(dir, "wall-input-offset"), "utf-8").trim()).toBe("2");
  });
});
