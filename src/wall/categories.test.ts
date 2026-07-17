import { describe, expect, it, vi } from "vitest";

import { buildRegistry, validateCategory, resolveCategories } from "./categories.js";
import type { CopilotConfig } from "../config.js";

describe("validateCategory", () => {
  it("accepts a well-formed category and fills a default label", () => {
    expect(validateCategory({ id: "x", render: "text", icon: "•" }, () => {})).toEqual({
      id: "x", label: "x", icon: "•", render: "text",
    });
  });

  it("drops a category with no id", () => {
    const warn = vi.fn();
    expect(validateCategory({ render: "text" }, warn)).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it("accepts the chart render type", () => {
    expect(validateCategory({ id: "metrika", render: "chart", icon: "📊" }, () => {})?.render).toBe("chart");
  });

  it("drops a category with a render type outside text/graph/chart", () => {
    const warn = vi.fn();
    expect(validateCategory({ id: "x", render: "video" }, warn)).toBeNull();
    expect(warn).toHaveBeenCalled();
  });
});

describe("buildRegistry", () => {
  it("resolves valid categories and drops invalid ones, keeping the rest", () => {
    const reg = buildRegistry(
      [
        { id: "transzkript", label: "T", icon: "📝", render: "text" },
        { id: "bad", render: "nope" },
        { id: "architektúra", label: "A", icon: "🕸", render: "graph" },
      ],
      () => {},
    );
    expect(reg.list().map((c) => c.id)).toEqual(["transzkript", "architektúra"]);
    expect(reg.has("transzkript")).toBe(true);
    expect(reg.get("architektúra")?.render).toBe("graph");
    expect(reg.has("bad")).toBe(false);
  });

  it("keeps the first of a duplicate id", () => {
    const reg = buildRegistry(
      [{ id: "x", render: "text", label: "first" }, { id: "x", render: "graph", label: "second" }],
      () => {},
    );
    expect(reg.get("x")?.label).toBe("first");
  });
});

describe("resolveCategories", () => {
  it("resolves from config with no module", async () => {
    const cfg = {
      projectRoot: "/tmp",
      wall: { categories: [{ id: "s", label: "S", icon: "•", render: "text" }], windows: [], port: 1 },
    } as unknown as CopilotConfig;
    const reg = await resolveCategories(cfg);
    expect(reg.list().map((c) => c.id)).toEqual(["s"]);
  });
});
