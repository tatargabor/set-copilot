import { describe, expect, it } from "vitest";
import { join } from "node:path";

import { planSkillInstall, resolveInstallMode, type DestState } from "./skill-install.js";

const SRC = "/pkg/skills";
const DEST = "/home/u/.claude/skills";

/** Plan one skill, with the destination and source facts stated rather than staged on disk. */
function planOne(
  name: string,
  state: DestState,
  opts: { mode?: "link" | "copy"; srcExists?: boolean; linkTarget?: string | null } = {},
) {
  const [action] = planSkillInstall({
    skillsSrc: SRC,
    skillsDest: DEST,
    names: [name],
    mode: opts.mode ?? "link",
    inspect: () => state,
    srcExists: () => opts.srcExists ?? true,
    linkTarget: () => opts.linkTarget ?? null,
    stamp: "2026-08-09T10-00-00-000Z",
  });
  return action;
}

describe("resolveInstallMode", () => {
  it("links from a checkout — the source can move ahead of the install", () => {
    // The repo root always has a .git; that is the checkout case, and `npm link` makes it
    // the very package the CLI runs from.
    expect(resolveInstallMode(process.cwd())).toBe("link");
  });

  it("copies when there is no tracking source (an npm install, an extracted tarball)", () => {
    expect(resolveInstallMode("/nonexistent/node_modules/set-copilot")).toBe("copy");
  });

  it("copies when the operator forces it, checkout or not", () => {
    expect(resolveInstallMode(process.cwd(), { forceCopy: true })).toBe("copy");
  });
});

describe("planSkillInstall", () => {
  it("links into an empty destination", () => {
    expect(planOne("dd", "missing")).toEqual({
      kind: "link", name: "dd", src: join(SRC, "dd"), dest: join(DEST, "dd"),
    });
  });

  it("archives an existing real directory instead of deleting it", () => {
    const action = planOne("meeting-copilot", "dir");
    expect(action.kind).toBe("archive-then-link");
    // Whatever the operator hand-edited into the installed copy survives the install.
    expect(action).toMatchObject({ backup: `${join(DEST, "meeting-copilot")}.bak-2026-08-09T10-00-00-000Z` });
  });

  it("does not archive a link that already points at this source — a link holds no content", () => {
    const action = planOne("ds", "link-ok", { linkTarget: join(SRC, "ds") });
    expect(action.kind).toBe("link");
  });

  it("replaces a link pointing somewhere else", () => {
    const action = planOne("ds", "link-ok", { linkTarget: "/some/other/checkout/skills/ds" });
    expect(action.kind).toBe("replace-dangling");
  });

  it("repairs a dangling link — it makes the skill vanish with no error anywhere", () => {
    expect(planOne("set-repair", "link-dangling").kind).toBe("replace-dangling");
  });

  it("never links a missing source, whatever the destination holds", () => {
    for (const state of ["missing", "dir", "link-ok", "link-dangling"] as DestState[]) {
      expect(planOne("gone", state, { srcExists: false }).kind).toBe("skip-missing");
    }
  });

  it("copies every skill in copy mode, leaving today's behavior byte for byte", () => {
    const actions = planSkillInstall({
      skillsSrc: SRC,
      skillsDest: DEST,
      names: ["dd", "ds", "meeting-copilot"],
      mode: "copy",
      inspect: () => "dir",
      srcExists: () => true,
    });
    expect(actions.map(a => a.kind)).toEqual(["copy", "copy", "copy"]);
  });

  it("plans one action per name, in order, so the report can be rendered from it", () => {
    const names = ["dd", "dictate", "ds", "meeting-copilot", "set-repair", "transcript-recover"];
    const actions = planSkillInstall({
      skillsSrc: SRC, skillsDest: DEST, names, mode: "link",
      inspect: () => "missing", srcExists: () => true,
    });
    expect(actions.map(a => a.name)).toEqual(names);
  });
});
