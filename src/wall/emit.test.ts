import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

describe("payload shape validation", () => {
  it("rejects a graph that is not an object", () => {
    // Regression: these used to be cast unvalidated straight into the canonical log,
    // where a replay would serve them forever.
    expect(normalizeEvent({ category: "a", graph: 42 }).ok).toBe(false);
    expect(normalizeEvent({ category: "a", graph: [] }).ok).toBe(false);
  });

  it("requires graph.op, since it decides reset-vs-append on the client", () => {
    const res = normalizeEvent({ category: "a", graph: { nodes: [] } });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain("graph.op");
    expect(normalizeEvent({ category: "a", graph: { op: "nope" } }).ok).toBe(false);
    expect(normalizeEvent({ category: "a", graph: { op: "reset" } }).ok).toBe(true);
    expect(normalizeEvent({ category: "a", graph: { op: "add", nodes: [], edges: [] } }).ok).toBe(true);
  });

  it("rejects non-array nodes/edges", () => {
    expect(normalizeEvent({ category: "a", graph: { op: "add", nodes: "x" } }).ok).toBe(false);
    expect(normalizeEvent({ category: "a", graph: { op: "add", edges: {} } }).ok).toBe(false);
  });

  it("requires a bar chart with an array of data", () => {
    expect(normalizeEvent({ category: "m", chart: { type: "pie", data: [] } }).ok).toBe(false);
    expect(normalizeEvent({ category: "m", chart: { type: "bar" } }).ok).toBe(false);
    expect(normalizeEvent({ category: "m", chart: { type: "bar", data: [] } }).ok).toBe(true);
  });

  it("keeps free-form extras on nodes and edges", () => {
    const res = normalizeEvent({
      category: "a",
      graph: { op: "add", nodes: [{ id: "n", colour: "red" }] },
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect((res.event.graph?.nodes?.[0] as Record<string, unknown>).colour).toBe("red");
  });
});

describe("emitWallEvents write safety", () => {
  const cfg = (dir: string) => ({ runtimeDir: dir } as CopilotConfig);

  it("creates the runtime dir when it does not exist yet", () => {
    // Only `capture` creates the runtime dir; a producer may emit with no capture
    // running, and this used to throw an uncaught ENOENT.
    const dir = join(mkdtempSync(join(tmpdir(), "wall-emit-")), "nested", "runtime");
    const res = emitWallEvents(cfg(dir), { category: "súgás", text: "hello" });
    expect(res.emitted).toBe(1);
    expect(res.dropped).toHaveLength(0);
    expect(readFileSync(join(dir, "wall-events.jsonl"), "utf-8")).toContain("hello");
  });

  it("reports an unwritable target instead of throwing", () => {
    // A file where the runtime dir should be: mkdir fails, and the caller must
    // still get a result object back.
    const base = mkdtempSync(join(tmpdir(), "wall-emit-"));
    const asFile = join(base, "not-a-dir");
    writeFileSync(asFile, "");
    let res: ReturnType<typeof emitWallEvents> | undefined;
    expect(() => { res = emitWallEvents(cfg(asFile), { category: "a", text: "x" }); }).not.toThrow();
    expect(res?.emitted).toBe(0);
    expect(res?.dropped[0]?.reason).toContain("could not write");
  });
});

describe("normalizeEvent — payload selection (design D3)", () => {
  it("requires exactly one payload", () => {
    const none = normalizeEvent({ category: "súgás" });
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.reason).toContain("no payload");

    // Two payloads are genuinely ambiguous: the renderer dispatches on the
    // payload, so it would draw one and silently discard the other.
    const two = normalizeEvent({
      category: "x", graph: { op: "add" }, image: { src: "https://e.com/a.png" },
    });
    expect(two.ok).toBe(false);
    if (!two.ok) expect(two.reason).toContain("exactly one payload");
  });

  it("treats a null payload as absent, not as a payload", () => {
    const r = normalizeEvent({ category: "súgás", text: "hi", graph: null });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.event.graph).toBeUndefined();
  });

  it("accepts a payload whose type differs from the category default", () => {
    // `architektúra` defaults to graph; the payload wins.
    const r = normalizeEvent({ category: "architektúra", chart: { type: "bar", data: [] } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.event.chart).toBeDefined();
  });
});

describe("normalizeEvent — media payloads", () => {
  const root = "~/code/set-copilot";

  it("accepts an absolute https image URL", () => {
    const r = normalizeEvent({ category: "x", image: { src: "https://example.com/a.png" } }, { projectRoot: root });
    expect(r.ok).toBe(true);
  });

  it("accepts an in-project relative path", () => {
    const r = normalizeEvent({ category: "x", image: { src: "docs/a.png" } }, { projectRoot: root });
    expect(r.ok).toBe(true);
  });

  it("rejects a path escaping the project root", () => {
    const r = normalizeEvent({ category: "x", image: { src: "../../etc/passwd" } }, { projectRoot: root });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("inside the project root");
  });

  it("rejects an absolute filesystem path", () => {
    const r = normalizeEvent({ category: "x", image: { src: "/etc/passwd" } }, { projectRoot: root });
    expect(r.ok).toBe(false);
  });

  it("rejects a sibling directory sharing a name prefix", () => {
    // `startsWith` would pass this; `relative()` does not.
    const r = normalizeEvent({ category: "x", image: { src: "../set-copilot-secrets/a.png" } }, { projectRoot: root });
    expect(r.ok).toBe(false);
  });

  it("rejects non-http schemes", () => {
    for (const src of ["file:///etc/passwd", "data:image/png;base64,AAAA", "javascript:alert(1)"]) {
      expect(normalizeEvent({ category: "x", image: { src } }, { projectRoot: root }).ok).toBe(false);
    }
  });

  it("accepts a webpage with an absolute http(s) url and rejects anything else", () => {
    expect(normalizeEvent({ category: "x", webpage: { url: "https://example.com" } }).ok).toBe(true);
    expect(normalizeEvent({ category: "x", webpage: { url: "/relative" } }).ok).toBe(false);
    expect(normalizeEvent({ category: "x", webpage: { url: "javascript:alert(1)" } }).ok).toBe(false);
  });
});
