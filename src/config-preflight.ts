/**
 * The file-facing half of config migration — the CLI's first act on every run.
 *
 * `config-migrate.ts` decides; this reads, writes, and reports. The split is the
 * same one `transcript-build` / `transcript-stitch-run` use, and for the same
 * reason: the decisions are the part worth pinning in tests.
 *
 * Two behaviours are deliberate and were chosen explicitly:
 *
 * **A migration applies itself**, backing the old file up as `<name>.bak` first.
 * The alternative — warn and wait for `set-copilot migrate` — leaves the broken
 * state in place for exactly as long as the user does not read the warning, and
 * the failure it prevents is a silent one.
 *
 * **Unparseable JSON stops the run.** Before this, `readConfigFile` threw and the
 * CLI printed a stack trace; worse, anything reading the file defensively fell
 * back to defaults, so a trailing comma could silently switch the capture's
 * language and microphone. A dictation that does not start is recoverable in
 * seconds; one that records the wrong thing is not recoverable at all.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { CONFIG_FILENAME, userConfigDir } from "./config.js";
import { migrateConfigDocs, type ConfigDoc, type MigrationNote } from "./config-migrate.js";

export interface PreflightResult {
  /** Set when the run must not continue: the message is already user-facing. */
  fatal?: string;
  notes: MigrationNote[];
  /** Files rewritten, in the order written. */
  written: string[];
}

function readDoc(role: ConfigDoc["role"], path: string): ConfigDoc | { parseError: string; path: string } {
  if (!existsSync(path)) return { role, path, data: {}, exists: false };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    // A JSON scalar or array parses fine and is not a config; treating it as one
    // would hand every later stage a shape it never guards against.
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { path, parseError: "a gyökérelem nem objektum" };
    }
    return { role, path, data: parsed as Record<string, unknown>, exists: true };
  } catch (err) {
    return { path, parseError: (err as Error).message };
  }
}

/**
 * Validate, migrate and persist the config files that participate in resolution.
 *
 * `dryRun` reports what would happen without touching disk — used by `doctor`,
 * whose whole job is to describe state rather than change it.
 */
export function runConfigPreflight(projectRoot: string = process.cwd(), opts: { dryRun?: boolean } = {}): PreflightResult {
  const userPath = join(userConfigDir(), CONFIG_FILENAME);
  const projectPath = join(resolve(projectRoot), CONFIG_FILENAME);

  const candidates: ConfigDoc["role"][] = ["user", "project"];
  const paths = { user: userPath, project: projectPath };
  const docs: ConfigDoc[] = [];

  for (const role of candidates) {
    // Running inside the user config dir itself would otherwise read one file twice
    // and let a migration move a key onto itself.
    if (role === "project" && projectPath === userPath) continue;
    const read = readDoc(role, paths[role]);
    if ("parseError" in read) {
      return {
        fatal: `${read.path}: érvénytelen JSON — ${read.parseError}\n`
          + `  A configot nem lehet betölteni, ezért a futás megáll: a default beállításokkal folytatva\n`
          + `  a felvétel más nyelven és más mikrofonnal menne, észrevétlenül. Javítsd a szintaxist.`,
        notes: [],
        written: [],
      };
    }
    docs.push(read);
  }

  const result = migrateConfigDocs(docs);
  const written: string[] = [];
  if (!opts.dryRun) {
    for (const path of result.changed) {
      const doc = result.docs.find((d) => d.path === path)!;
      // Back up before the first write, never after — a crash mid-run must not be
      // able to leave the original gone and the replacement half-written.
      if (existsSync(path)) copyFileSync(path, `${path}.bak`);
      else mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${JSON.stringify(doc.data, null, 2)}\n`);
      written.push(path);
    }
  }

  return { notes: result.notes, written };
}

/** Print a preflight result. Returns false when the caller must stop. */
export function reportPreflight(result: PreflightResult): boolean {
  if (result.fatal) {
    console.error(`[set-copilot] ${result.fatal}`);
    return false;
  }
  for (const note of result.notes) {
    console.error(`[set-copilot] config-migráció: ${note.message}`);
  }
  for (const path of result.written) {
    console.error(`[set-copilot] config frissítve: ${path} (előző állapot: ${path}.bak)`);
  }
  return true;
}
