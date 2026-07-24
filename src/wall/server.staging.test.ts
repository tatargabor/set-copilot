/**
 * Predictive staging over the real SSE path (predictive-staging). The load-bearing
 * invariant: a staged private prediction NEVER reaches a public client on its own — only
 * an explicit promote lifts it, redaction still applies, and an expired prediction is
 * released and can no longer be promoted.
 */

import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { buildRegistry } from "./categories.js";
import { WallServer } from "./server.js";
import type { RedactionConfig, ResolvedWindow, WireMessage } from "./types.js";

const REDACTION: RedactionConfig = { patterns: ["titok"], replacement: "[…]", maxInputLength: 1_000 };
const registry = buildRegistry([{ id: "előrejelzés", label: "E", icon: "🔮", render: "graph" }]);

// A paced staging box on `előrejelzés`, present in both a private and a public window —
// paced so a graph actually shows, and shared so the promote target has somewhere to land.
function windows(): ResolvedWindow[] {
  const layout = { id: "l", areas: [["p"]] };
  const box = { behavior: "latest" as const, cats: ["előrejelzés"], position: "p", pacing: { minDwellMs: 0 } };
  return [
    { name: "priv", route: "/priv", zones: ["private", "both"], layout, boxes: [box] },
    { name: "pub", route: "/pub", zones: ["public", "both"], layout, boxes: [box] },
  ];
}

let server: WallServer | undefined;
afterEach(() => { server?.stop(); server = undefined; });

async function startServer(opts: Partial<ConstructorParameters<typeof WallServer>[0]> = {}): Promise<WallServer> {
  const s = new WallServer({
    port: 0, windows: windows(), registry, publicDir: "/tmp", redaction: REDACTION,
    directorTickMs: 5, stagingTtlMs: 0, ...opts,
  });
  await s.start();
  server = s;
  return s;
}

interface Sse { msgs: WireMessage[]; raw: string; close(): void; }
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
            if (line.startsWith("data: ")) { try { sse.msgs.push(JSON.parse(line.slice(6))); } catch { /* */ } }
          }
        }
      });
      resolve(sse);
    });
  });
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const graphs = (sse: Sse) => sse.msgs.filter((m) => "graph" in (m as Record<string, unknown>));
const kinds = (sse: Sse, k: string) => sse.msgs.filter((m) => (m as { kind?: string }).kind === k);

function stage(visual: string, label = "adatfolyam"): WireMessage {
  return { category: "előrejelzés", zone: "private", staged: true, visual,
    graph: { op: "reset", nodes: [{ id: "a", label }], edges: [] } } as WireMessage;
}

describe("staging invariant: a prediction never publishes autonomously", () => {
  it("a staged private visual reaches the private view and NOTHING reaches the public wall", async () => {
    const s = await startServer();
    const port = s.boundPort();
    const priv = await connect(port, "/priv");
    const pub = await connect(port, "/pub");
    await sleep(20);

    s.ingest(stage("v1"));
    await sleep(30);

    // Private view got the staged graph; public wall got no graph and no show at all.
    expect(graphs(priv).length).toBeGreaterThan(0);
    expect(graphs(pub)).toHaveLength(0);
    expect(kinds(pub, "show")).toHaveLength(0);
    expect(pub.raw).not.toContain("adatfolyam");

    priv.close(); pub.close();
  });

  it("a late-joining public client never replays a staged private visual", async () => {
    const s = await startServer();
    const port = s.boundPort();
    s.ingest(stage("v1"));
    await sleep(20);
    const pub = await connect(port, "/pub"); // joins AFTER the staging
    await sleep(20);
    expect(graphs(pub)).toHaveLength(0);
    expect(pub.raw).not.toContain("adatfolyam");
    pub.close();
  });
});

describe("promote: an explicit zone-lift of the prepared visual", () => {
  it("lifts the existing visual to the public wall without redrawing", async () => {
    const s = await startServer();
    const port = s.boundPort();
    const pub = await connect(port, "/pub");
    await sleep(20);

    s.ingest(stage("v1", "kapacitás"));
    await sleep(20);
    expect(graphs(pub)).toHaveLength(0); // still private

    s.ingest({ kind: "promote", category: "előrejelzés", visual: "v1", zone: "public" } as WireMessage);
    await sleep(30);

    const g = graphs(pub) as Array<{ graph: { nodes: Array<{ label: string }> } }>;
    expect(g.length).toBeGreaterThan(0);
    // Same prepared content — the node the staging drew, not a fresh draw.
    expect(g.at(-1)!.graph.nodes[0].label).toBe("kapacitás");
    pub.close();
  });

  it("a promotion into a redacted zone still obeys redaction", async () => {
    const s = await startServer();
    const port = s.boundPort();
    const pub = await connect(port, "/pub");
    await sleep(20);

    s.ingest(stage("v1", "titok terv")); // a sensitive node label
    await sleep(20);
    s.ingest({ kind: "promote", category: "előrejelzés", visual: "v1", zone: "both" } as WireMessage);
    await sleep(30);

    expect(pub.raw).not.toContain("titok");
    const g = graphs(pub) as Array<{ graph: { nodes: Array<{ label: string }> } }>;
    expect(g.at(-1)!.graph.nodes[0].label).toContain("[…]");
    pub.close();
  });

  it("refuses to promote a visual that was never staged", async () => {
    const s = await startServer();
    const port = s.boundPort();
    const pub = await connect(port, "/pub");
    await sleep(20);
    // A visual id the server never saw staged.
    s.ingest({ kind: "promote", category: "előrejelzés", visual: "ghost", zone: "public" } as WireMessage);
    await sleep(20);
    expect(graphs(pub)).toHaveLength(0);
    pub.close();
  });
});

describe("expiry: an unused prediction is released and no longer promotable", () => {
  it("releases the staged visual with a private marker and refuses a later promote", async () => {
    // Tiny ttl + fast sweep so expiry fires within the test.
    const s = await startServer({ stagingTtlMs: 30, stagingSweepMs: 10 });
    const port = s.boundPort();
    const priv = await connect(port, "/priv");
    const pub = await connect(port, "/pub");
    await sleep(20);

    s.ingest(stage("v1"));
    await sleep(80); // let it expire + be swept

    // The private view was told it expired; the public wall never hears of it.
    expect(kinds(priv, "stage-expired").length).toBeGreaterThan(0);
    expect(kinds(pub, "stage-expired")).toHaveLength(0);

    // A promote after expiry is refused — nothing reaches the public wall.
    s.ingest({ kind: "promote", category: "előrejelzés", visual: "v1", zone: "public" } as WireMessage);
    await sleep(30);
    expect(graphs(pub)).toHaveLength(0);

    priv.close(); pub.close();
  });
});
