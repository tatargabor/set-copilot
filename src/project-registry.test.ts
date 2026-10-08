import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  canonicalProjectPath, discoverProjects, emptyRegistry, expandScanRoots, loadRegistry,
  lookupProjects, mergeDiscovered, readClaudeHistoryProjects, saveRegistry, scanGitRoots,
  touchProject, upsertProject, nodeDiscoveryFs, type DiscoveryFs, type ProjectRegistry,
} from "./project-registry.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "set-copilot-reg-"));
  process.env.SET_COPILOT_HOME = home;
});

afterEach(() => {
  delete process.env.SET_COPILOT_HOME;
  rmSync(home, { recursive: true, force: true });
});

function writeRegistry(reg: ProjectRegistry): void {
  saveRegistry(reg);
}

describe("registry persistence", () => {
  it("round-trips a record through the file", () => {
    const reg = emptyRegistry();
    const dir = mkdtempSync(join(tmpdir(), "proj-"));
    const { record, created } = upsertProject(reg, dir);
    expect(created).toBe(true);
    expect(record.name).not.toBe("");
    writeRegistry(reg);

    const reloaded = loadRegistry();
    expect(reloaded.projects).toHaveLength(1);
    expect(reloaded.projects[0].path).toBe(canonicalProjectPath(dir));
    expect(reloaded.projects[0].lastUsedAt).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });

  it("collapses a non-canonical spelling onto the one record", () => {
    const dir = mkdtempSync(join(tmpdir(), "proj-"));
    mkdirSync(join(dir, "sub"));
    const reg = emptyRegistry();
    upsertProject(reg, dir);
    const { created } = upsertProject(reg, join(dir, "sub", ".."));
    expect(created).toBe(false);
    expect(reg.projects).toHaveLength(1);
    rmSync(dir, { recursive: true, force: true });
  });

  it("re-add with a name updates the existing record", () => {
    const dir = mkdtempSync(join(tmpdir(), "proj-"));
    const reg = emptyRegistry();
    upsertProject(reg, dir);
    const { record, created } = upsertProject(reg, dir, "renamed");
    expect(created).toBe(false);
    expect(record.name).toBe("renamed");
    expect(reg.projects).toHaveLength(1);
    rmSync(dir, { recursive: true, force: true });
  });

  it("degrades to empty with a warning on a corrupt file", () => {
    writeFileSync(join(home, "projects.json"), "{ not json");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const reg = loadRegistry();
    expect(reg.projects).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("treats a missing registry file as empty, silently", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(loadRegistry().projects).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("registry lookups", () => {
  let dirA: string;
  let dirB: string;
  let reg: ProjectRegistry;

  beforeEach(() => {
    dirA = mkdtempSync(join(tmpdir(), "alpha-"));
    dirB = mkdtempSync(join(tmpdir(), "beta-"));
    reg = emptyRegistry();
    upsertProject(reg, dirA, "app");
    upsertProject(reg, dirB);
  });

  afterEach(() => {
    rmSync(dirA, { recursive: true, force: true });
    rmSync(dirB, { recursive: true, force: true });
  });

  it("finds by display name and by path", () => {
    expect(lookupProjects(reg, "app")).toHaveLength(1);
    expect(lookupProjects(reg, dirB)).toHaveLength(1);
    expect(lookupProjects(reg, "nope")).toHaveLength(0);
  });

  it("reports ambiguity when a name is taken twice", () => {
    upsertProject(reg, dirB, "app");
    expect(lookupProjects(reg, "app")).toHaveLength(2);
  });

  it("touchProject stamps only registered paths", () => {
    expect(touchProject(reg, dirA)).toBe(true);
    expect(reg.projects[0].lastUsedAt).not.toBeNull();
    expect(touchProject(reg, "/nonexistent/project")).toBe(false);
  });
});

// ---- discovery -------------------------------------------------------------

/** In-memory fs over a nested literal tree: { "name": {...} } dirs vs "blob" strings. */
function fakeFs(tree: Record<string, unknown>, mtimes: Record<string, number> = {}): DiscoveryFs {
  function isDir(path: string): boolean {
    let node: unknown = tree;
    for (const part of path.split("/").filter(Boolean)) {
      if (!node || typeof node !== "object" || !(part in (node as Record<string, unknown>))) return false;
      node = (node as Record<string, unknown>)[part];
    }
    return typeof node === "object" && node !== null;
  }
  function isFile(path: string): boolean {
    const parent = path.split("/").slice(0, -1).join("/");
    const name = path.split("/").at(-1)!;
    let node: unknown = tree;
    for (const part of parent.split("/").filter(Boolean)) {
      if (!node || typeof node !== "object" || !(part in (node as Record<string, unknown>))) return false;
      node = (node as Record<string, unknown>)[part];
    }
    return typeof node === "object" && node !== null && name in (node as Record<string, unknown>) &&
      typeof (node as Record<string, unknown>)[name] === "string";
  }
  return {
    listDir: (dir) => {
      let node: unknown = tree;
      for (const part of dir.split("/").filter(Boolean)) {
        node = (node as Record<string, unknown>)?.[part];
      }
      return Object.keys(node as Record<string, unknown>);
    },
    isDirectory: isDir,
    isFile,
    mtimeMs: (p) => mtimes[p] ?? 0,
    readFileHead: (p, maxBytes) => {
      const parent = p.split("/").slice(0, -1).join("/");
      const name = p.split("/").at(-1)!;
      let node: unknown = tree;
      for (const part of parent.split("/").filter(Boolean)) node = (node as Record<string, unknown>)?.[part];
      const content = (node as Record<string, unknown>)?.[name];
      return typeof content === "string" ? content.slice(0, maxBytes) : "";
    },
  };
}

describe("scanGitRoots", () => {
  it("finds git roots, pruning hidden dirs and node_modules, honouring the depth cap", () => {
    const tree = {
      r: {
        code: {
          a: { ".git": "", app: {} },
          b: { node_modules: { x: { ".git": "" } } },
          ".hidden": { c: { ".git": "" } },
          d: { e: { f: { ".git": "", deeper: { g: { ".git": "" } } } } },
        },
      },
    };
    const fs = fakeFs(tree);
    const found = scanGitRoots("/r/code", 3, fs);
    expect(found).toContain("/r/code/a");
    expect(found).toContain("/r/code/d/e/f");
    expect(found).not.toContain("/r/code/b/node_modules/x");
    expect(found).not.toContain("/r/code/.hidden/c");
    // depth 3 from /r/code reaches a·b·f; f/deeper/g is one past it
    expect(found).not.toContain("/r/code/d/e/f/deeper/g");
  });

  it("stops inside a found project instead of descending into nested repos", () => {
    const tree = { r: { a: { ".git": "", nested: { b: { ".git": "" } } } } };
    expect(scanGitRoots("/r", 3, fakeFs(tree))).toEqual(["/r/a"]);
  });
});

describe("readClaudeHistoryProjects", () => {
  it("extracts cwd from the newest session file and drops vanished/blank entries", () => {
    const tree = {
      r: { code: { a: {} } },
      h: {
        p1: { "2026.jsonl": '{"other":1}\n{"cwd":"/r/code/a"}\n', "old.jsonl": '{"cwd":"/old"}\n' },
        p2: { "n.jsonl": '{"cwd":"/gone"}\n' },
        p3: { "n.jsonl": '{"no":"cwd here"}\n' },
        p4: {},
      },
    };
    const fs = fakeFs(tree, { "/h/p1/2026.jsonl": 200, "/h/p1/old.jsonl": 100, "/h/p2/n.jsonl": 5 });
    expect(readClaudeHistoryProjects("/h", fs)).toEqual([
      { path: "/r/code/a", recencyMs: 200 },
    ]);
  });

  it("skips a cwd that sits beyond the byte cap", () => {
    const tree = { h: { p1: { "n.jsonl": `${"x".repeat(600)},"cwd":"/r/code/a"}]` } } };
    const fs = fakeFs(tree);
    const capSpy = fs.readFileHead;
    // 600 bytes of filler then the cwd — with a 100-byte cap it must not be found
    expect(readClaudeHistoryProjects("/h", { ...fs, readFileHead: (p, cap) => capSpy(p, Math.min(cap, 100)) })).toEqual([]);
  });
});

describe("mergeDiscovered and discoverProjects", () => {
  it("merges sources per path, most recent first, nulls last", () => {
    const merged = mergeDiscovered([
      { path: "/old", recencyMs: 10, source: "scan" },
      { path: "/new", recencyMs: null, source: "claude-history" },
      { path: "/old", recencyMs: 500, source: "claude-history" },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toEqual({ path: "/old", recencyMs: 500, sources: ["scan", "claude-history"] });
    expect(merged[1].path).toBe("/new");
  });

  it("knows a project through both sources exactly once and skips missing roots", () => {
    const tree = {
      r: { code: { a: { ".git": "" } } },
      h: { p1: { "n.jsonl": '{"cwd":"/r/code/a"}\n' } },
    };
    const fs = fakeFs(tree, { "/r/code/a": 5, "/h/p1/n.jsonl": 99 });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const found = discoverProjects({ roots: ["/r/code", "/missing"], claudeProjectsDir: "/h", fs });
    expect(found).toHaveLength(1);
    expect(found[0].path).toBe("/r/code/a");
    expect(found[0].sources).toEqual(["scan", "claude-history"]);
    expect(found[0].recencyMs).toBe(99); // recency takes the fresher evidence
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe("expandScanRoots", () => {
  it("expands ~ and reports missing roots without failing", () => {
    // Build the fake tree along the real homedir path so `~/code` lands inside it.
    const parts = homedir().split("/").filter(Boolean);
    const tree: Record<string, unknown> = {};
    let cursor = tree;
    for (const part of parts) {
      cursor[part] = {};
      cursor = cursor[part] as Record<string, unknown>;
    }
    cursor.code = {};
    const fs = fakeFs(tree);
    const { existing, missing } = expandScanRoots(["~/code", "/definitely/not/there"], fs);
    expect(existing).toEqual([join(homedir(), "code")]);
    expect(missing).toEqual(["/definitely/not/there"]);
  });
});

describe("node fs adapter", () => {
  it("reads a file head positionally without reading the whole file", () => {
    const dir = mkdtempSync(join(tmpdir(), "head-"));
    const file = join(dir, "big.jsonl");
    writeFileSync(file, "a".repeat(1000) + '{"cwd":"/x"}');
    expect(nodeDiscoveryFs.readFileHead(file, 512)).toHaveLength(512);
    expect(nodeDiscoveryFs.readFileHead(file, 512)).not.toContain("cwd");
    utimesSync(file, new Date(), new Date(1_000_000));
    expect(nodeDiscoveryFs.mtimeMs(file)).toBe(1_000_000);
    rmSync(dir, { recursive: true, force: true });
  });
});
