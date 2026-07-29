/**
 * Resumable SSE delivery (wall-stream-recovery).
 *
 * The wall's most-repeated field failure is that it goes stale and only a hard reload
 * brings it back. The browser's native reconnect already fired; what was missing is that
 * the server re-ran history the client already had, so reconnecting could never be made
 * idempotent. These tests pin the three branches that matters: resume delivers exactly the
 * missed span, an unsatisfiable resume falls back honestly, and — the highest-stakes one —
 * resume goes through the SAME zone gates as the live broadcast, so a public client
 * resuming across a private event still never receives it.
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

function windows(): ResolvedWindow[] {
  const layout = { id: "l", areas: [["p"]] };
  const box = { behavior: "scroll" as const, cats: ["súgás"], position: "p" };
  return [
    { name: "priv", route: "/priv", zones: ["private", "both"], audience: "operator", layout, boxes: [box] },
    { name: "pub", route: "/pub", zones: ["public", "both"], audience: "public", layout, boxes: [box] },
  ];
}

let server: WallServer | undefined;
afterEach(() => { server?.stop(); server = undefined; });

async function startServer(): Promise<WallServer> {
  const s = new WallServer({
    port: 0, windows: windows(), registry, publicDir: "/tmp", redaction: REDACTION, directorTickMs: 10,
  });
  await s.start();
  server = s;
  return s;
}

interface Sse { msgs: WireMessage[]; ids: string[]; raw: string; close(): void; }

/** Connect, optionally presenting a resume cursor the way a reconnecting browser does. */
function connect(port: number, route: string, lastEventId?: string): Promise<Sse> {
  return new Promise((resolve) => {
    const req = http.get({
      host: "127.0.0.1", port, path: `/events?route=${encodeURIComponent(route)}`,
      ...(lastEventId ? { headers: { "Last-Event-ID": lastEventId } } : {}),
    }, (res) => {
      const sse: Sse = { msgs: [], ids: [], raw: "", close: () => req.destroy() };
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
            if (line.startsWith("id: ")) sse.ids.push(line.slice(4));
            if (line.startsWith("data: ")) { try { sse.msgs.push(JSON.parse(line.slice(6))); } catch { /* */ } }
          }
        }
      });
      resolve(sse);
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const texts = (sse: Sse) => sse.msgs
  .filter((m): m is { text: string } & WireMessage => "text" in m)
  .map((m) => (m as { text: string }).text);
const isFullReplay = (sse: Sse) => sse.msgs.some((m) => (m as { kind?: string }).kind === "replay");

describe("resumable delivery", () => {
  it("delivers exactly the span a reconnecting client missed, and nothing it already had", async () => {
    const s = await startServer();
    const port = s.boundPort();

    const first = await connect(port, "/priv");
    s.ingest({ category: "súgás", zone: "private", text: "one" });
    s.ingest({ category: "súgás", zone: "private", text: "two" });
    await sleep(30);
    expect(texts(first)).toEqual(["one", "two"]);
    const cursor = first.ids[first.ids.length - 1];
    first.close();
    await sleep(10);

    // Broadcast while nobody is listening — this is the span the client owes itself.
    s.ingest({ category: "súgás", zone: "private", text: "three" });
    s.ingest({ category: "súgás", zone: "private", text: "four" });
    await sleep(20);

    const again = await connect(port, "/priv", cursor);
    await sleep(30);
    // Exactly the missed span: no re-run of "one"/"two", no gap at "three".
    expect(texts(again)).toEqual(["three", "four"]);
    expect(isFullReplay(again)).toBe(false);
    again.close();
  });

  it("says nothing when the client is already current", async () => {
    const s = await startServer();
    const port = s.boundPort();
    const first = await connect(port, "/priv");
    s.ingest({ category: "súgás", zone: "private", text: "one" });
    await sleep(30);
    const cursor = first.ids[first.ids.length - 1];
    first.close();
    await sleep(10);

    const again = await connect(port, "/priv", cursor);
    await sleep(30);
    expect(texts(again)).toEqual([]);
    expect(isFullReplay(again)).toBe(false);
    again.close();
  });

  it("NEVER hands a public client a private event it missed", async () => {
    // The highest-stakes property of this change: resume is a THIRD way for events to
    // reach a client, and it must inherit the zone gates rather than reimplement them.
    const s = await startServer();
    const port = s.boundPort();

    const pub = await connect(port, "/pub");
    s.ingest({ category: "súgás", zone: "both", text: "shared one" });
    await sleep(30);
    const cursor = pub.ids[pub.ids.length - 1];
    pub.close();
    await sleep(10);

    s.ingest({ category: "súgás", zone: "private", text: "private secret" });
    s.ingest({ category: "súgás", zone: "both", text: "shared two SECRET-abc" });
    await sleep(20);

    const again = await connect(port, "/pub", cursor);
    await sleep(30);
    expect(again.raw).not.toContain("private secret");
    // And the public variant is still the REDACTED one — resume did not bypass the scrub.
    expect(texts(again)).toEqual(["shared two […]"]);
    again.close();
  });

  it("falls back to a full, announced replay when the cursor is not retained", async () => {
    const s = await startServer();
    const port = s.boundPort();
    s.ingest({ category: "súgás", zone: "private", text: "one" });
    await sleep(20);

    // A cursor from this run but far beyond anything retained backwards: seq 0 is fine,
    // so use an id the tail cannot reach back to by evicting past it is impractical here —
    // instead present a syntactically valid id from ANOTHER run, which is the same branch
    // a restarted server produces and the one the field actually hits.
    const again = await connect(port, "/priv", "not-this-run-9:5");
    await sleep(30);
    expect(isFullReplay(again)).toBe(true);
    expect(texts(again)).toEqual(["one"]); // correct, rather than missing an unknown span
    again.close();
  });

  it("falls back when the cursor has actually been evicted from the tail", async () => {
    // The other fallback case is a restarted run; this one is retention. The buffer is
    // deliberately small (the observed field disconnect was ~13 minutes, far past any
    // sane buffer), so this is the branch that carries the weight in practice.
    const s = await startServer();
    const port = s.boundPort();
    const first = await connect(port, "/priv");
    s.ingest({ category: "súgás", zone: "private", text: "ancient" });
    await sleep(30);
    const cursor = first.ids[0];
    first.close();
    await sleep(10);

    for (let i = 0; i < 260; i++) s.ingest({ category: "súgás", zone: "private", text: `n${i}` });
    await sleep(80);

    const again = await connect(port, "/priv", cursor);
    await sleep(50);
    expect(isFullReplay(again)).toBe(true);
    // Correct-but-partial beats silently-missing-an-unknown-span: the client gets the
    // bounded scroll history, not a claim that it is up to date.
    expect(texts(again).length).toBeGreaterThan(0);
    expect(texts(again)).not.toContain("ancient");
    again.close();
  });

  it("falls back when no cursor is presented at all (a first connect)", async () => {
    const s = await startServer();
    const port = s.boundPort();
    s.ingest({ category: "súgás", zone: "private", text: "one" });
    await sleep(20);

    const fresh = await connect(port, "/priv");
    await sleep(30);
    expect(isFullReplay(fresh)).toBe(true);
    expect(texts(fresh)).toEqual(["one"]);
    fresh.close();
  });

  it("ignores a malformed cursor rather than trusting it", async () => {
    const s = await startServer();
    const port = s.boundPort();
    s.ingest({ category: "súgás", zone: "private", text: "one" });
    await sleep(20);

    for (const bad of ["garbage", "", "::", `${"x".repeat(5)}:notanumber`]) {
      const c = await connect(port, "/priv", bad);
      await sleep(25);
      expect(isFullReplay(c)).toBe(true);
      c.close();
    }
  });

  it("does not spend resume ids on heartbeats", async () => {
    // Heartbeats arrive once a second; if they carried ids they would evict the tail
    // within seconds and pin every client's cursor to a message worth nothing on resume.
    const s = await startServer();
    const port = s.boundPort();
    const c = await connect(port, "/priv");
    s.ingest({ category: "súgás", zone: "private", text: "one" });
    await sleep(30);
    // One real broadcast → exactly one id, whatever else came down the wire.
    expect(c.ids).toHaveLength(1);
    c.close();
  });
});
