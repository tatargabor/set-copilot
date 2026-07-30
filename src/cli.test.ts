/**
 * The two idempotent settings.json edits `set-copilot init` performs.
 *
 * `registerStopHook` installs a Stop hook (the recovery guard, today); it must add it once,
 * no-op on a re-run, preserve unrelated settings and hooks, and never clobber a malformed file.
 *
 * `unregisterStopHook` REMOVES the retired wall-mirror hook (wall-mirror-follower). A stale
 * registration is not cosmetic: with the follower running, a surviving mirror hook would emit
 * every line twice — so removal has to be as careful as installation was.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { registerStopHook, unregisterStopHook } from "./cli.js";

let dir: string;
let settings: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sc-hook-"));
  settings = join(dir, "settings.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const CMD = 'bash "$CLAUDE_PROJECT_DIR/.claude/hooks/wall-mirror.sh"';
const read = () => JSON.parse(readFileSync(settings, "utf-8"));

describe("registerStopHook", () => {
  it("creates settings.json with the Stop hook when none exists", () => {
    expect(registerStopHook(settings, CMD)).toBe(true);
    const s = read();
    expect(s.hooks.Stop[0].hooks[0].command).toBe(CMD);
    expect(s.hooks.Stop[0].matcher).toBe("");
  });

  it("is idempotent — a second run does not duplicate the hook", () => {
    expect(registerStopHook(settings, CMD)).toBe(true);
    expect(registerStopHook(settings, CMD)).toBe(false);
    const commands = read().hooks.Stop.flatMap((g: { hooks: { command: string }[] }) => g.hooks.map((h) => h.command));
    expect(commands.filter((c: string) => c === CMD)).toHaveLength(1);
  });

  it("preserves unrelated settings and pre-existing Stop hooks", () => {
    writeFileSync(settings, JSON.stringify({
      model: "opus",
      hooks: { Stop: [{ matcher: "", hooks: [{ type: "command", command: "existing-hook" }] }] },
    }));
    expect(registerStopHook(settings, CMD)).toBe(true);
    const s = read();
    expect(s.model).toBe("opus");
    const commands = s.hooks.Stop.flatMap((g: { hooks: { command: string }[] }) => g.hooks.map((h) => h.command));
    expect(commands).toContain("existing-hook");
    expect(commands).toContain(CMD);
  });

  it("leaves a malformed settings.json untouched", () => {
    writeFileSync(settings, "{ not json");
    expect(registerStopHook(settings, CMD)).toBe(false);
    expect(readFileSync(settings, "utf-8")).toBe("{ not json");
  });
});

describe("unregisterStopHook", () => {
  const others = [
    { type: "command", command: 'bash "$CLAUDE_PROJECT_DIR/.claude/hooks/recovery-guard.sh"' },
    { type: "command", command: "some-other-hook" },
  ];

  it("removes the mirror hook and leaves every other hook alone", () => {
    writeFileSync(settings, JSON.stringify({
      model: "opus",
      hooks: { Stop: [{ matcher: "", hooks: [{ type: "command", command: CMD }, ...others] }] },
    }));
    expect(unregisterStopHook(settings, "wall-mirror.sh")).toBe(true);
    const s = read();
    expect(s.model).toBe("opus");
    const commands = s.hooks.Stop.flatMap((g: { hooks: { command: string }[] }) => g.hooks.map((h) => h.command));
    expect(commands).toEqual(others.map((h) => h.command));
  });

  it("matches by basename, so a global install is removed too", () => {
    writeFileSync(settings, JSON.stringify({
      hooks: { Stop: [{ matcher: "", hooks: [{ type: "command", command: 'bash "/home/u/.claude/hooks/wall-mirror.sh"' }] }] },
    }));
    expect(unregisterStopHook(settings, "wall-mirror.sh")).toBe(true);
    expect(read().hooks.Stop).toEqual([]);
  });

  it("drops a group only when removal emptied it", () => {
    writeFileSync(settings, JSON.stringify({
      hooks: {
        Stop: [
          { matcher: "", hooks: [{ type: "command", command: CMD }] },
          { matcher: "x", hooks: [others[0]] },
        ],
      },
    }));
    expect(unregisterStopHook(settings, "wall-mirror.sh")).toBe(true);
    const stop = read().hooks.Stop;
    expect(stop).toHaveLength(1);
    expect(stop[0].matcher).toBe("x");
  });

  it("is a no-op on a second run, and when nothing matches", () => {
    writeFileSync(settings, JSON.stringify({
      hooks: { Stop: [{ matcher: "", hooks: [{ type: "command", command: CMD }] }] },
    }));
    expect(unregisterStopHook(settings, "wall-mirror.sh")).toBe(true);
    expect(unregisterStopHook(settings, "wall-mirror.sh")).toBe(false);
  });

  it("leaves a malformed settings.json untouched", () => {
    writeFileSync(settings, "{ not json");
    expect(unregisterStopHook(settings, "wall-mirror.sh")).toBe(false);
    expect(readFileSync(settings, "utf-8")).toBe("{ not json");
  });

  it("does nothing when there is no settings.json at all", () => {
    expect(unregisterStopHook(join(dir, "absent.json"), "wall-mirror.sh")).toBe(false);
  });
});
