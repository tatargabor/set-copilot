import { describe, it, expect } from "vitest";
import { mergeAudio } from "./config.js";

describe("mergeAudio — a scaffolded empty key must not unset a working device", () => {
  const user = {
    micSource: "alsa_input.usb-046d_HD_Pro_Webcam_C920-02.analog-stereo",
    monitorSource: "",
    sampleRate: 16000,
    toneStart: "",
    toneEnd: "",
  };

  it("keeps the user-level mic when the project scaffolded the key empty", () => {
    // The exact shape that emptied every dictation in one project on 2026-08-27.
    expect(mergeAudio(user, { micSource: "", monitorSource: "" }).micSource).toBe(user.micSource);
  });

  it("still lets a project override the mic with a real device", () => {
    expect(mergeAudio(user, { micSource: "alsa_input.other" }).micSource).toBe("alsa_input.other");
  });

  it("treats whitespace as empty, not as a device name", () => {
    expect(mergeAudio(user, { micSource: "   " }).micSource).toBe(user.micSource);
  });

  it("does not drop the sibling keys the project never mentioned", () => {
    expect(mergeAudio(user, { micSource: "" }).sampleRate).toBe(16000);
  });

  it("lets a project override a numeric key, including with a lower value", () => {
    expect(mergeAudio(user, { sampleRate: 8000 }).sampleRate).toBe(8000);
  });

  it("survives either layer being absent", () => {
    expect(mergeAudio(undefined, { micSource: "x" }).micSource).toBe("x");
    expect(mergeAudio(user, undefined).micSource).toBe(user.micSource);
    expect(mergeAudio(undefined, undefined)).toEqual({});
  });
});
