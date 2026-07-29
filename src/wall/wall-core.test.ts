import { describe, expect, it } from "vitest";

// The client's pure logic lives in a browser-loadable ES module; import it here
// directly so the same code the browser runs is what the test exercises.
import { boxesForCategory, connectionState, gridTemplate, renderForEvent, zoneMatches } from "./public/wall-core.mjs";

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
