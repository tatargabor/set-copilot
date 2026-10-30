/**
 * The default-target stand-down policy (default-target-stands-down-on-public), pure over
 * injected I/O: host parsing and matching, the visibility cache, and the decision itself.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CopilotConfig } from "./config.js";
import {
  defaultHandoverSuppressed, hostIsPublic, loadVisibilityMarks, parseRemoteHost, repoVisibilityCachePath,
  type PolicyIo,
} from "./recording-store.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "sc-policy-home-"));
  process.env.SET_COPILOT_HOME = home;
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(home, { recursive: true, force: true });
  delete process.env.SET_COPILOT_HOME;
});

const cfg = (defaultHandover?: string): CopilotConfig =>
  ({ copilot: { defaultHandover } } as unknown as CopilotConfig);
const io = (urls: string[], marks: Record<string, string> = {}): PolicyIo => ({
  remoteUrls: () => urls,
  visibilityMarks: () => marks,
});
const top = "/repos/some-project"; // fictional — the I/O is injected, nothing reads it

describe("parseRemoteHost", () => {
  it("reads every URL form a git remote takes", () => {
    expect(parseRemoteHost("git@github.com:owner/repo.git")).toBe("github.com");
    expect(parseRemoteHost("https://github.com/owner/repo.git")).toBe("github.com");
    expect(parseRemoteHost("ssh://git@git.sr.ht:2222/~user/repo.git")).toBe("git.sr.ht");
    expect(parseRemoteHost("https://user:token@gitlab.example.hu/owner/repo.git")).toBe("gitlab.example.hu");
    expect(parseRemoteHost("/srv/git/repo")).toBeNull();
    expect(parseRemoteHost("file:///srv/git/repo")).toBeNull();
  });
});

describe("hostIsPublic", () => {
  it("matches equal or subdomain, never a lookalike suffix", () => {
    expect(hostIsPublic("github.com")).toBe(true);
    expect(hostIsPublic("git.sr.ht")).toBe(true); // no sourcehut remote ever appears at the apex
    expect(hostIsPublic("gist.github.com")).toBe(true);
    expect(hostIsPublic("github.company.com")).toBe(false); // a different apex (company.com), not a subdomain
    expect(hostIsPublic("notgithub.com")).toBe(false);
    expect(hostIsPublic("github.com.evil.test")).toBe(false);
    expect(hostIsPublic("git.example.hu")).toBe(false);
  });
});

describe("defaultHandoverSuppressed", () => {
  it("a public-host remote suppresses, naming the host", () => {
    expect(defaultHandoverSuppressed(cfg(), top, io(["git@github.com:owner/repo.git (fetch)"])))
      .toBe("public remote: github.com");
  });

  it("a private mark on a public host keeps the default", () => {
    expect(defaultHandoverSuppressed(cfg(), top, io(["git@github.com:owner/repo.git"], { [top]: "private" })))
      .toBeUndefined();
  });

  it("the canonical top matches the mark behind a symlink spelling", () => {
    const real = mkdtempSync(join(tmpdir(), "sc-policy-real-"));
    try {
      expect(defaultHandoverSuppressed(cfg(), real, io(["git@github.com:o/r"], { [real]: "private" })))
        .toBeUndefined();
      // An unknown top is still suppressed.
      expect(defaultHandoverSuppressed(cfg(), real, io(["git@github.com:o/r"], { [`${real}-other`]: "private" })))
        .toBe("public remote: github.com");
    } finally {
      rmSync(real, { recursive: true, force: true });
    }
  });

  it("no remote, or a non-public host, keeps the default", () => {
    expect(defaultHandoverSuppressed(cfg(), top, io([]))).toBeUndefined();
    expect(defaultHandoverSuppressed(cfg(), top, io(["git@git.example.hu:owner/repo.git"]))).toBeUndefined();
  });

  it('"on" forces the copy and "off" forces the stand-down, whatever the remotes say', () => {
    const urls = ["git@github.com:owner/repo.git"];
    expect(defaultHandoverSuppressed(cfg("on"), top, io(urls, { [top]: "private" }))).toBeUndefined();
    expect(defaultHandoverSuppressed(cfg("off"), top, io([]))).toBe('copilot.defaultHandover: "off"');
  });
});

describe("loadVisibilityMarks", () => {
  it("reads marks, ignores non-string values, and reads corrupt as empty", () => {
    mkdirSync(home, { recursive: true });
    writeFileSync(repoVisibilityCachePath(), JSON.stringify({ [top]: "private", stray: 3 }));
    expect(loadVisibilityMarks()).toEqual({ [top]: "private" });

    writeFileSync(repoVisibilityCachePath(), "{not json");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(loadVisibilityMarks()).toEqual({});
    warn.mockRestore();

    writeFileSync(repoVisibilityCachePath(), JSON.stringify([top]));
    expect(loadVisibilityMarks()).toEqual({});

    // Absent file: no marks, no warning.
    rmSync(repoVisibilityCachePath());
    expect(loadVisibilityMarks()).toEqual({});
  });

  it("the cache lives beside the user config, under SET_COPILOT_HOME", () => {
    expect(repoVisibilityCachePath()).toBe(join(resolve(home), "repo-visibility.json"));
  });
});
