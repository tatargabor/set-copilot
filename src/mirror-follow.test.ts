/**
 * The follower's pure parts: what counts as a mirrorable message, where the transcript is,
 * and who owns the runtime dir. The watch/process halves are verified by running the CLI,
 * per this repo's testing convention.
 *
 * Two tests encode the reasons the mechanism changed. A sidechain entry must not reach the
 * wall (the old `| last` never noticed subagents because it took one block per turn), and a
 * partial trailing line must be carried (a JSONL append is not atomic for a reader — the hook
 * raced exactly this and delivered the previous message instead).
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  checkMirrorPid, lastMirrorEmission, logMirror, parseMirrorables, projectSlug, resolveTranscriptPath,
} from "./mirror-follow.js";

const assistant = (uuid: string, text: string, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({
    type: "assistant", uuid, timestamp: "2026-07-30T06:00:00.000Z", isSidechain: false,
    message: { content: [{ type: "text", text }] }, ...extra,
  });

describe("parseMirrorables", () => {
  it("takes assistant text blocks in file order", () => {
    const chunk = `${assistant("a", "első")}\n${assistant("b", "második")}\n`;
    const { messages, carry } = parseMirrorables(chunk, "", 0);
    expect(messages.map((m) => m.text)).toEqual(["első", "második"]);
    expect(carry).toBe("");
  });

  it("carries a partial trailing line until its newline arrives", () => {
    const full = `${assistant("a", "egész")}\n`;
    const half = full.slice(0, 30);
    const first = parseMirrorables(half, "", 0);
    expect(first.messages).toEqual([]);
    expect(first.carry).toBe(half);

    // `baseOffset` is where THIS chunk starts — the end of the half already consumed.
    const second = parseMirrorables(full.slice(30), first.carry, Buffer.byteLength(half, "utf-8"));
    expect(second.messages.map((m) => m.text)).toEqual(["egész"]);
    expect(second.messages[0].endOffset).toBe(Buffer.byteLength(full, "utf-8"));
  });

  it("skips thinking and tool_use blocks", () => {
    const entry = JSON.stringify({
      type: "assistant", uuid: "t", timestamp: "", isSidechain: false,
      message: { content: [{ type: "thinking", thinking: "…" }, { type: "tool_use", name: "Bash" }] },
    });
    expect(parseMirrorables(`${entry}\n`, "", 0).messages).toEqual([]);
  });

  it("skips a sidechain (subagent) entry", () => {
    const chunk = `${assistant("s", "alügynök", { isSidechain: true })}\n`;
    expect(parseMirrorables(chunk, "", 0).messages).toEqual([]);
  });

  it("skips a user entry", () => {
    const chunk = `${JSON.stringify({ type: "user", message: { content: [{ type: "text", text: "hi" }] } })}\n`;
    expect(parseMirrorables(chunk, "", 0).messages).toEqual([]);
  });

  it("skips a malformed line without throwing, and still reads the next one", () => {
    const chunk = `{ not json\n${assistant("ok", "utána is működik")}\n`;
    expect(parseMirrorables(chunk, "", 0).messages.map((m) => m.text)).toEqual(["utána is működik"]);
  });

  it("counts offsets in bytes, not characters", () => {
    // A multi-byte message whose character length differs from its byte length: a character
    // count here would leave the offset mid-line and re-deliver a fragment forever.
    const line = `${assistant("é", "ékezetes ő ű szöveg a leiratban")}\n`;
    const { messages } = parseMirrorables(line, "", 0);
    expect(messages[0].endOffset).toBe(Buffer.byteLength(line, "utf-8"));
    expect(messages[0].endOffset).not.toBe(line.length);
  });
});

describe("resolveTranscriptPath", () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "sc-mirror-")); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it("prefers an explicit path", () => {
    const p = join(root, "explicit.jsonl");
    writeFileSync(p, "");
    expect(resolveTranscriptPath({ explicit: p, cwd: "/nope" })).toEqual({ ok: true, path: p, how: "explicit" });
  });

  it("reports an explicit path that does not exist", () => {
    const r = resolveTranscriptPath({ explicit: join(root, "missing.jsonl"), cwd: "/nope" });
    expect(r).toMatchObject({ ok: false });
  });

  it("finds the transcript by the slug convention", () => {
    const cwd = "~/code/set-copilot";
    const dir = join(root, projectSlug(cwd));
    mkdtempSync(join(root, "x-")); // noise
    require("node:fs").mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "sess-1.jsonl"), "");
    expect(resolveTranscriptPath({ sessionId: "sess-1", cwd, projectsRoot: root }))
      .toMatchObject({ ok: true, how: "convention" });
  });

  it("falls back to a glob when the slug does not match", () => {
    const dir = join(root, "-some-other-slug");
    require("node:fs").mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "sess-2.jsonl"), "");
    expect(resolveTranscriptPath({ sessionId: "sess-2", cwd: "/moved/elsewhere", projectsRoot: root }))
      .toMatchObject({ ok: true, how: "glob", path: join(dir, "sess-2.jsonl") });
  });

  it("names --transcript when it finds nothing", () => {
    const r = resolveTranscriptPath({ sessionId: "nope", cwd: "/x", projectsRoot: root });
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toContain("--transcript");
  });
});

describe("runtime-dir ownership and the log", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "sc-mirror-rt-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("reports a free dir", () => {
    expect(checkMirrorPid(dir)).toEqual({ state: "free" });
  });

  it("reports our own pid as live, so a second follower is refused", () => {
    writeFileSync(join(dir, "mirror.pid"), `${process.pid}\n`);
    expect(checkMirrorPid(dir)).toEqual({ state: "live", pid: process.pid });
  });

  it("reports a dead pid as stale, so the dir is reclaimed", () => {
    writeFileSync(join(dir, "mirror.pid"), "999999999\n");
    expect(checkMirrorPid(dir)).toMatchObject({ state: "stale" });
  });

  it("reports the last emission, ignoring suppressions and corrupt lines", () => {
    logMirror(dir, { decision: "emit", uuid: "a" });
    logMirror(dir, { decision: "filler", uuid: "b" });
    require("node:fs").appendFileSync(join(dir, "wall-mirror.log"), "{ corrupt\n");
    const last = lastMirrorEmission(dir);
    expect(last).toBeTruthy();
    expect(JSON.parse(require("node:fs").readFileSync(join(dir, "wall-mirror.log"), "utf-8").split("\n")[0]).ts)
      .toBe(last);
  });

  it("has no last emission before anything was emitted", () => {
    expect(lastMirrorEmission(dir)).toBeNull();
  });
});
