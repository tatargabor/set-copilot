/**
 * The live transcript page (wall-transcript): an offset cursor over the capture's
 * transcript, labelled by speaker, redacted by the wall's taxonomy, off unless a route
 * is configured.
 */

import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { buildRegistry } from "./categories.js";
import { WallServer } from "./server.js";
import type { ResolvedWindow } from "./types.js";

const registry = buildRegistry([{ id: "narráció", label: "N", icon: "🗣", render: "text" }]);
const windows: ResolvedWindow[] = [{
  name: "pub", route: "/wall", zones: ["public", "both"], audience: "public",
  layout: { id: "l", areas: [["p"]] }, boxes: [{ behavior: "scroll", cats: ["narráció"], position: "p" }],
}];
const page = { route: "/transcript", title: "Live transcript", redact: true, speakers: { mic: "ITLine", system: "Others" } };

let server: WallServer | undefined;
afterEach(() => { server?.stop(); server = undefined; });

async function start(transcript: string, opts: Partial<ConstructorParameters<typeof WallServer>[0]> = {}): Promise<number> {
  server = new WallServer({
    port: 0, windows, registry, publicDir: "/tmp", transcriptPath: transcript,
    redaction: { patterns: ["\\d+\\s?man-?days"], replacement: "[internal]", maxInputLength: 4000 },
    transcriptPage: page, ...opts,
  });
  await server.start();
  return server.boundPort();
}

async function get(port: number, path: string): Promise<{ status: number; body: any }> {
  const r = await fetch(`http://127.0.0.1:${port}${path}`);
  const text = await r.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, body };
}

function transcriptFile(): string {
  const f = join(mkdtempSync(join(tmpdir(), "wall-tr-")), "transcript.jsonl");
  writeFileSync(f, "");
  return f;
}

describe("transcript page", () => {
  it("returns labelled lines and advances an offset cursor", async () => {
    const f = transcriptFile();
    appendFileSync(f, JSON.stringify({ ts: 1000, speaker: "mic", text: "Good morning", final: true }) + "\n");
    appendFileSync(f, JSON.stringify({ ts: 2000, speaker: "system", text: "Hello", final: true }) + "\n");
    const port = await start(f);

    const first = await get(port, "/api/transcript?offset=0");
    expect(first.body.lines.map((l: any) => [l.label, l.text])).toEqual([["ITLine", "Good morning"], ["Others", "Hello"]]);
    expect(first.body.title).toBe("Live transcript");

    appendFileSync(f, JSON.stringify({ ts: 3000, speaker: "system", text: "again", final: true, cont: true }) + "\n");
    const next = await get(port, `/api/transcript?offset=${first.body.offset}&id=${encodeURIComponent(first.body.id)}`);
    expect(next.body.lines.map((l: any) => l.text)).toEqual(["again"]);
    expect(next.body.lines[0].cont).toBe(true);
  });

  it("holds back a line still being written, and skips non-final lines", async () => {
    const f = transcriptFile();
    appendFileSync(f, JSON.stringify({ ts: 1, speaker: "mic", text: "draft", final: false }) + "\n");
    appendFileSync(f, '{"ts":2,"speaker":"mic","text":"half');
    const port = await start(f);
    const r = await get(port, "/api/transcript");
    expect(r.body.lines).toEqual([]);
    appendFileSync(f, ' done","final":true}\n');
    const r2 = await get(port, `/api/transcript?offset=${r.body.offset}&id=${encodeURIComponent(r.body.id)}`);
    expect(r2.body.lines.map((l: any) => l.text)).toEqual(["half done"]);
  });

  it("redacts with the wall taxonomy unless the page turns it off", async () => {
    const f = transcriptFile();
    appendFileSync(f, JSON.stringify({ ts: 1, speaker: "mic", text: "that is 40 man-days", final: true }) + "\n");
    let port = await start(f);
    expect((await get(port, "/api/transcript")).body.lines[0].text).toBe("that is [internal]");
    server!.stop();
    port = await start(f, { transcriptPage: { ...page, redact: false } });
    expect((await get(port, "/api/transcript")).body.lines[0].text).toBe("that is 40 man-days");
  });

  it("starts over when the cursor names another file", async () => {
    const f = transcriptFile();
    appendFileSync(f, JSON.stringify({ ts: 1, speaker: "mic", text: "one", final: true }) + "\n");
    const port = await start(f);
    const r = await get(port, `/api/transcript?offset=5&id=${encodeURIComponent("/elsewhere:1")}`);
    expect(r.body.lines.map((l: any) => l.text)).toEqual(["one"]);
  });

  it("is not served when no route is configured", async () => {
    const f = transcriptFile();
    const port = await start(f, { transcriptPage: { ...page, route: null } });
    expect((await get(port, "/api/transcript")).status).toBe(404);
  });
});
