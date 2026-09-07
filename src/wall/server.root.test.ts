/**
 * The root path reaches the wall (single-wall-default): with the shipped default serving
 * one window on `/wall`, a bare request for `/` must redirect there — a page served at a
 * route with no window would bootstrap-fail, since the client derives its route from the
 * pathname. A project window declared AT `/` is served directly, never redirected.
 */

import http from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { buildRegistry } from "./categories.js";
import { WallServer } from "./server.js";
import type { ResolvedWindow } from "./types.js";

const registry = buildRegistry([{ id: "narráció", label: "N", icon: "", render: "text" }]);
const layout = { id: "l", areas: [["p"]] };
const box = { behavior: "scroll" as const, cats: ["narráció"], position: "p" };

function windowAt(route: string): ResolvedWindow {
  return { name: "fal", route, zones: ["public", "both"], audience: "public", layout, boxes: [box] };
}

let server: WallServer | undefined;
afterEach(() => { server?.stop(); server = undefined; });

async function start(windows: ResolvedWindow[], publicDir = "/tmp"): Promise<WallServer> {
  const s = new WallServer({ port: 0, windows, registry, publicDir, directorTickMs: 5 });
  await s.start();
  server = s;
  return s;
}

function get(port: number, path: string): Promise<{ status?: number; location?: string }> {
  return new Promise((resolve) => {
    http.get({ host: "127.0.0.1", port, path }, (res) => {
      resolve({ status: res.statusCode, location: res.headers.location });
      res.destroy();
    });
  });
}

describe("the root path reaches the wall", () => {
  it("redirects / to the single declared window route", async () => {
    const s = await start([windowAt("/wall")]);
    const r = await get(s.boundPort(), "/");
    expect(r.status).toBe(302);
    expect(r.location).toBe("/wall");
  });

  it("redirects / to the first declared route even with several windows", async () => {
    const s = await start([windowAt("/wall"), windowAt("/masik")]);
    const r = await get(s.boundPort(), "/");
    expect(r.status).toBe(302);
    expect(r.location).toBe("/wall");
  });

  it("serves — never redirects — a window that is declared at /", async () => {
    // A real index.html so "served" is observable as 200 rather than the 404 the /tmp
    // publicDir would give.
    const dir = mkdtempSync(join(tmpdir(), "wall-root-"));
    writeFileSync(join(dir, "index.html"), "<!doctype html><title>wall</title>");
    const s = await start([windowAt("/")], dir);
    const r = await get(s.boundPort(), "/");
    expect(r.status).toBe(200);
    expect(r.location).toBeUndefined();
  });
});
