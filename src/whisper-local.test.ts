import { describe, expect, it } from "vitest";

import { cleanWhisperText } from "./whisper-local.js";

describe("cleanWhisperText", () => {
  it("joins multi-line output into a single trimmed string", () => {
    expect(cleanWhisperText("  Hello there.\n  How are you?  \n")).toBe("Hello there. How are you?");
  });

  it("drops whole-line non-speech markers whisper emits for silence", () => {
    expect(cleanWhisperText("[BLANK_AUDIO]")).toBe("");
    expect(cleanWhisperText("(speaking foreign language)")).toBe("");
    expect(cleanWhisperText("*music*")).toBe("");
  });

  it("keeps real speech even when a marker line sits beside it", () => {
    expect(cleanWhisperText("[BLANK_AUDIO]\nActual words here.\n[ Silence ]")).toBe("Actual words here.");
  });

  it("does not strip brackets that are part of a real sentence", () => {
    expect(cleanWhisperText("The rate (net) is fixed.")).toBe("The rate (net) is fixed.");
  });

  it("returns empty string for empty input", () => {
    expect(cleanWhisperText("")).toBe("");
    expect(cleanWhisperText("   \n  \n")).toBe("");
  });
});
