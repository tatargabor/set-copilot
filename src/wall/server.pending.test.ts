/**
 * Pending markers over the real SSE path, after single-wall-default: the marker's default
 * zone is `both` (the visible placeholder), and its LABEL is producer text on a surface
 * that may have an audience — so a public-reaching label passes the redactor's scrutiny,
 * fail-closed. A private-only marker keeps its raw label; no redactor configured means
 * nothing to scrub against.
 */

import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { buildRegistry } from "./categories.js";
import { WallServer } from "./server.js";
import type { Pending, RedactionConfig, ResolvedWindow } from "./types.js";

const REDACTION: RedactionConfig = { patterns: ["titok"], replacement: "[…]", maxInputLength: 1_000 };
const MATCH_ALL: RedactionConfig = { patterns: [".+"], replacement: "[…]", maxInputLength: 1_000 };
const registry = buildRegistry([{ id: "narráció", label: "N", icon: "", render: "text" }]);

function windows(): ResolvedWindow[] {
  const layout = { id: "l", areas: [["p"]] };
  const box = { behavior: "scroll" as const, cats: ["narráció"], position: "p" };
  return [
    { name: "priv", route: "/priv", zones: ["private", "both"], audience: "operator", layout, boxes: [box] },
    { name: "pub", route: "/pub", zones: ["public", "both"], audience: "public", layout, boxes: [box] },
  ];
}

let server: WallServer | undefined;
afterEach(() => { server?.stop(); server = undefined; });

async function startServer(redaction: RedactionConfig | undefined): Promise<WallServer> {
  const s = new WallServer({ port: 0, windows: windows(), registry, publicDir: "/tmp", redaction, directorTickMs: 5 });
  await s.start();
  server = s;
  return s;
}

interface Sse { msgs: Pending[]; raw: string; close(): void; }
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
              try {
                const m = JSON.parse(line.slice(6));
                if ((m as { kind?: string }).kind === "pending") sse.msgs.push(m as Pending);
              } catch { /* */ }
            }
          }
        }
      });
      resolve(sse);
    });
  });
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pending = (zone: "both" | "private", label: string): Pending =>
  ({ kind: "pending", category: "narráció", zone, label, ttlMs: 5000 });

describe("pending labels pass the redactor when they reach a public client", () => {
  it("a benign both-zone label arrives as-is on the public wall", async () => {
    const s = await startServer(REDACTION);
    const pub = await connect(s.boundPort(), "/pub");
    await sleep(20);
    s.ingest(pending("both", "rajzolom: adatfolyam"));
    await sleep(30);
    expect(pub.msgs).toHaveLength(1);
    expect(pub.msgs[0].label).toBe("rajzolom: adatfolyam");
    pub.close();
  });

  it("a label matching the taxonomy is scrubbed on the wire", async () => {
    const s = await startServer(REDACTION);
    const pub = await connect(s.boundPort(), "/pub");
    await sleep(20);
    s.ingest(pending("both", "rajzolom: titok ábra"));
    await sleep(30);
    expect(pub.msgs).toHaveLength(1);
    expect(pub.msgs[0].label).toBe("rajzolom: […] ábra");
    pub.close();
  });

  it("a label the redactor withholds drops the MARKER — fail-closed, never the raw text", async () => {
    // `.+` matches everything, including its own replacement: scrubbing cannot clear it.
    // A vanished spinner is recoverable; a published label is not.
    const s = await startServer(MATCH_ALL);
    const pub = await connect(s.boundPort(), "/pub");
    await sleep(20);
    s.ingest(pending("both", "bármi"));
    await sleep(30);
    expect(pub.msgs).toHaveLength(0);
    expect(pub.raw).not.toContain("bármi");
    pub.close();
  });

  it("a private-zone marker keeps its raw label — redaction observability lives on the private view", async () => {
    const s = await startServer(REDACTION);
    const priv = await connect(s.boundPort(), "/priv");
    await sleep(20);
    s.ingest(pending("private", "rajzolom: titok ábra"));
    await sleep(30);
    expect(priv.msgs).toHaveLength(1);
    expect(priv.msgs[0].label).toContain("titok");
    priv.close();
  });

  it("without a configured redactor the label passes untouched", async () => {
    const s = await startServer(undefined);
    const pub = await connect(s.boundPort(), "/pub");
    await sleep(20);
    s.ingest(pending("both", "rajzolom: bármi"));
    await sleep(30);
    expect(pub.msgs).toHaveLength(1);
    expect(pub.msgs[0].label).toBe("rajzolom: bármi");
    pub.close();
  });
});
