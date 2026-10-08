import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeBin, findMeetingSkill, openingPrompt, platformRefusal, resolveProject } from "./meeting.js";
import { emptyRegistry, touchProject, upsertProject, type ProjectRegistry } from "./project-registry.js";

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}
function cleanup(...dirs: string[]): void {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

describe("platform gate", () => {
  it("accepts macOS and Linux, refuses anything else before any probe", () => {
    expect(platformRefusal("darwin")).toBeNull();
    expect(platformRefusal("linux")).toBeNull();
    const refusal = platformRefusal("win32");
    expect(refusal).toContain("macOS and Linux");
    expect(refusal).toContain("win32");
  });
});

describe("claudeBin", () => {
  it("prefers ~/.local/bin over PATH", () => {
    const home = tempDir("claude-home-");
    mkdirSync(join(home, ".local", "bin"), { recursive: true });
    writeFileSync(join(home, ".local", "bin", "claude"), "#!/bin/sh\n");
    const pathDir = tempDir("claude-path-");
    writeFileSync(join(pathDir, "claude"), "#!/bin/sh\n");
    expect(claudeBin(pathDir, home)).toBe(join(home, ".local", "bin", "claude"));
    cleanup(home, pathDir);
  });

  it("falls back to a PATH directory, then to undefined", () => {
    const pathDir = tempDir("claude-path-");
    writeFileSync(join(pathDir, "claude"), "#!/bin/sh\n");
    expect(claudeBin(pathDir, tempDir("empty-"))).toBe(join(pathDir, "claude"));
    cleanup(pathDir);
    expect(claudeBin("", tempDir("empty-"))).toBeUndefined();
  });
});

describe("resolveProject", () => {
  function twoProjects(): { registry: ProjectRegistry; dirs: [string, string] } {
    const a = tempDir("alpha-");
    const b = tempDir("beta-");
    const registry = emptyRegistry();
    upsertProject(registry, a, "alpha");
    upsertProject(registry, b, "beta");
    return { registry, dirs: [a, b] };
  }

  it("prefers an existing directory passed as --project, registered or not", () => {
    const { registry, dirs } = twoProjects();
    const unregistered = tempDir("gamma-");
    expect(resolveProject({ projectArg: unregistered, registry, cwd: "/somewhere" })).toMatchObject({
      ok: true,
      dir: unregistered,
      record: null,
    });
    cleanup(unregistered, ...dirs);
  });

  it("resolves a registry name and reports ambiguity naming the candidates", () => {
    const { registry, dirs } = twoProjects();
    const third = tempDir("gamma-");
    upsertProject(registry, third, "alpha"); // a second project sharing dirs[0]'s name
    expect(resolveProject({ projectArg: "beta", registry, cwd: "/somewhere" })).toMatchObject({
      ok: true,
      dir: dirs[1],
    });
    const ambiguous = resolveProject({ projectArg: "alpha", registry, cwd: "/somewhere" });
    expect(ambiguous.ok).toBe(false);
    if (!ambiguous.ok) {
      expect(ambiguous.message).toContain(dirs[0]);
      expect(ambiguous.message).toContain(third);
    }
    expect(resolveProject({ projectArg: "nope", registry, cwd: "/somewhere" }).ok).toBe(false);
    cleanup(third, ...dirs);
  });

  it("without an argument picks the most recently used, else the cwd", () => {
    const { registry, dirs } = twoProjects();
    expect(resolveProject({ registry, cwd: "/somewhere" })).toMatchObject({ ok: true, dir: "/somewhere" });
    touchProject(registry, dirs[1], new Date(1000));
    touchProject(registry, dirs[0], new Date(2000));
    expect(resolveProject({ registry, cwd: "/somewhere" })).toMatchObject({ ok: true, dir: dirs[0] });
    cleanup(...dirs);
  });
});

describe("openingPrompt", () => {
  it("composes the skill's own argument grammar", () => {
    expect(openingPrompt()).toBe("/meeting-copilot start wall");
    expect(openingPrompt({ micOnly: true })).toBe("/meeting-copilot start --lite wall");
    expect(openingPrompt({ extra: ["--zero"] })).toBe("/meeting-copilot start wall --zero");
  });
});

describe("findMeetingSkill", () => {
  it("prefers the project skill, accepts a copied install, skips a dangling link", () => {
    const home = tempDir("skill-home-");
    const project = tempDir("skill-proj-");

    expect(findMeetingSkill(project, home)).toBeUndefined();

    const homeSkill = join(home, ".claude", "skills", "meeting-copilot", "SKILL.md");
    mkdirSync(join(home, ".claude", "skills", "meeting-copilot"), { recursive: true });
    writeFileSync(homeSkill, "skill");
    expect(findMeetingSkill(project, home)).toBe(homeSkill);

    const projectSkill = join(project, ".claude", "skills", "meeting-copilot", "SKILL.md");
    mkdirSync(join(project, ".claude", "skills", "meeting-copilot"), { recursive: true });
    writeFileSync(projectSkill, "skill"); // a copy, as a global install would leave
    expect(findMeetingSkill(project, home)).toBe(projectSkill);

    rmSync(projectSkill);
    symlinkSync(join(project, "gone-target"), projectSkill); // dangling
    expect(findMeetingSkill(project, home)).toBe(homeSkill);

    cleanup(project, home);
  });
});
