import { describe, expect, it } from "vitest";

// The client's pure logic lives in a browser-loadable ES module; import it here
// directly so the same code the browser runs is what the test exercises.
import { boxesForCategory, gridTemplate, renderForEvent, zoneMatches } from "./public/wall-core.mjs";

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
