import { describe, expect, it } from "vitest";

// The client's pure logic lives in a browser-loadable ES module; import it here
// directly so the same code the browser runs is what the test exercises.
import {
  applyViewportOverride, boxesForCategory, connectionState, gridTemplate, MIN_TRACK_SHARE,
  renderForEvent, stripState, zoneMatches,
} from "./public/wall-core.mjs";

const stacked = { id: "stacked", areas: [["pinned"], ["stream"], ["canvas"]] };
const boxes = [
  { position: "pinned", behavior: "latest", cats: ["riasztás", "súgás"] },
  { position: "stream", behavior: "scroll", cats: ["transzkript"] },
  { position: "canvas", behavior: "latest", cats: ["architektúra"], pacing: { minDwellMs: 8000 } },
];

describe("gridTemplate", () => {
  it("maps a stacked layout to a single-column grid, one row per position", () => {
    const t = gridTemplate(stacked, boxes);
    expect(t.gridTemplateAreas).toBe(`"pinned" "stream" "canvas"`);
    expect(t.gridTemplateColumns).toBe("1fr");
  });

  it("sizes a pinned latest box to auto, scroll to 1fr, and the paced canvas to the 2fr hero", () => {
    // This is the pre-layout behavior, preserved: the stacked arrangement must
    // render byte-identically to what the wall did before layouts existed (D9).
    const t = gridTemplate(stacked, boxes);
    expect(t.gridTemplateRows).toBe("auto 1fr 2fr");
  });

  it("lays a horizontal layout side by side with its declared proportions", () => {
    const layout = { id: "third-two-thirds", areas: [["szöveg", "prezentáció"]], columns: ["1fr", "2fr"] };
    const t = gridTemplate(layout, [
      { position: "szöveg", behavior: "scroll", cats: ["súgás"] },
      { position: "prezentáció", behavior: "latest", cats: ["architektúra"], pacing: { minDwellMs: 8000 } },
    ]);
    expect(t.gridTemplateAreas).toBe(`"szöveg prezentáció"`);
    expect(t.gridTemplateColumns).toBe("1fr 2fr");
    expect(t.gridTemplateRows).toBe("1fr"); // from the scroll box in the row's first cell
  });

  it("spans a repeated position across rows with no engine change (three-region layout)", () => {
    // The stream column occupies the same cell in both rows. `grid-template-areas` is
    // emitted row by row, so the repeated name spans naturally — this asserts the layered
    // model really did make the operator's geometry reachable as config alone.
    const layout = {
      id: "három-régió",
      areas: [["szöveg", "prezentáció"], ["szöveg", "kitűzött"]],
      columns: ["1fr", "1fr"],
      rows: ["2fr", "1fr"],
    };
    const t = gridTemplate(layout, [
      { position: "szöveg", behavior: "scroll", cats: ["narráció"] },
      { position: "prezentáció", behavior: "latest", cats: ["architektúra"], pacing: { minDwellMs: 8000 } },
      { position: "kitűzött", behavior: "latest", cats: ["kitűzött"] },
    ]);
    expect(t.gridTemplateAreas).toBe(`"szöveg prezentáció" "szöveg kitűzött"`);
    expect(t.gridTemplateColumns).toBe("1fr 1fr");
    // Explicit tracks win: the canvas is the hero, the pinned box takes what is left. The
    // pinned box carries no pacing, so nothing here derives 2fr from its behavior.
    expect(t.gridTemplateRows).toBe("2fr 1fr");
  });

  it("honors explicit row sizes over the behavior-derived default", () => {
    const layout = { id: "x", areas: [["a"], ["b"]], rows: ["30%", "70%"] };
    const t = gridTemplate(layout, [{ position: "a", behavior: "scroll", cats: [] }]);
    expect(t.gridTemplateRows).toBe("30% 70%");
  });

  it("defaults every column to 1fr when the layout declares none", () => {
    const t = gridTemplate({ id: "x", areas: [["a", "b", "c"]] }, []);
    expect(t.gridTemplateColumns).toBe("1fr 1fr 1fr");
  });

  it("derives the chat-wide layout: two equal columns, one row (wall-chat-mirror)", () => {
    const chatWide = {
      id: "chat-wide",
      areas: [["szöveg", "prezentáció"]],
      columns: ["1fr", "1fr"],
    };
    const t = gridTemplate(chatWide, [{ position: "szöveg", behavior: "scroll", cats: [] }]);
    expect(t.gridTemplateAreas).toBe(`"szöveg prezentáció"`);
    expect(t.gridTemplateColumns).toBe("1fr 1fr");
    expect(t.gridTemplateRows).toBe("1fr"); // from the scroll box in the row
  });
});

