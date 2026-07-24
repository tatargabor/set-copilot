/**
 * Liveness heartbeat + pending placeholder over the real SSE path (wall-liveness /
 * wall-pending-indicator). The heartbeat must be server-derived (from the runtime dir),
 * refuse injection, and reach a fresh client at once; a pending marker must route by
 * zone and never become replayable state.
 */

import http from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { buildRegistry } from "./categories.js";
import { WallServer } from "./server.js";
import type { ResolvedWindow, WireMessage } from "./types.js";

const registry = buildRegistry([{ id: "architektúra", label: "A", icon: "🕸", render: "graph" }]);

function windows(): ResolvedWindow[] {
  const layout = { id: "l", areas: [["p"]] };
  const box = { behavior: "latest" as const, cats: ["architektúra"], position: "p" };
  return [
    { name: "priv", route: "/priv", zones: ["private", "both"], layout, boxes: [box] },
    { name: "pub", route: "/pub", zones: ["public", "both"], layout, boxes: [box] },
  ];
}

let server: WallServer | undefined;
afterEach(() => { server?.stop(); server = undefined; });

/** A runtime dir with a live capture.pid (this process) + a transcript to age from. */
function runtimeDirWithCapture(alivePid = process.pid): { dir: string; transcript: string } {
  const dir = mkdtempSync(join(tmpdir(), "wall-live-"));
  writeFileSync(join(dir, "capture.pid"), String(alivePid));
  const transcript = join(dir, "transcript.jsonl");
  writeFileSync(transcript, '{"text":"hello"}\n');
  return { dir, transcript };
}

async function startServer(opts: Partial<ConstructorParameters<typeof WallServer>[0]> = {}): Promise<WallServer> {
  const s = new WallServer({
    port: 0, windows: windows(), registry, publicDir: "/tmp", heartbeatMs: 20, ...opts,
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
const heartbeats = (sse: Sse) => sse.msgs.filter((m) => (m as { kind?: string }).kind === "heartbeat");
const pendings = (sse: Sse) => sse.msgs.filter((m) => (m as { kind?: string }).kind === "pending");

describe("liveness heartbeat", () => {
  it("broadcasts a server-derived heartbeat and reports capture alive", async () => {
    const { dir, transcript } = runtimeDirWithCapture();
    const s = await startServer({ runtimeDir: dir, transcriptPath: transcript });
    const c = await connect(s.boundPort(), "/priv");
    await sleep(60); // a couple of ticks

    const hbs = heartbeats(c) as Array<{ captureAlive: boolean; lastHeardMsAgo: number | null }>;
    expect(hbs.length).toBeGreaterThan(0);
    expect(hbs.at(-1)!.captureAlive).toBe(true);
    expect(typeof hbs.at(-1)!.lastHeardMsAgo).toBe("number");
    c.close();
  });

  it("reports capture stopped when the PID is gone", async () => {
    // A PID that cannot exist (kill -0 throws) → captureAlive false.
    const dir = mkdtempSync(join(tmpdir(), "wall-live-"));
    writeFileSync(join(dir, "capture.pid"), "2147483646");
    const s = await startServer({ runtimeDir: dir });
    const c = await connect(s.boundPort(), "/priv");
    await sleep(60);
    const hbs = heartbeats(c) as Array<{ captureAlive: boolean }>;
    expect(hbs.at(-1)!.captureAlive).toBe(false);
    c.close();
  });

  it("sends an immediate heartbeat on connect, before the first timer tick", async () => {
    const { dir } = runtimeDirWithCapture();
    // A long interval: any heartbeat seen quickly must be the connect-time one.
    const s = await startServer({ runtimeDir: dir, heartbeatMs: 100_000 });
    const c = await connect(s.boundPort(), "/priv");
    await sleep(30);
    expect(heartbeats(c).length).toBe(1);
    c.close();
  });

  it("drops an injected heartbeat from a source instead of broadcasting it", async () => {
    const { dir } = runtimeDirWithCapture();
    const s = await startServer({ runtimeDir: dir, heartbeatMs: 100_000 });
    const c = await connect(s.boundPort(), "/priv");
    await sleep(20);
    const before = heartbeats(c).length; // the connect-time one only
    s.ingest({ kind: "heartbeat", captureAlive: false, lastHeardMsAgo: 999 } as WireMessage);
    await sleep(20);
    // No extra heartbeat, and certainly not the injected captureAlive:false one.
    expect(heartbeats(c).length).toBe(before);
    c.close();
  });
});

describe("pending placeholder routing", () => {
  it("broadcasts a pending marker to a subscribing client", async () => {
    const s = await startServer({ heartbeatMs: 100_000 });
    const c = await connect(s.boundPort(), "/priv");
    await sleep(20);
    s.ingest({ kind: "pending", category: "architektúra", zone: "private", label: "rajzolom" } as WireMessage);
    await sleep(20);
    const p = pendings(c) as Array<{ label: string }>;
    expect(p).toHaveLength(1);
    expect(p[0].label).toBe("rajzolom");
    c.close();
  });

  it("does not deliver a private pending to a public window (zone gate)", async () => {
    const s = await startServer({ heartbeatMs: 100_000 });
    const pub = await connect(s.boundPort(), "/pub");
    await sleep(20);
    s.ingest({ kind: "pending", category: "architektúra", zone: "private", label: "belső" } as WireMessage);
    await sleep(20);
    expect(pendings(pub)).toHaveLength(0);
    expect(pub.raw).not.toContain("belső");
    pub.close();
  });

  it("is transient: a pending is never replayed to a later-joining client", async () => {
    const s = await startServer({ heartbeatMs: 100_000 });
    s.ingest({ kind: "pending", category: "architektúra", zone: "private", label: "rajzolom" } as WireMessage);
    await sleep(20);
    // A client that joins AFTER the pending must not receive it — it is not accumulated
    // replay state, only a live broadcast.
    const late = await connect(s.boundPort(), "/priv");
    await sleep(20);
    expect(pendings(late)).toHaveLength(0);
    late.close();
  });
});
