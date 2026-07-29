import { describe, expect, it } from "vitest";

import { channelActivity } from "./channels.js";

/** A transcript line as the writer emits it: `ts` is ms since capture start. */
const line = (ts: number, speaker: "mic" | "system", text = "…") =>
  JSON.stringify({ ts, speaker, text, final: true });

describe("channelActivity (wall-viewport-and-activity D5)", () => {
  it("reports both channels with their own ages when both are speaking", () => {
    const lines = [line(1000, "mic"), line(4000, "system"), line(9000, "mic")];
    // The file was written 500ms ago, and its newest line is the mic's at ts=9000.
    const a = channelActivity(lines, { fileAgeMs: 500, micOnly: false });
    expect(a.mic).toEqual({ present: true, lastHeardMsAgo: 500 });
    // The system channel's newest line is 5s behind the newest line overall.
    expect(a.system).toEqual({ present: true, lastHeardMsAgo: 5500 });
  });

  it("shows one channel active while the other has gone quiet — the whole point", () => {
    const lines = [line(0, "system"), line(60_000, "mic"), line(61_000, "mic")];
    const a = channelActivity(lines, { fileAgeMs: 200, micOnly: false });
    expect(a.mic.lastHeardMsAgo).toBe(200);
    expect(a.system.lastHeardMsAgo).toBe(61_200);
    expect(a.system.present).toBe(true); // quiet, not absent
  });

  it("marks the system channel ABSENT for a mic-only capture, not silent", () => {
    // A dictation capture never constructs the system client. Rendering it as a captured
    // channel that happens to be quiet would make a normal dictation look like a broken
    // meeting capture — which is the failure the spec names.
    const a = channelActivity([line(0, "mic"), line(3000, "mic")], { fileAgeMs: 100, micOnly: true });
    expect(a.system).toEqual({ present: false, lastHeardMsAgo: null });
    expect(a.mic).toEqual({ present: true, lastHeardMsAgo: 100 });
  });

  it("distinguishes a channel that is present but has said nothing yet", () => {
    const a = channelActivity([line(0, "mic")], { fileAgeMs: 100, micOnly: false });
    expect(a.system).toEqual({ present: true, lastHeardMsAgo: null });
  });

  it("reports nothing heard when the transcript is empty or unreadable", () => {
    for (const lines of [[], [""], ["not json"], ["{}"]]) {
      const a = channelActivity(lines, { fileAgeMs: 100, micOnly: false });
      expect(a.mic.lastHeardMsAgo).toBeNull();
      expect(a.system.lastHeardMsAgo).toBeNull();
    }
  });

  it("survives a truncated first line — the server reads a byte-offset tail", () => {
    const lines = ['peaker":"mic","text":"…"}', line(2000, "mic"), line(1000, "system")];
    const a = channelActivity(lines, { fileAgeMs: 0, micOnly: false });
    expect(a.mic.lastHeardMsAgo).toBe(0);
    expect(a.system.lastHeardMsAgo).toBe(1000);
  });

  it("ignores a silence event — it is not speech on a channel", () => {
    // A silence event carries a `ts` (the last speech before it) but no speaker. Letting it
    // set the newest-overall clock would push both channels' ages around for an event that
    // means the opposite of activity.
    const lines = [line(1000, "mic"), JSON.stringify({ type: "silence", duration_ms: 3000, ts: 4000 })];
    const a = channelActivity(lines, { fileAgeMs: 0, micOnly: false });
    expect(a.mic.lastHeardMsAgo).toBe(0);
  });

  it("reports nothing heard when there is no file to anchor the ages to", () => {
    const a = channelActivity([line(1000, "mic")], { fileAgeMs: null, micOnly: false });
    expect(a.mic.lastHeardMsAgo).toBeNull();
  });

  it("never returns a negative age", () => {
    const a = channelActivity([line(5000, "mic"), line(5000, "system")], { fileAgeMs: 0, micOnly: false });
    expect(a.mic.lastHeardMsAgo).toBe(0);
    expect(a.system.lastHeardMsAgo).toBe(0);
  });
});
