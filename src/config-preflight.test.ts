/**
 * The preflight's file behaviour: what it refuses to run on, and what it leaves
 * on disk after rewriting a config the user did not ask it to touch.
 *
 * The backup is the load-bearing part. An automatic rewrite is only defensible
 * if the previous state is one `mv` away, so "a `.bak` exists and still holds
 * the original" is asserted, not assumed.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CONFIG_FILENAME } from "./config.js";
import { CONFIG_VERSION } from "./config-migrate.js";
import { runConfigPreflight } from "./config-preflight.js";

let userHome: string;
let project: string;

beforeEach(() => {
  userHome = mkdtempSync(join(tmpdir(), "sc-home-"));
  project = mkdtempSync(join(tmpdir(), "sc-proj-"));
  process.env.SET_COPILOT_HOME = userHome;
});

afterEach(() => {
  rmSync(userHome, { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
  delete process.env.SET_COPILOT_HOME;
});

const cfgPath = (dir: string) => join(dir, CONFIG_FILENAME);
const write = (dir: string, raw: string) => writeFileSync(cfgPath(dir), raw);
const read = (path: string) => JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;

describe("runConfigPreflight — invalid JSON", () => {
  it("refuses to continue, naming the file and the reason", () => {
    write(project, '{ "language": "hu", }');
    const result = runConfigPreflight(project);
    expect(result.fatal).toContain(cfgPath(project));
    expect(result.written).toEqual([]);
  });

  it("rejects a JSON scalar or array — it parses, but it is not a config", () => {
    write(project, '["hu"]');
    expect(runConfigPreflight(project).fatal).toContain("nem objektum");
  });

  it("does not rewrite anything while a file is unreadable", () => {
    // The user config needs migrating, but the project file is broken. Migrating
    // half a set against a document we could not read is how a "fix" loses data.
    writeFileSync(cfgPath(userHome), JSON.stringify({ audio: { micSource: "mic-a" } }));
    write(project, "{oops");
    const result = runConfigPreflight(project);
    expect(result.fatal).toBeTruthy();
    expect(read(cfgPath(userHome))).toEqual({ audio: { micSource: "mic-a" } });
  });
});

describe("runConfigPreflight — migration", () => {
  it("rewrites the project config and backs the original up verbatim", () => {
    const original = JSON.stringify({ audio: { micSource: "alsa_input.usb-x", sampleRate: 16000 } }, null, 2);
    write(project, original);

    const result = runConfigPreflight(project);
    expect(result.fatal).toBeUndefined();
    expect(result.written).toContain(cfgPath(project));

    expect(read(cfgPath(project))).toEqual({ audio: { sampleRate: 16000 }, configVersion: CONFIG_VERSION });
    expect(readFileSync(`${cfgPath(project)}.bak`, "utf-8")).toBe(original);
  });

  it("creates the machine config the moved device needs, and only then", () => {
    write(project, JSON.stringify({ audio: { micSource: "mic-x" } }));
    runConfigPreflight(project);
    expect(read(cfgPath(userHome)).audio).toEqual({ micSource: "mic-x" });
  });

  it("is idempotent — a second run writes nothing and leaves no new backup", () => {
    write(project, JSON.stringify({ audio: { micSource: "mic-x" } }));
    runConfigPreflight(project);
    const after = readFileSync(cfgPath(project), "utf-8");

    const second = runConfigPreflight(project);
    expect(second.written).toEqual([]);
    expect(second.notes).toEqual([]);
    expect(readFileSync(cfgPath(project), "utf-8")).toBe(after);
  });

  it("dryRun reports the same decisions without touching disk", () => {
    const original = JSON.stringify({ audio: { micSource: "mic-x" } });
    write(project, original);
    const result = runConfigPreflight(project, { dryRun: true });
    expect(result.notes.length).toBeGreaterThan(0);
    expect(result.written).toEqual([]);
    expect(readFileSync(cfgPath(project), "utf-8")).toBe(original);
  });

  it("does nothing at all when no config file exists", () => {
    const result = runConfigPreflight(project);
    expect(result).toEqual({ notes: [], written: [] });
  });
});
