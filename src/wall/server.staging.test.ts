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
    { name: "priv", route: "/priv", zones: ["private", "both"], audience: "operator", layout, boxes: [box] },
    { name: "pub", route: "/pub", zones: ["public", "both"], audience: "public", layout, boxes: [box] },
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

describe("the promotable listing: the producer asks instead of remembering", () => {
  function get(port: number, path: string): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      http.get({ host: "127.0.0.1", port, path }, (res) => {
        let b = "";
        res.setEncoding("utf-8");
        res.on("data", (c: string) => { b += c; });
        res.on("end", () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
      }).on("error", reject);
    });
  }
  const listOf = (j: Record<string, unknown>) => j.staged as { category: string; visual: string; expiresInMs: number }[];

  it("lists a staged, unexpired, unpromoted prediction with its remaining time", async () => {
    const s = await startServer({ stagingTtlMs: 60_000, stagingSweepMs: 10_000 });
    s.ingest(stage("v1"));
    await sleep(20);
    const list = listOf(await get(s.boundPort(), "/api/staged"));
    expect(list).toHaveLength(1);
    expect(list[0].category).toBe("előrejelzés");
    expect(list[0].visual).toBe("v1");
    // A remaining time, not a stagedAt: the producer needs "how long have I got".
    expect(list[0].expiresInMs).toBeGreaterThan(0);
    expect(list[0].expiresInMs).toBeLessThanOrEqual(60_000);
  });

  it("empty is empty — nothing staged lists nothing", async () => {
    const s = await startServer({ stagingTtlMs: 60_000 });
    expect(listOf(await get(s.boundPort(), "/api/staged"))).toHaveLength(0);
  });

  it("a promoted prediction is no longer listed", async () => {
    const s = await startServer({ stagingTtlMs: 60_000, stagingSweepMs: 10_000 });
    s.ingest(stage("v1"));
    s.ingest(stage("v2"));
    await sleep(20);
    expect(listOf(await get(s.boundPort(), "/api/staged"))).toHaveLength(2);

    s.ingest({ kind: "promote", category: "előrejelzés", visual: "v1", zone: "public" } as WireMessage);
    await sleep(20);
    const list = listOf(await get(s.boundPort(), "/api/staged"));
    expect(list.map((e) => e.visual)).toEqual(["v2"]);
  });

  it("an expired prediction is not listed, and asking does not revive it", async () => {
    // Sweep disabled: the listing must filter by the clock on its own, so a prediction
    // cannot become promotable again just because the sweep timer has not fired yet.
    const s = await startServer({ stagingTtlMs: 25, stagingSweepMs: 10_000 });
    s.ingest(stage("v1"));
    await sleep(60);
    expect(listOf(await get(s.boundPort(), "/api/staged"))).toHaveLength(0);
    // Asking did not extend its life: a promote after the ttl is still refused.
    const pub = await connect(s.boundPort(), "/pub");
    await sleep(20);
    s.ingest({ kind: "promote", category: "előrejelzés", visual: "v1", zone: "public" } as WireMessage);
    await sleep(30);
    expect(graphs(pub)).toHaveLength(0);
    pub.close();
  });

  it("asking broadcasts nothing and changes no state (read-only)", async () => {
    const s = await startServer({ stagingTtlMs: 60_000, stagingSweepMs: 10_000 });
    const port = s.boundPort();
    const priv = await connect(port, "/priv");
    const pub = await connect(port, "/pub");
    await sleep(20);
    s.ingest(stage("v1"));
    await sleep(30);
    const privBefore = priv.msgs.length;
    const pubBefore = pub.msgs.length;

    const a = listOf(await get(port, "/api/staged"));
    await sleep(30);
    const b = listOf(await get(port, "/api/staged"));

    // No client saw anything because of the query...
    expect(priv.msgs.length).toBe(privBefore);
    expect(pub.msgs.length).toBe(pubBefore);
    // ...and the answer is stable except for the ticking clock.
    expect(b.map((e) => e.visual)).toEqual(a.map((e) => e.visual));
    expect(b[0].expiresInMs).toBeLessThanOrEqual(a[0].expiresInMs);
    priv.close(); pub.close();
  });
});
