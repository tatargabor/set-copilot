/**
 * Liveness heartbeat + pending placeholder over the real SSE path (wall-liveness /
 * wall-pending-indicator). The heartbeat must be server-derived (from the runtime dir),
 * refuse injection, and reach a fresh client at once; a pending marker must route by
 * zone and never become replayable state.
 */

import http from "node:http";
import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
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
    { name: "priv", route: "/priv", zones: ["private", "both"], audience: "operator", layout, boxes: [box] },
    { name: "pub", route: "/pub", zones: ["public", "both"], audience: "public", layout, boxes: [box] },
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

  // ---- per-channel activity (wall-viewport-and-activity D5) ----

  interface ChannelHb {
    lastHeardMsAgo: number | null;
    channels?: { mic: { present: boolean; lastHeardMsAgo: number | null }; system: { present: boolean; lastHeardMsAgo: number | null } };
  }
  const lastHb = (c: Sse) => heartbeats(c).at(-1) as ChannelHb;

  /** A runtime dir whose capture writes `name`, with the given transcript lines. */
  function dirWriting(name: string, lines: string[]): { dir: string; path: string } {
    const dir = mkdtempSync(join(tmpdir(), "wall-chan-"));
    writeFileSync(join(dir, "capture.pid"), String(process.pid));
    const path = join(dir, name);
    writeFileSync(path, lines.map((l) => `${l}\n`).join(""));
    writeFileSync(join(dir, "capture.output"), path);
    return { dir, path };
  }
  const tline = (ts: number, speaker: "mic" | "system") => JSON.stringify({ ts, speaker, text: "…", final: true });

  it("carries per-channel activity derived from the transcript, both channels present", async () => {
    const { dir, path } = dirWriting("transcript.jsonl", [tline(0, "system"), tline(30_000, "mic")]);
    const s = await startServer({ runtimeDir: dir, transcriptPath: path, dictationPath: join(dir, "dictation.jsonl") });
    const c = await connect(s.boundPort(), "/priv");
    await sleep(60);

    const hb = lastHb(c);
    expect(hb.channels).toBeDefined();
    expect(hb.channels!.mic.present).toBe(true);
    expect(hb.channels!.system.present).toBe(true);
    // The mic spoke last, so it is the fresher of the two by the 30s gap in the transcript.
    expect(hb.channels!.system.lastHeardMsAgo! - hb.channels!.mic.lastHeardMsAgo!).toBeGreaterThanOrEqual(29_000);
    c.close();
  });

  it("reports the system channel ABSENT for a mic-only capture", async () => {
    // The capture records which file it writes; a dictation output is what makes this a
    // one-channel run. Absent must not read as "captured but quiet".
    const { dir, path } = dirWriting("dictation.jsonl", [tline(0, "mic"), tline(1000, "mic")]);
    const s = await startServer({ runtimeDir: dir, transcriptPath: join(dir, "transcript.jsonl"), dictationPath: path });
    const c = await connect(s.boundPort(), "/priv");
    await sleep(60);

    const hb = lastHb(c);
    expect(hb.channels!.system).toEqual({ present: false, lastHeardMsAgo: null });
    expect(hb.channels!.mic.present).toBe(true);
    expect(typeof hb.channels!.mic.lastHeardMsAgo).toBe("number");
    c.close();
  });

  it("follows the capture's OWN output file, not the configured meeting path", async () => {
    // During a dictation run the configured meeting transcript is a stale file from another
    // session; ageing off it would report a "last heard" from a meeting that ended hours ago.
    const { dir, path } = dirWriting("dictation.jsonl", [tline(0, "mic")]);
    const stale = join(dir, "transcript.jsonl");
    writeFileSync(stale, `${tline(0, "mic")}\n`);
    // Backdate the stale meeting transcript by an hour.
    const old = Date.now() - 3_600_000;
    utimesSync(stale, old / 1000, old / 1000);

    const s = await startServer({ runtimeDir: dir, transcriptPath: stale, dictationPath: path });
    const c = await connect(s.boundPort(), "/priv");
    await sleep(60);
    expect(lastHb(c).lastHeardMsAgo).toBeLessThan(60_000);
    c.close();
  });

  it("still rejects an injected heartbeat now that it carries more", async () => {
    const { dir } = runtimeDirWithCapture();
    const s = await startServer({ runtimeDir: dir, heartbeatMs: 100_000 });
    const c = await connect(s.boundPort(), "/priv");
    await sleep(20);
    const before = heartbeats(c).length;
    s.ingest({
      kind: "heartbeat", captureAlive: true, lastHeardMsAgo: 0,
      channels: { mic: { present: true, lastHeardMsAgo: 0 }, system: { present: true, lastHeardMsAgo: 0 } },
    } as WireMessage);
    await sleep(20);
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
