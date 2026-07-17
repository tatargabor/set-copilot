import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { CopilotConfig } from "../config.js";
import { emitWallEvents, normalizeEvent } from "./emit.js";

describe("normalizeEvent", () => {
  it("accepts a text event and defaults zone to both", () => {
    const r = normalizeEvent({ category: "súgás", text: "figyelj" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.event).toEqual({ category: "súgás", zone: "both", text: "figyelj" });
  });

  it("preserves speaker, priority, visual, and an explicit zone", () => {
    const r = normalizeEvent({
      category: "riasztás", zone: "private", text: "ellentmondás",
      speaker: "system", priority: "immediate",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.event.zone).toBe("private");
      expect(r.event.speaker).toBe("system");
      expect(r.event.priority).toBe("immediate");
    }
  });

  it("carries graph and chart payloads through", () => {
    const g = normalizeEvent({ category: "architektúra", visual: "v1", graph: { op: "reset" } });
    expect(g.ok && g.event.graph).toEqual({ op: "reset" });
    const c = normalizeEvent({ category: "metrika", chart: { type: "bar", data: [{ label: "Q1", value: 4 }] } });
    expect(c.ok && c.event.chart?.type).toBe("bar");
  });

  it("rejects a missing/empty category", () => {
    expect(normalizeEvent({ text: "x" }).ok).toBe(false);
    expect(normalizeEvent({ category: "  ", text: "x" }).ok).toBe(false);
  });

  it("rejects a bad zone", () => {
    const r = normalizeEvent({ category: "súgás", zone: "secret", text: "x" });
    expect(r.ok).toBe(false);
  });

  it("rejects an event with no payload", () => {
    expect(normalizeEvent({ category: "súgás" }).ok).toBe(false);
  });

  it("rejects a server-only show command", () => {
    const r = normalizeEvent({ kind: "show", cat: "architektúra", id: "v1" });
    expect(r.ok).toBe(false);
  });

  it("rejects non-objects", () => {
    expect(normalizeEvent("nope").ok).toBe(false);
    expect(normalizeEvent(null).ok).toBe(false);
    expect(normalizeEvent([{ category: "x" }]).ok).toBe(false);
  });
});

describe("emitWallEvents", () => {
  const cfg = (dir: string) => ({ runtimeDir: dir } as CopilotConfig);

  it("appends valid events as JSONL and drops bad ones", () => {
    const dir = mkdtempSync(join(tmpdir(), "wall-emit-"));
    const res = emitWallEvents(cfg(dir), [
      { category: "súgás", text: "egy" },
      { category: "", text: "rossz" },
      { category: "metrika", chart: { type: "bar", data: [{ label: "a", value: 1 }] } },
    ]);
    expect(res.emitted).toBe(2);
    expect(res.dropped).toHaveLength(1);
    const lines = readFileSync(join(dir, "wall-events.jsonl"), "utf-8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).category).toBe("súgás");
    expect(JSON.parse(lines[1]).category).toBe("metrika");
  });

  it("accepts a single event object (not just an array)", () => {
    const dir = mkdtempSync(join(tmpdir(), "wall-emit-"));
    const res = emitWallEvents(cfg(dir), { category: "riasztás", text: "!", priority: "immediate" });
    expect(res.emitted).toBe(1);
    const line = readFileSync(join(dir, "wall-events.jsonl"), "utf-8").trim();
    expect(JSON.parse(line).priority).toBe("immediate");
  });
});
