/**
 * The audience declaration (wall-public-surface).
 *
 * The thing under test is a *pivot*: `isPublicClient` decides which redacted variant is
 * broadcast, which accumulation slice is replayed, whether a `stage-expired` is delivered,
 * and how a `show` is zoned. It used to be INFERRED from the window's zone list
 * (`!zones.includes("private")`), so an operator who widened a public wall's zones to show
 * more turned redaction off in front of a room — silently, with no warning and no visible
 * change until something leaked.
 *
 * These tests are named for the failure they fence, not the function they call: the point
 * is that a future refactor which "simplifies" the audience back into an inference over
 * zones breaks a test whose name says why it must not.
 */

import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_LAYOUTS, DEFAULT_WINDOWS } from "../config.js";
import { buildRegistry } from "./categories.js";
import { resolveWindow, resolveWindows } from "./layout.js";
import { WallServer } from "./server.js";
import type { RedactionConfig, ResolvedWindow, WallWindow, WireMessage } from "./types.js";

const LAYOUTS = [{ id: "l", areas: [["p"]] }];
const box = { behavior: "scroll" as const, cats: ["narráció"] };

function win(over: Partial<WallWindow>): WallWindow {
  return { name: "w", route: "/", zones: ["both"], layout: "l", boxes: { p: box }, ...over };
}

function collectWarnings(w: WallWindow): { audience?: string; warnings: string[] } {
  const warnings: string[] = [];
  const r = resolveWindow(w, LAYOUTS, (m) => warnings.push(m));
  return { audience: r?.audience, warnings };
}

describe("resolveAudience is fail-closed (3.1 / 3.3)", () => {
  it("resolves a window that declares NO audience to public — the protected default", () => {
    // Named so that re-deriving the audience from `zones` breaks this test by name.
    // Under the old inference this window (private in its zones) was "not public", i.e.
    // NO redaction. The default now points the other way.
    const { audience, warnings } = collectWarnings(win({ zones: ["private", "both"] }));
    expect(audience).toBe("public");
    expect(warnings.join("\n")).toContain('window "w"');
    expect(warnings.join("\n")).toContain("audience");
  });

  it("warns with the one-field fix so an operator who hits it knows what to write", () => {
    const { warnings } = collectWarnings(win({ zones: ["private", "both"] }));
    expect(warnings.join("\n")).toContain('"audience": "operator"');
  });

  it("stays quiet for an undeclared window that renders no private zone — nothing changed for it", () => {
    const { audience, warnings } = collectWarnings(win({ zones: ["public", "both"] }));
    expect(audience).toBe("public");
    expect(warnings).toEqual([]);
  });

  it("treats an unreadable audience as public rather than guessing", () => {
    const { audience, warnings } = collectWarnings(
      win({ zones: ["private", "both"], audience: "kivetítő" as unknown as "public" }),
    );
    expect(audience).toBe("public");
    expect(warnings.join("\n")).toContain("unknown audience");
  });

  it("resolves a disagreement toward the protected reading, with a warning (3.3)", () => {
    // "operator" but no private zone: expressible only now, and far more likely to be a
    // mislabelled public wall than a deliberate configuration.
    const { audience, warnings } = collectWarnings(win({ zones: ["public", "both"], audience: "operator" }));
    expect(audience).toBe("public");
    expect(warnings.join("\n")).toContain("resolving as PUBLIC");
  });

  it("honours an explicit operator declaration backed by a private zone", () => {
    const { audience, warnings } = collectWarnings(win({ zones: ["private", "both"], audience: "operator" }));
    expect(audience).toBe("operator");
    expect(warnings).toEqual([]);
  });
});

describe("the shipped config resolves to the same protection as before (3.5 / D2)", () => {
  it("declares both windows explicitly, so a default install warns about nothing", () => {
    const warnings: string[] = [];
    const resolved = resolveWindows(DEFAULT_WINDOWS, DEFAULT_LAYOUTS, (m) => warnings.push(m));
    const by = Object.fromEntries(resolved.map((r) => [r.name, r.audience]));
    expect(by["én"]).toBe("operator");
    expect(by["fal"]).toBe("public");
    expect(warnings.join("\n")).not.toContain("audience");
  });

  it("agrees with the OLD zone inference on the shipped windows — this change moves no default", () => {
    // The regression fence for D2: whatever else changed, the two shipped windows must
    // land on exactly the protection they had before the declaration existed.
    for (const w of DEFAULT_WINDOWS) {
      const oldInference = !w.zones.includes("private") ? "public" : "operator";
      const resolved = resolveWindow(w, DEFAULT_LAYOUTS, () => {});
      expect(resolved?.audience).toBe(oldInference);
    }
  });
});

// ---- over the real wire ----