describe("applyViewportOverride (wall-viewport-and-activity)", () => {
  const layout = {
    id: "három-régió",
    areas: [["szöveg", "prezentáció"], ["szöveg", "kitűzött"]],
    columns: ["1fr", "1fr"],
    rows: ["2fr", "1fr"],
  };
  const template = () => gridTemplate(layout, []);
  const tracks = (s: string) => s.trim().split(/\s+/).map((t) => parseFloat(t));

  it("applies the viewer's proportions to both axes", () => {
    const t = applyViewportOverride(template(), { layoutId: "három-régió", columns: [1.4, 0.6], rows: [2.5, 0.5] }, "három-régió");
    // Shares, not the raw numbers: `fr` is relative, so 1.4/0.6 and 0.7/0.3 are the same
    // geometry. Asserting the ratio is asserting what the viewer actually sees.
    const [c1, c2] = tracks(t.gridTemplateColumns);
    expect(c1 / (c1 + c2)).toBeCloseTo(1.4 / 2, 3);
    const [r1, r2] = tracks(t.gridTemplateRows);
    expect(r1 / (r1 + r2)).toBeCloseTo(2.5 / 3, 3);
    // The arrangement itself is untouched — an override is track sizes, nothing else.
    expect(t.gridTemplateAreas).toBe(template().gridTemplateAreas);
  });

  it("leaves an axis the override does not mention at its declared proportions", () => {
    const t = applyViewportOverride(template(), { layoutId: "három-régió", columns: [1.4, 0.6] }, "három-régió");
    expect(t.gridTemplateRows).toBe("2fr 1fr");
  });

  it("rejects an override made against a DIFFERENT layout (D2)", () => {
    // A runtime layout switch changes what the tracks mean; a translated override would be
    // a geometry nobody chose.
    const t = applyViewportOverride(template(), { layoutId: "stacked", columns: [1.4, 0.6] }, "három-régió");
    expect(t).toEqual(template());
  });

  it("rejects an override whose track count no longer matches the layout", () => {
    const t = applyViewportOverride(template(), { layoutId: "három-régió", columns: [1, 1, 1] }, "három-régió");
    expect(t.gridTemplateColumns).toBe("1fr 1fr");
  });

  it("rejects a malformed track list rather than emitting broken CSS", () => {
    for (const columns of [[1, NaN], [1, -2], [1, "2fr"], []]) {
      const t = applyViewportOverride(template(), { layoutId: "három-régió", columns }, "három-régió");
      expect(t.gridTemplateColumns).toBe("1fr 1fr");
    }
  });

  it("clamps a region dragged toward zero so it can never collapse", () => {
    const t = applyViewportOverride(template(), { layoutId: "három-régió", columns: [1, 0] }, "három-régió");
    const [c1, c2] = tracks(t.gridTemplateColumns);
    // A collapsed region takes its content AND its own drag handle with it — there would be
    // nothing left to grab to bring it back.
    expect(c2 / (c1 + c2)).toBeGreaterThanOrEqual(MIN_TRACK_SHARE - 1e-6);
    expect(c1).toBeGreaterThan(c2);
  });

  it("clamps at the other end too — the far region survives the opposite drag", () => {
    const t = applyViewportOverride(template(), { layoutId: "három-régió", columns: [0, 1] }, "három-régió");
    const [c1, c2] = tracks(t.gridTemplateColumns);
    expect(c1 / (c1 + c2)).toBeGreaterThanOrEqual(MIN_TRACK_SHARE - 1e-6);
    expect(c2).toBeGreaterThan(c1);
  });

  it("keeps every track above the floor even when several are starved at once", () => {
    const wide = { id: "w", areas: [["a", "b", "c"]], columns: ["1fr", "1fr", "1fr"] };
    const t = applyViewportOverride(gridTemplate(wide, []), { layoutId: "w", columns: [0, 0, 5] }, "w");
    const ts = tracks(t.gridTemplateColumns);
    const sum = ts.reduce((a, b) => a + b, 0);
    for (const v of ts) expect(v / sum).toBeGreaterThanOrEqual(MIN_TRACK_SHARE - 1e-6);
  });

  it("cannot reach a box — it takes a template, not a window (structural, D3)", () => {
    // The guarantee "an override affects geometry only" is enforced by the signature, not
    // by discipline. If someone later passes a window in here to make a box-aware decision,
    // this test is where the intent is written down.
    expect(applyViewportOverride.length).toBe(3);
    const boxes = [{ position: "szöveg", behavior: "scroll", cats: ["narráció"], pacing: { minDwellMs: 1 } }];
    const before = JSON.stringify(boxes);
    applyViewportOverride(gridTemplate(layout, boxes), { layoutId: "három-régió", columns: [3, 1] }, "három-régió");
    expect(JSON.stringify(boxes)).toBe(before);
  });

  it("passes the template through untouched when there is no override", () => {
    for (const o of [null, undefined, {}, "nope"]) {
      expect(applyViewportOverride(template(), o, "három-régió")).toEqual(template());
    }
  });

  it("does not mutate the template it was given", () => {
    const t = template();
    applyViewportOverride(t, { layoutId: "három-régió", columns: [3, 1] }, "három-régió");
    expect(t.gridTemplateColumns).toBe("1fr 1fr");
  });
});

