/**
 * Server-side redaction over the REAL broadcast / replay / show path — HTTP + SSE,
 * not just the pure `splitForZones` function (public-redaction task 4.4). Each test
 * connects genuine SSE clients to a running `WallServer` and asserts what a public
 * vs. a private window actually receives off the wire.
 */

import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { buildRegistry } from "./categories.js";
import { WallServer } from "./server.js";
import type { RedactionConfig, ResolvedWindow, WireMessage } from "./types.js";

const REDACTION: RedactionConfig = {
  patterns: ["SECRET-[\\p{L}\\p{N}]+", "\\[(?:belső|internal)[^\\]]*\\][^\\n]*"],
  replacement: "[…]",
  maxInputLength: 10_000,
};

const registry = buildRegistry([
  { id: "narráció", label: "N", icon: "", render: "text" },
  { id: "architektúra", label: "A", icon: "", render: "graph" },
  { id: "doc", label: "D", icon: "", render: "webpage" },
  { id: "tükör", label: "T", icon: "", render: "text" },
]);

/** A box subscribing to every category under test, at one position. */
const boxAllCats = {
  behavior: "latest" as const,
  cats: ["narráció", "architektúra", "doc", "tükör"],
  pacing: { minDwellMs: 0 },
  position: "p",
};

function windows(): ResolvedWindow[] {
  const layout = { id: "l", areas: [["p"]] };
  return [
    { name: "priv", route: "/priv", zones: ["private", "both"], layout, boxes: [boxAllCats] },
    { name: "pub", route: "/pub", zones: ["public", "both"], layout, boxes: [boxAllCats] },
  ];
}

let server: WallServer | undefined;

afterEach(() => {
  server?.stop();
  server = undefined;
});

async function startServer(): Promise<WallServer> {
  const s = new WallServer({
    port: 0, windows: windows(), registry, publicDir: "/tmp", redaction: REDACTION, directorTickMs: 10,
  });
  await s.start();
  server = s;
  return s;
}

interface Sse {
  msgs: WireMessage[];
  raw: string;
  close(): void;
}

/** Open a real SSE connection and collect parsed `data:` frames. */
function connect(port: number, route: string): Promise<Sse> {
  return new Promise((resolve) => {
    const req = http.get(
      { host: "127.0.0.1", port, path: `/events?route=${encodeURIComponent(route)}` },
      (res) => {
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
                try { sse.msgs.push(JSON.parse(line.slice(6))); } catch { /* retry: line */ }
              }
            }
          }
        });
        resolve(sse);
      },
    );
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("live broadcast splits by zone", () => {
  it("scrubs a [belső] span for the public wall, marks the private view", async () => {
    const s = await startServer();
    const port = s.boundPort();
    const pub = await connect(port, "/pub");
    const priv = await connect(port, "/priv");
    await sleep(20);

    s.ingest({ category: "narráció", zone: "both", text: "roadmap [belső] project-hush details" });
    await sleep(30);

    const pubText = pub.msgs.find((m) => "text" in m) as { text: string; redaction?: string } | undefined;
    const privText = priv.msgs.find((m) => "text" in m) as { text: string; redaction?: string } | undefined;

    expect(pubText?.text).toBe("roadmap […]");
    expect(pub.raw).not.toContain("project-hush"); // never on the public wire, in any framing
    expect(pubText?.redaction).toBeUndefined();
    expect(privText?.text).toBe("roadmap [belső] project-hush details");
    expect(privText?.redaction).toBe("redacted");

    pub.close();
    priv.close();
  });

  it("redacts a mirrored chat line on the same ingest path — no bypass (wall-chat-mirror)", async () => {
    const s = await startServer();
    const port = s.boundPort();
    const pub = await connect(port, "/pub");
    const priv = await connect(port, "/priv");
    await sleep(20);

    // A mirrored chat line is an ordinary `tükör` text event — it goes through ingest, so
    // public-zone redaction applies to it exactly as to any other event.
    s.ingest({ category: "tükör", zone: "both", text: "döntés: [belső] SECRET-hush marad" });
    await sleep(30);

    const pubText = pub.msgs.find((m) => "text" in m) as { text: string } | undefined;
    const privText = priv.msgs.find((m) => "text" in m) as { text: string; redaction?: string } | undefined;
    expect(pubText?.text).toBe("döntés: […]");
    expect(pub.raw).not.toContain("SECRET-hush"); // never on the public wire
    expect(privText?.text).toBe("döntés: [belső] SECRET-hush marad");
    expect(privText?.redaction).toBe("redacted");

    pub.close();
    priv.close();
  });

  it("withholds a webpage whose URL carries a secret from the public wall", async () => {
    const s = await startServer();
    const port = s.boundPort();
    const pub = await connect(port, "/pub");
    const priv = await connect(port, "/priv");
    await sleep(20);

    s.ingest({ category: "doc", zone: "both", webpage: { url: "https://x.test/?t=SECRET-abc", title: "clean title" } });
    await sleep(30);

    expect(pub.msgs.some((m) => "webpage" in m)).toBe(false); // withheld entirely
    expect(pub.raw).not.toContain("SECRET-abc");
    expect(priv.msgs.some((m) => "webpage" in m)).toBe(true); // private still gets it

    pub.close();
    priv.close();
  });
});