const REDACTION: RedactionConfig = {
  patterns: ["SECRET-[\\p{L}\\p{N}]+"],
  replacement: "[…]",
  maxInputLength: 10_000,
};
const registry = buildRegistry([{ id: "narráció", label: "N", icon: "", render: "text" }]);
const wireBox = { behavior: "scroll" as const, cats: ["narráció"], position: "p" };

let server: WallServer | undefined;
afterEach(() => { server?.stop(); server = undefined; });

async function startWith(windows: ResolvedWindow[]): Promise<WallServer> {
  const s = new WallServer({ port: 0, windows, registry, publicDir: "/tmp", redaction: REDACTION, directorTickMs: 10 });
  await s.start();
  server = s;
  return s;
}

interface Sse { msgs: WireMessage[]; raw: string; close(): void }

function connect(port: number, route: string): Promise<Sse> {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: `/events?route=${encodeURIComponent(route)}` }, (res) => {
      const sse: Sse = { msgs: [], raw: "", close: () => req.destroy() };
      let buf = "";
      res.setEncoding("utf-8");
      res.on("data", (chunk: string) => {
        sse.raw += chunk;
        buf += chunk;
        let i: number;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, i);
          buf = buf.slice(i + 2);
          for (const line of frame.split("\n")) {
            if (line.startsWith("data: ")) {
              try { sse.msgs.push(JSON.parse(line.slice(6))); } catch { /* partial */ }
            }
          }
        }
      });
      resolve(sse);
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("a public surface whose zones were widened (3.2)", () => {
  /** Exactly the field misconfiguration this change exists to defuse. */
  const widened: ResolvedWindow[] = [
    {
      name: "fal", route: "/wall", zones: ["public", "both", "private"], audience: "public",
      layout: { id: "l", areas: [["p"]] }, boxes: [wireBox],
    },
  ];

  it("still redacts — widening the zone list is not a way to switch redaction off", async () => {
    const s = await startWith(widened);
    const c = await connect(s.boundPort(), "/wall");
    await sleep(20);
    s.ingest({ category: "narráció", zone: "both", text: "kód SECRET-abc marad" });
    await sleep(30);

    const text = c.msgs.find((m) => "text" in m) as { text: string } | undefined;
    expect(text?.text).toBe("kód […] marad");
    expect(c.raw).not.toContain("SECRET-abc");
    c.close();
  });

  it("NEVER delivers a private-zone event to it, whatever the zone filter admits", async () => {
    // The D3 gate. `zone: "private"` is the one gate no configuration may route around:
    // redaction is a shape-matcher, and it is not what stands between an internal detail
    // and a room. Note the zone filter here WOULD admit this event.
    const s = await startWith(widened);
    const c = await connect(s.boundPort(), "/wall");
    await sleep(20);
    s.ingest({ category: "narráció", zone: "private", text: "csak nekem: a partner ára" });
    await sleep(30);

    expect(c.raw).not.toContain("a partner ára");
    expect(c.msgs.some((m) => "text" in m)).toBe(false);
    c.close();
  });
});

describe("an operator window is unchanged (3.4)", () => {
  const both: ResolvedWindow[] = [
    { name: "én", route: "/", zones: ["private", "both"], audience: "operator", layout: { id: "l", areas: [["p"]] }, boxes: [wireBox] },
    { name: "fal", route: "/wall", zones: ["public", "both"], audience: "public", layout: { id: "l", areas: [["p"]] }, boxes: [wireBox] },
  ];

  it("receives private events raw, with the redaction marker the public wall's copy lost", async () => {
    const s = await startWith(both);
    const port = s.boundPort();
    const priv = await connect(port, "/");
    await sleep(20);
    s.ingest({ category: "narráció", zone: "private", text: "privát: SECRET-abc" });
    s.ingest({ category: "narráció", zone: "both", text: "közös: SECRET-abc" });
    await sleep(30);

    expect(priv.raw).toContain("privát: SECRET-abc");
    const shared = priv.msgs.find((m) => "text" in m && (m as { text: string }).text.startsWith("közös"));
    expect(shared).toBeDefined();
    expect((shared as { redaction?: string }).redaction).toBe("redacted");
    priv.close();
  });

  it("replays the private accumulation slice on a late join, exactly as before", async () => {
    const s = await startWith(both);
    const port = s.boundPort();
    s.ingest({ category: "narráció", zone: "private", text: "korábbi privát sor" });
    await sleep(20);

    const priv = await connect(port, "/");
    const pub = await connect(port, "/wall");
    await sleep(30);
    expect(priv.raw).toContain("korábbi privát sor");
    expect(pub.raw).not.toContain("korábbi privát sor");
    priv.close();
    pub.close();
  });
});
