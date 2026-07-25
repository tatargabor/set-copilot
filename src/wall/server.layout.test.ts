/**
 * Runtime layout switching over the real SSE + HTTP path (wall-chat-mirror). The
 * invariant: switching a live window's layout re-derives its geometry — no restart —
 * and only for the targeted route; an unknown route/layout is dropped, never blanking.
 */

import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { buildRegistry } from "./categories.js";
import { WallServer } from "./server.js";
import type { ResolvedWindow, WallLayout, WireMessage } from "./types.js";

const registry = buildRegistry([{ id: "narráció", label: "N", icon: "🗣", render: "text" }]);

const STACKED: WallLayout = { id: "stacked", areas: [["szöveg"], ["prezentáció"]] };
const CHAT_WIDE: WallLayout = {
  id: "chat-wide",
  areas: [["szöveg", "prezentáció"]],
  columns: ["1fr", "1fr"],
};

function windows(): ResolvedWindow[] {
  const box = { behavior: "scroll" as const, cats: ["narráció"], position: "szöveg" };
  return [
    { name: "priv", route: "/", zones: ["private", "both"], layout: STACKED, boxes: [box] },
    { name: "pub", route: "/wall", zones: ["public", "both"], layout: STACKED, boxes: [box] },
  ];
}

let server: WallServer | undefined;
afterEach(() => { server?.stop(); server = undefined; });

async function startServer(): Promise<WallServer> {
  const s = new WallServer({
    port: 0, windows: windows(), layouts: [STACKED, CHAT_WIDE], registry, publicDir: "/tmp",
  });
  await s.start();
  server = s;
  return s;
}

interface Sse { msgs: WireMessage[]; close(): void; }
function connect(port: number, route: string): Promise<Sse> {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: `/events?route=${encodeURIComponent(route)}` }, (res) => {
      const sse: Sse = { msgs: [], close: () => req.destroy() };
      let buf = "";
      res.setEncoding("utf-8");
      res.on("data", (chunk: string) => {
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

function bootstrap(port: number, route: string): Promise<{ window: { layout: WallLayout } }> {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: `/api/bootstrap?route=${encodeURIComponent(route)}` }, (res) => {
      let body = "";
      res.setEncoding("utf-8");
      res.on("data", (c: string) => (body += c));
      res.on("end", () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const layoutMsgs = (sse: Sse) => sse.msgs.filter((m) => (m as { kind?: string }).kind === "layout") as { kind: "layout"; route: string; layout: WallLayout }[];

describe("runtime layout switch (wall-chat-mirror)", () => {
  it("broadcasts the new geometry to live clients on that route only", async () => {
    const s = await startServer();
    const port = s.boundPort();
    const priv = await connect(port, "/");
    const pub = await connect(port, "/wall");
    await sleep(20);

    s.ingest({ kind: "layout", route: "/wall", layout: "chat-wide" } as WireMessage);
    await sleep(20);

    // The targeted /wall client got a layout message carrying the full chat-wide geometry.
    const pubLayouts = layoutMsgs(pub);
    expect(pubLayouts).toHaveLength(1);
    expect(pubLayouts[0].layout.id).toBe("chat-wide");
    expect(pubLayouts[0].layout.areas).toEqual(CHAT_WIDE.areas);
    // The other route saw nothing.
    expect(layoutMsgs(priv)).toHaveLength(0);

    priv.close(); pub.close();
  });

  it("a client connecting AFTER the switch bootstraps into the new layout", async () => {
    const s = await startServer();
    const port = s.boundPort();

    // Before the switch, bootstrap serves the original stacked layout.
    expect((await bootstrap(port, "/wall")).window.layout.id).toBe("stacked");

    s.ingest({ kind: "layout", route: "/wall", layout: "chat-wide" } as WireMessage);
    await sleep(10);

    // After the switch, a fresh bootstrap reflects the override.
    expect((await bootstrap(port, "/wall")).window.layout.id).toBe("chat-wide");
    // The untouched route still bootstraps into its own layout.
    expect((await bootstrap(port, "/")).window.layout.id).toBe("stacked");
  });

  it("drops an unknown layout id — no broadcast, no blank", async () => {
    const s = await startServer();
    const port = s.boundPort();
    const pub = await connect(port, "/wall");
    await sleep(20);

    s.ingest({ kind: "layout", route: "/wall", layout: "does-not-exist" } as WireMessage);
    await sleep(20);

    expect(layoutMsgs(pub)).toHaveLength(0);
    expect((await bootstrap(port, "/wall")).window.layout.id).toBe("stacked"); // unchanged
    pub.close();
  });

  it("drops a switch for an unknown route", async () => {
    const s = await startServer();
    const port = s.boundPort();
    const pub = await connect(port, "/wall");
    await sleep(20);

    s.ingest({ kind: "layout", route: "/nope", layout: "chat-wide" } as WireMessage);
    await sleep(20);

    expect(layoutMsgs(pub)).toHaveLength(0);
    pub.close();
  });
});
