/**
 * The category registry — the single display primitive resolved at startup.
 *
 * Categories are data: they come from `wall.categories` in config, optionally
 * augmented by a `categories.mjs` module (default-exporting `(ctx) => Category[]`),
 * mirroring the `knowledge.adapter` seam. Invalid entries are dropped with a
 * warning rather than crashing the wall — the same forgiving posture as a bad
 * `detect.*` regex or a malformed alert.
 */

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { CopilotConfig } from "../config.js";
import type { Category, RenderType } from "./types.js";

const RENDER_TYPES: RenderType[] = ["text", "graph", "chart"];

/** A resolved registry: id → category, with a couple of routing conveniences. */
export interface CategoryRegistry {
  byId: Map<string, Category>;
  has(id: string): boolean;
  get(id: string): Category | undefined;
  list(): Category[];
}

/**
 * Validate one raw category. Returns the typed Category or null (with a reason
 * on the console) so a single bad entry never takes the registry down.
 */
export function validateCategory(raw: unknown, warn: (msg: string) => void = console.warn): Category | null {
  if (!raw || typeof raw !== "object") {
    warn(`[set-copilot] wall: dropping non-object category entry`);
    return null;
  }
  const c = raw as Partial<Category>;
  if (typeof c.id !== "string" || !c.id) {
    warn(`[set-copilot] wall: dropping category with missing id`);
    return null;
  }
  if (typeof c.render !== "string" || !RENDER_TYPES.includes(c.render as RenderType)) {
    warn(`[set-copilot] wall: dropping category "${c.id}" — render must be one of ${RENDER_TYPES.join(", ")}`);
    return null;
  }
  return {
    id: c.id,
    label: typeof c.label === "string" && c.label ? c.label : c.id,
    icon: typeof c.icon === "string" ? c.icon : "",
    render: c.render as RenderType,
  };
}

/** Build a registry from an already-validated (or raw) list, dropping the bad ones. */
export function buildRegistry(raw: unknown[], warn?: (msg: string) => void): CategoryRegistry {
  const byId = new Map<string, Category>();
  for (const entry of raw) {
    const cat = validateCategory(entry, warn);
    if (!cat) continue;
    if (byId.has(cat.id)) {
      (warn ?? console.warn)(`[set-copilot] wall: duplicate category "${cat.id}" — keeping the first`);
      continue;
    }
    byId.set(cat.id, cat);
  }
  return {
    byId,
    has: (id) => byId.has(id),
    get: (id) => byId.get(id),
    list: () => [...byId.values()],
  };
}

/**
 * Resolve the effective category registry for a run: the config list, then any
 * categories a `categories.mjs` module contributes (module entries win on id
 * collision — the code module is the more specific source, like a custom adapter).
 */
export async function resolveCategories(cfg: CopilotConfig): Promise<CategoryRegistry> {
  const fromConfig = cfg.wall.categories ?? [];
  let fromModule: unknown[] = [];

  const spec = cfg.wall.categoriesModule;
  if (spec) {
    const modPath = resolve(cfg.projectRoot, spec);
    const mod = (await import(pathToFileURL(modPath).href)) as {
      default?: (ctx: { projectRoot: string }) => Category[] | Promise<Category[]>;
    };
    if (typeof mod.default !== "function") {
      throw new Error(`[set-copilot] wall.categoriesModule "${spec}" must default-export a (ctx) => Category[] factory`);
    }
    fromModule = await mod.default({ projectRoot: cfg.projectRoot });
  }

  // Module entries appended last so buildRegistry's first-wins is inverted for
  // them: dedup by id up front, module winning, then build.
  const merged = new Map<string, unknown>();
  for (const c of fromConfig) {
    const v = validateCategory(c);
    if (v) merged.set(v.id, c);
  }
  for (const c of fromModule) {
    const v = validateCategory(c);
    if (v) merged.set(v.id, c); // override config on id collision
  }
  return buildRegistry([...merged.values()]);
}
