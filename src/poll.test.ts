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
