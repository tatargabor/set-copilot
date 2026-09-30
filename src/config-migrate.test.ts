/**
 * Config migration.
 *
 * This code rewrites files the user did not ask it to touch — one of them
 * git-tracked — so every decision it makes is pinned here rather than left to a
 * run against one machine's real config. The properties that matter are not
 * "does it move the key" but the ones that make an automatic rewrite safe:
 * it never overwrites a machine's own device, it never invents a config file,
 * and an already-migrated install writes nothing at all.
 */

import { describe, expect, it } from "vitest";

import { CONFIG_VERSION, migrateConfigDocs, type ConfigDoc } from "./config-migrate.js";

const USER = "/home/u/.config/set-copilot/set-copilot.config.json";
const PROJ = "/repo/set-copilot.config.json";

const user = (data: Record<string, unknown>, exists = true): ConfigDoc =>
  ({ role: "user", path: USER, data, exists });
const project = (data: Record<string, unknown>, exists = true): ConfigDoc =>
  ({ role: "project", path: PROJ, data, exists });

const find = (r: { docs: ConfigDoc[] }, path: string) => r.docs.find((d) => d.path === path)!;

describe("migration 1 — device names are machine-level", () => {
  it("moves a committed device out of the project config and into the machine's", () => {
    // The real 2026-08-05 value: a Linux ALSA name that a Mac clone captured 0 bytes from.
    const result = migrateConfigDocs([
      user({}, false),
      project({ language: "hu", audio: { micSource: "alsa_input.usb-046d_C920-02.analog-stereo", sampleRate: 16000 } }),
    ]);

    expect((find(result, PROJ).data.audio as Record<string, unknown>).micSource).toBeUndefined();
    expect((find(result, USER).data.audio as Record<string, unknown>).micSource)
      .toBe("alsa_input.usb-046d_C920-02.analog-stereo");
    expect(result.changed).toEqual(expect.arrayContaining([USER, PROJ]));
  });

  it("leaves the project's own audio settings alone", () => {
    const result = migrateConfigDocs([
      user({}, false),
      project({ audio: { micSource: "mic-x", sampleRate: 8000 } }),
    ]);
    expect(find(result, PROJ).data.audio).toEqual({ sampleRate: 8000 });
  });

  it("never overwrites the device the machine already declares", () => {
    // The machine's own value is, by construction, the one that matches its
    // hardware. Preferring the repo's would re-break the setup the migration
    // exists to fix — on a machine where it currently works.
    const result = migrateConfigDocs([
      user({ audio: { micSource: "HD Pro Webcam C920" } }),
      project({ audio: { micSource: "alsa_input.usb-046d_C920-02.analog-stereo" } }),
    ]);
    expect((find(result, USER).data.audio as Record<string, unknown>).micSource).toBe("HD Pro Webcam C920");
    expect(find(result, PROJ).data.audio).toBeUndefined();
    expect(result.notes.some((n) => n.message.includes("eldobva"))).toBe(true);
  });

  it("drops an emptied audio section instead of leaving `audio: {}`", () => {
    const result = migrateConfigDocs([user({}, false), project({ audio: { micSource: "mic-x" } })]);
    expect(find(result, PROJ).data.audio).toBeUndefined();
  });

  it("treats an empty device string as already correct — it means 'system default'", () => {
    const result = migrateConfigDocs([
      user({ configVersion: CONFIG_VERSION }),
      project({ configVersion: CONFIG_VERSION, audio: { micSource: "", monitorSource: "" } }),
    ]);
    expect(result.changed).toEqual([]);
  });

  it("carries the monitor source by the same rule", () => {
    const result = migrateConfigDocs([
      user({}, false),
      project({ audio: { monitorSource: "alsa_output.pci-0000_00.monitor" } }),
    ]);
    expect((find(result, USER).data.audio as Record<string, unknown>).monitorSource)
      .toBe("alsa_output.pci-0000_00.monitor");
  });
});

describe("versioning", () => {
  it("stamps every existing file so the migration cannot run twice", () => {
    const first = migrateConfigDocs([user({}, false), project({ audio: { micSource: "mic-x" } })]);
    expect(find(first, PROJ).data.configVersion).toBe(CONFIG_VERSION);

    // Feed the output back in: an already-migrated install is a no-op.
    const second = migrateConfigDocs(first.docs.map((d) => ({ ...d, exists: true })));
    expect(second.changed).toEqual([]);
    expect(second.notes).toEqual([]);
  });

  it("writes nothing when there is nothing to migrate and nothing to stamp", () => {
    const result = migrateConfigDocs([
      user({ configVersion: CONFIG_VERSION, audio: { micSource: "HD Pro Webcam C920" } }),
      project({ configVersion: CONFIG_VERSION, language: "hu" }),
    ]);
    expect(result.changed).toEqual([]);
  });

  it("never conjures a config file the user does not have", () => {
    // Dictation works with no config at all. A version stamp is not a reason to
    // start creating files in someone's home directory.
    const result = migrateConfigDocs([user({}, false), project({}, false)]);
    expect(result.changed).toEqual([]);
    expect(find(result, USER).data).toEqual({});
  });

  it("stamps an unversioned file even when no migration touched it", () => {
    // Without the stamp, every later run re-evaluates every migration against a
    // file that is already correct — and a future migration would re-apply.
    const result = migrateConfigDocs([user({}, false), project({ language: "hu" })]);
    expect(result.changed).toEqual([PROJ]);
    expect(find(result, PROJ).data).toEqual({ language: "hu", configVersion: CONFIG_VERSION });
  });

  it("does not mutate its input", () => {
    const input = project({ audio: { micSource: "mic-x" } });
    migrateConfigDocs([user({}, false), input]);
    expect(input.data.audio).toEqual({ micSource: "mic-x" });
  });
});
