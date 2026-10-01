/**
 * The macOS mic-permission diagnosis.
 *
 * A denied microphone and a mistyped device name both surface as exactly
 * "0 bytes" — sox opens the device, prints nothing, and exits clean. The doctor
 * used to offer only "wrong device or broken parec/sox", which sends the reader
 * to edit `micSource` when the config was never the problem. macOS grants the
 * permission to the enclosing **app bundle**, so naming that app is the whole
 * fix; this test pins the ancestry reading that finds it.
 */

import { describe, expect, it } from "vitest";

import { hostAppFromAncestry } from "./doctor.js";

describe("hostAppFromAncestry", () => {
  it("names the nearest enclosing app bundle, not the leaf process", () => {
    // Real ancestry: zsh ← claude ← Zed.app. TCC holds the grant against Zed.
    expect(hostAppFromAncestry(["/bin/zsh", "claude", "/Applications/Zed.app/Contents/MacOS/zed"]))
      .toBe("Zed");
  });

  it("stops at the first bundle, so a nested helper does not shadow its host", () => {
    expect(hostAppFromAncestry([
      "/Applications/iTerm.app/Contents/MacOS/iTerm2",
      "/System/Library/CoreServices/loginwindow.app/Contents/MacOS/loginwindow",
    ])).toBe("iTerm");
  });

  it("returns undefined for a pure CLI ancestry so the caller can fall back", () => {
    // A bare ssh/tty session has no bundle — claiming one would name the wrong
    // System Settings row, which is worse than saying "your terminal/IDE".
    expect(hostAppFromAncestry(["/bin/zsh", "/usr/sbin/sshd", "/sbin/launchd"])).toBeUndefined();
    expect(hostAppFromAncestry([])).toBeUndefined();
  });
});