describe("boxesForCategory", () => {
  it("returns only the boxes subscribed to the category", () => {
    expect(boxesForCategory(boxes, "transzkript").map((b) => b.position)).toEqual(["stream"]);
    expect(boxesForCategory(boxes, "riasztás").map((b) => b.position)).toEqual(["pinned"]);
    expect(boxesForCategory(boxes, "architektúra").map((b) => b.position)).toEqual(["canvas"]);
  });

  it("returns nothing for an unsubscribed category", () => {
    expect(boxesForCategory(boxes, "nincs-ilyen")).toEqual([]);
  });
});

describe("renderForEvent", () => {
  it("picks the renderer from the payload, not the category", () => {
    expect(renderForEvent({ category: "architektúra", chart: { type: "bar", data: [] } })).toBe("chart");
    expect(renderForEvent({ category: "súgás", text: "hi" })).toBe("text");
    expect(renderForEvent({ category: "x", image: { src: "a.png" } })).toBe("image");
    expect(renderForEvent({ category: "x", webpage: { url: "https://example.com" } })).toBe("webpage");
  });

  it("returns null when there is no payload to render", () => {
    expect(renderForEvent({ category: "súgás" })).toBeNull();
  });
});

describe("zoneMatches (client mirror)", () => {
  it("agrees with the server zone rule", () => {
    expect(zoneMatches("both", ["private", "both"])).toBe(true);
    expect(zoneMatches("private", ["public", "both"])).toBe(false);
  });
});

describe("connectionState (wall-stream-recovery)", () => {
  const OPEN = 1, CLOSED = 2;
  const healthy = {
    lastHeartbeatAgeMs: 200, readyState: OPEN, heartbeatIntervalMs: 1000,
    captureAlive: true, lastHeardMsAgo: 500,
  };

  it("reports listening while heartbeats arrive and speech is fresh", () => {
    expect(connectionState(healthy).state).toBe("listening");
  });

  it("reports quiet while heartbeats arrive but nothing has been heard lately", () => {
    expect(connectionState({ ...healthy, lastHeardMsAgo: 30_000 }).state).toBe("quiet");
    expect(connectionState({ ...healthy, lastHeardMsAgo: null }).state).toBe("quiet");
  });

  it("tolerates a gap just under the threshold — a hiccup is not a dead pipe", () => {
    expect(connectionState({ ...healthy, lastHeartbeatAgeMs: 3_900 }).state).toBe("listening");
  });

  it("calls a gap past the threshold disconnected, even with the stream still OPEN", () => {
    // The observed field symptom: the stream stops delivering while the object still looks
    // open. Silence is the evidence; readyState cannot be trusted to notice.
    expect(connectionState({ ...healthy, lastHeartbeatAgeMs: 4_100 }).state).toBe("disconnected");
  });

  it("calls a CLOSED stream disconnected regardless of the last heartbeat", () => {
    expect(connectionState({ ...healthy, readyState: CLOSED }).state).toBe("disconnected");
  });

  it("treats never having received a heartbeat as disconnected", () => {
    expect(connectionState({ ...healthy, lastHeartbeatAgeMs: null }).state).toBe("disconnected");
  });

  it("recovers as soon as heartbeats resume", () => {
    const dead = connectionState({ ...healthy, lastHeartbeatAgeMs: 10_000 });
    expect(dead.state).toBe("disconnected");
    expect(connectionState(healthy).state).toBe("listening");
  });

  it("does not let a healthy connection mask capture-stopped", () => {
    // Trading one silent failure for another is not an improvement.
    expect(connectionState({ ...healthy, captureAlive: false }).state).toBe("dead");
  });

  it("derives the threshold from the server's advertised interval, not a second constant", () => {
    const slow = { ...healthy, heartbeatIntervalMs: 5000, lastHeartbeatAgeMs: 15_000 };
    expect(connectionState(slow).state).toBe("listening"); // 15s is fine at a 5s interval
    expect(connectionState({ ...slow, lastHeartbeatAgeMs: 21_000 }).state).toBe("disconnected");
  });

  it("distinguishes all four states from one another", () => {
    const states = new Set([
      connectionState(healthy).state,
      connectionState({ ...healthy, lastHeardMsAgo: 60_000 }).state,
      connectionState({ ...healthy, captureAlive: false }).state,
      connectionState({ ...healthy, readyState: CLOSED }).state,
    ]);
    expect(states).toEqual(new Set(["listening", "quiet", "dead", "disconnected"]));
  });
});

