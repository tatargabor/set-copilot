/**
 * Scroll-history connect-time replay over the real SSE path (wall-scroll-replay).
 * A reloading window must see the recent scroll lines, bounded to the last N, in
 * order, and zone-filtered exactly like the live stream.
 */

import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { buildRegistry } from "./categories.js";
import { WallServer } from "./server.js";
import type { RedactionConfig, ResolvedWindow, WireMessage } from "./types.js";

const REDACTION: RedactionConfig = {
  patterns: ["SECRET-[\\p{L}\\p{N}]+"],
  replacement: "[…]",
  maxInputLength: 1_000,
};

const registry = buildRegistry([{ id: "súgás", label: "S", icon: "", render: "text" }]);

// A scroll box on `súgás`, present in both a private and a public window so zone
// filtering can be observed from each side.
function windows(): ResolvedWindow[] {
  const layout = { id: "l", areas: [["p"]] };
  const box = { behavior: "scroll" as const, cats: ["súgás"], position: "p" };
  return [
    { name: "priv", route: "/priv", zones: ["private", "both"], layout, boxes: [box] },
    { name: "pub", route: "/pub", zones: ["public", "both"], layout, boxes: [box] },
  ];
}

let server: WallServer | undefined;

afterEach(() => {
  server?.stop();
  server = undefined;
});

async function startServer(scrollHistory = 20): Promise<WallServer> {
  const s = new WallServer({
    port: 0, windows: windows(), registry, publicDir: "/tmp", redaction: REDACTION, scrollHistory, directorTickMs: 10,
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
const texts = (sse: Sse) => sse.msgs.filter((m): m is { text: string } & WireMessage => "text" in m).map((m) => (m as { text: string }).text);

describe("scroll-history replay", () => {
  it("replays the last N scroll lines in order to a reloading window", async () => {
    const s = await startServer(3); // small ring to observe eviction
    const port = s.boundPort();

    for (let i = 1; i <= 5; i++) s.ingest({ category: "súgás", zone: "private", text: `line ${i}` });
    await sleep(20);

    const priv = await connect(port, "/priv");
    await sleep(30);
    // Only the last 3 survive the ring, oldest→newest.
    expect(texts(priv)).toEqual(["line 3", "line 4", "line 5"]);

    priv.close();
  });

  it("does not replay a private scroll line to a public window (zone-filtered)", async () => {
    const s = await startServer();
    const port = s.boundPort();

    s.ingest({ category: "súgás", zone: "private", text: "private hint one" });
    s.ingest({ category: "súgás", zone: "both", text: "shared hint two" });
    await sleep(20);

    const pub = await connect(port, "/pub");
    const priv = await connect(port, "/priv");
    await sleep(30);

    // Public window: only the both-zone line, never the private one.
    expect(pub.raw).not.toContain("private hint one");
    expect(texts(pub)).toEqual(["shared hint two"]);
    // Private window: the whole recent history.
    expect(texts(priv)).toEqual(["private hint one", "shared hint two"]);

    pub.close();
    priv.close();
  });

  it("replays the REDACTED public variant of a scroll line, never the raw one", async () => {
    const s = await startServer();
    const port = s.boundPort();

    s.ingest({ category: "súgás", zone: "both", text: "budget is SECRET-4m today" });
    await sleep(20);

    const pub = await connect(port, "/pub");
    await sleep(30);
    expect(pub.raw).not.toContain("SECRET-4m");
    expect(texts(pub)).toEqual(["budget is […] today"]);

    pub.close();
  });
});
