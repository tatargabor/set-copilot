import { describe, expect, it } from "vitest";

// The client's pure logic lives in a browser-loadable ES module; import it here
// directly so the same code the browser runs is what the test exercises.
import { gridTemplate, slotsForCategory, zoneMatches } from "./public/wall-core.mjs";

const slots = [
  { area: "pinned", behavior: "latest", cats: ["riasztás", "súgás"] },
  { area: "stream", behavior: "scroll", cats: ["transzkript"] },
  { area: "canvas", behavior: "latest", cats: ["architektúra"], pacing: { minDwellMs: 8000 } },
];

describe("gridTemplate", () => {
  it("maps slot areas to a single-column grid template, one row per slot", () => {
    const t = gridTemplate(slots);
    expect(t.gridTemplateAreas).toBe(`"pinned" "stream" "canvas"`);
    expect(t.gridTemplateColumns).toBe("1fr");
  });

  it("sizes a pinned latest slot to auto, scroll to 1fr, and the paced canvas to the 2fr hero", () => {
    const t = gridTemplate(slots);
    // pinned(latest,no-pacing)=auto, stream(scroll)=1fr, canvas(latest+pacing)=2fr
    expect(t.gridTemplateRows).toBe("auto 1fr 2fr");
  });
});

describe("slotsForCategory", () => {
  it("returns only the slots subscribed to the category", () => {
    expect(slotsForCategory(slots, "transzkript").map((s) => s.area)).toEqual(["stream"]);
    expect(slotsForCategory(slots, "riasztás").map((s) => s.area)).toEqual(["pinned"]);
    expect(slotsForCategory(slots, "architektúra").map((s) => s.area)).toEqual(["canvas"]);
  });

  it("returns nothing for an unsubscribed category", () => {
    expect(slotsForCategory(slots, "nincs-ilyen")).toEqual([]);
  });
});

describe("zoneMatches (client mirror)", () => {
  it("agrees with the server zone rule", () => {
    expect(zoneMatches("both", ["private", "both"])).toBe(true);
    expect(zoneMatches("private", ["public", "both"])).toBe(false);
  });
});