describe("stripState (wall-viewport-and-activity D6)", () => {
  const hb = (mic: unknown, system: unknown, captureAlive = true) => ({ kind: "heartbeat", captureAlive, channels: { mic, system } });
  const heard = (ms: number | null) => ({ present: true, lastHeardMsAgo: ms });

  it("shows the mic active while the system channel is quiet — the difference the strip exists for", () => {
    const s = stripState(hb(heard(300), heard(60_000)));
    expect(s.mic.state).toBe("active");
    expect(s.system.state).toBe("quiet");
  });

  it("shows both active when both are being heard", () => {
    const s = stripState(hb(heard(100), heard(200)));
    expect([s.mic.state, s.system.state]).toEqual(["active", "active"]);
  });

  it("reports an unused channel as ABSENT, never as quiet", () => {
    // A dictation capture has no system channel. "Quiet" would read as a captured channel
    // that has gone silent — i.e. a normal dictation looking like a broken meeting capture.
    const s = stripState(hb(heard(100), { present: false, lastHeardMsAgo: null }));
    expect(s.system.state).toBe("absent");
    expect(s.mic.state).toBe("active");
  });

  it("reports a present channel that has said nothing yet as quiet, not absent", () => {
    expect(stripState(hb(heard(100), heard(null))).system.state).toBe("quiet");
  });

  it("reports every channel stopped when the capture is gone", () => {
    const s = stripState(hb(heard(100), heard(100), false));
    expect([s.mic.state, s.system.state]).toEqual(["stopped", "stopped"]);
  });

  it("still reports an absent channel as absent when the capture stopped", () => {
    // Absence is a fact about the capture's shape, not about its liveness — a dictation run
    // that has ended still had no system channel.
    const s = stripState(hb(heard(100), { present: false, lastHeardMsAgo: null }, false));
    expect(s.system.state).toBe("absent");
    expect(s.mic.state).toBe("stopped");
  });

  it("reports unknown on a disconnected stream rather than a remembered verdict", () => {
    // Every age in a stale heartbeat is at least as old as the heartbeat itself. Painting a
    // confident "active" from it is exactly what wall-stream-recovery exists to prevent.
    const s = stripState(hb(heard(100), heard(100)), { connection: "disconnected" });
    expect([s.mic.state, s.system.state]).toEqual(["unknown", "unknown"]);
  });

  it("reports unknown when the server sends no per-channel data (older server)", () => {
    const s = stripState({ kind: "heartbeat", captureAlive: true, lastHeardMsAgo: 100 });
    expect([s.mic.state, s.system.state]).toEqual(["unknown", "unknown"]);
    expect(stripState(null).mic.state).toBe("unknown");
  });

  it("honours a caller-supplied quiet threshold instead of a second hardcoded copy", () => {
    expect(stripState(hb(heard(5000), heard(5000)), { quietThresholdMs: 10_000 }).mic.state).toBe("active");
    expect(stripState(hb(heard(5000), heard(5000)), { quietThresholdMs: 1000 }).mic.state).toBe("quiet");
  });

  it("carries the age through so the renderer can humanise it without re-deriving anything", () => {
    expect(stripState(hb(heard(12_345), heard(null))).mic.msAgo).toBe(12_345);
    expect(stripState(hb(heard(12_345), heard(null))).system.msAgo).toBeNull();
  });
});