describe("replay filters by per-delta zone (D3 / 2.3)", () => {
  it("a public join gets only the both delta, never the two private ones", async () => {
    const s = await startServer();
    const port = s.boundPort();

    // Two private deltas, then one both delta, on the same visual — BEFORE anyone joins.
    s.ingest({ category: "architektúra", zone: "private", visual: "v1", priority: "immediate", graph: { op: "reset", nodes: [{ id: "p1", label: "PRIV-one" }] } });
    s.ingest({ category: "architektúra", zone: "private", visual: "v1", graph: { op: "add", nodes: [{ id: "p2", label: "PRIV-two" }] } });
    s.ingest({ category: "architektúra", zone: "both", visual: "v1", graph: { op: "add", nodes: [{ id: "b1", label: "BOTH-three" }] } });
    await sleep(20);

    const pub = await connect(port, "/pub");
    await sleep(30);

    expect(pub.raw).not.toContain("PRIV-one");
    expect(pub.raw).not.toContain("PRIV-two");
    expect(pub.raw).toContain("BOTH-three");

    // And a private join still sees the whole history.
    const priv = await connect(port, "/priv");
    await sleep(30);
    expect(priv.raw).toContain("PRIV-one");
    expect(priv.raw).toContain("BOTH-three");

    pub.close();
    priv.close();
  });
});

describe("the show command is zoned (D4 / 3.2)", () => {
  it("a private visual's show and id never reach a public client", async () => {
    const s = await startServer();
    const port = s.boundPort();
    const pub = await connect(port, "/pub");
    const priv = await connect(port, "/priv");
    await sleep(20);

    s.ingest({ category: "architektúra", zone: "private", visual: "[internal] project-hush", priority: "immediate", graph: { op: "reset", nodes: [{ id: "x", label: "y" }] } });
    await sleep(30);

    expect(pub.raw).not.toContain("project-hush"); // neither the show nor the graph
    expect(pub.msgs.some((m) => "kind" in m && m.kind === "show")).toBe(false);
    // The private view gets both the graph and its show.
    expect(priv.raw).toContain("project-hush");
    expect(priv.msgs.some((m) => "kind" in m && m.kind === "show")).toBe(true);

    pub.close();
    priv.close();
  });

  it("a sensitive visual id does not leak to a LATE public join via replay", async () => {
    const s = await startServer();
    const port = s.boundPort();

    // A both-zone graph with PUBLIC-SAFE node content but a sensitive visual id.
    // Live, the show is zoned away; the id must not come back on a late public replay.
    s.ingest({ category: "architektúra", zone: "both", visual: "merger-with-[belső] SECRET-corp", priority: "immediate", graph: { op: "reset", nodes: [{ id: "n1", label: "clean-public-node" }] } });
    await sleep(20);

    const pub = await connect(port, "/pub");
    await sleep(30);
    expect(pub.raw).not.toContain("SECRET-corp"); // the raw id must not reach the public replay
    expect(pub.raw).not.toContain("belső");

    // A private join still reconstructs the visual (operator sees everything).
    const priv = await connect(port, "/priv");
    await sleep(30);
    expect(priv.raw).toContain("SECRET-corp");

    pub.close();
    priv.close();
  });
});
