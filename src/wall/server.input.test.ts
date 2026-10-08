/**
 * POST /api/input over the real server (wall-input-to-session). The contract: validate,
 * append ONE JSONL line to the viewer seam, answer 204 — and never broadcast anything to
 * wall clients. Every failure mode answers with a status, never a silent drop.
 */

import http from "node:http";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { buildRegistry } from "./categories.js";
import { WallServer } from "./server.js";
import type { ResolvedWindow } from "./types.js";

const registry = buildRegistry([{ id: "narráció", label: "N", icon: "", render: "text" }]);
const layout = { id: "l", areas: [["p"]] };
const box = { behavior: "scroll" as const, cats: ["narráció"], position: "p" };
const windows = (): ResolvedWindow[] => [
  { name: "fal", route: "/wall", zones: ["public", "both"], audience: "public", layout, boxes: [box] },
];

let server: WallServer | undefined;
afterEach(() => { server?.stop(); server = undefined; });

async function start(opts: Partial<ConstructorParameters<typeof WallServer>[0]> = {}): Promise<WallServer> {
  const s = new WallServer({ port: 0, windows: windows(), registry, publicDir: "/tmp", directorTickMs: 5, ...opts });
  await s.start();
  server = s;
  return s;
}

function post(port: number, body: string, method = "POST"): Promise<{ status?: number }> {
  return new Promise((resolve) => {
    const req = http.request({ host: "127.0.0.1", port, path: "/api/input", method }, (res) => {
      res.resume();
      res.on("end", () => resolve({ status: res.statusCode }));
    });
    req.end(body);
  });
}

const lines = (file: string): string[] =>
  existsSync(file) ? readFileSync(file, "utf-8").split("\n").filter(Boolean) : [];

describe("POST /api/input — the viewer seam", () => {
  it("appends one JSON line carrying ts, route, and the text", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wall-input-"));
    const file = join(dir, "input.jsonl");
    const s = await start({ inputPath: file });
    const r = await post(s.boundPort(), JSON.stringify({ text: "rajzold újra a gráfot" }));
    expect(r.status).toBe(204);
    const all = lines(file);
    expect(all).toHaveLength(1);
    const o = JSON.parse(all[0]) as { ts: number; route: string; text: string };
    expect(o.text).toBe("rajzold újra a gráfot");
    expect(o.route).toBe("/wall");
    expect(Number.isFinite(o.ts)).toBe(true);
  });

  it("appends a second send as a second line — a repeated instruction is a repeated instruction", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wall-input-"));
    const file = join(dir, "input.jsonl");
    const s = await start({ inputPath: file });
    await post(s.boundPort(), JSON.stringify({ text: "ugyanaz" }));
    await post(s.boundPort(), JSON.stringify({ text: "ugyanaz" }));
    expect(lines(file)).toHaveLength(2);
  });

  it("answers 405 on GET without appending", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wall-input-"));
    const file = join(dir, "input.jsonl");
    const s = await start({ inputPath: file });
    const r = await new Promise<{ status?: number }>((resolve) => {
      http.get({ host: "127.0.0.1", port: s.boundPort(), path: "/api/input" }, (res) => {
        res.resume();
        res.on("end", () => resolve({ status: res.statusCode }));
      });
    });
    expect(r.status).toBe(405);
    expect(lines(file)).toHaveLength(0);
  });

  it("answers 400 on a control character and on an empty text", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wall-input-"));
    const file = join(dir, "input.jsonl");
    const s = await start({ inputPath: file });
    expect((await post(s.boundPort(), JSON.stringify({ text: "két\nsor" }))).status).toBe(400);
    expect((await post(s.boundPort(), JSON.stringify({ text: "   " }))).status).toBe(400);
    expect((await post(s.boundPort(), "not json")).status).toBe(400);
    expect(lines(file)).toHaveLength(0);
  });

  it("answers 413 on an oversized body without parsing it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wall-input-"));
    const file = join(dir, "input.jsonl");
    const s = await start({ inputPath: file });
    const big = JSON.stringify({ text: "x".repeat(5000) });
    expect((await post(s.boundPort(), big)).status).toBe(413);
    expect(lines(file)).toHaveLength(0);
  });

  it("answers 503 with neither a runtime dir nor an injected path", async () => {
    const s = await start();
    const r = await post(s.boundPort(), JSON.stringify({ text: "bármi" }));
    expect(r.status).toBe(503);
  });
});
