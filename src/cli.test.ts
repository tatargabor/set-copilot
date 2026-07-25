/**
 * `registerStopHook` — the idempotent settings.json merge `set-copilot init` uses to install
 * the wall-mirror Stop hook (wall-chat-mirror). It must add the hook once, no-op on a re-run,
 * preserve unrelated settings and hooks, and never clobber a malformed file.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { registerStopHook } from "./cli.js";

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
