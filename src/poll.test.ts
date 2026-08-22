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
