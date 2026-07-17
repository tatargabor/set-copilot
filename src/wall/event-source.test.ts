import { describe, expect, it, vi } from "vitest";

import { parseWireLine } from "./event-source.js";

describe("parseWireLine", () => {
  it("parses a category-tagged event line", () => {
    const m = parseWireLine('{"category":"transzkript","zone":"public","text":"hi"}');
    expect(m).toMatchObject({ category: "transzkript", zone: "public" });
  });

  it("parses a show command line", () => {
    expect(parseWireLine('{"kind":"show","cat":"architektúra","id":"v2"}')).toMatchObject({
      kind: "show", cat: "architektúra", id: "v2",
    });
  });

  it("drops a blank line silently", () => {
    const warn = vi.fn();
    expect(parseWireLine("   ", warn)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("drops an unparseable line with a warning", () => {
    const warn = vi.fn();
    expect(parseWireLine("{not json", warn)).toBeNull();
    expect(warn).toHaveBeenCalled();
  });
});
