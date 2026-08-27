import { describe, it, expect } from "vitest";
import { LevelMeter, SPEECH_RMS_THRESHOLD } from "./capture.js";

/** s16le mono buffer of a constant-amplitude square wave — rms equals the amplitude. */
function tone(amplitude: number, samples = 16_000): Buffer {
  const buf = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) buf.writeInt16LE(i % 2 === 0 ? amplitude : -amplitude, i * 2);
  return buf;
}

describe("LevelMeter — bytes say the pipe is open, rms says what came through it", () => {
  it("reads a disconnected digital input as silence, well under the speech threshold", () => {
    const m = new LevelMeter();
    m.add(tone(1));
    expect(m.rms).toBe(1);
    expect(m.maxRms).toBeLessThan(SPEECH_RMS_THRESHOLD);
  });

  it("reads a room noise floor as below the speech threshold", () => {
    // The level measured on the capture that failed on 2026-08-27.
    const m = new LevelMeter();
    m.add(tone(68));
    expect(m.maxRms).toBeLessThan(SPEECH_RMS_THRESHOLD);
  });

  it("reads speech-level audio as above the threshold", () => {
    const m = new LevelMeter();
    m.add(tone(2000));
    expect(m.rms).toBe(2000);
    expect(m.peak).toBe(2000);
    expect(m.maxRms).toBeGreaterThan(SPEECH_RMS_THRESHOLD);
  });

  it("remembers the loudest window across a reset, so a late-starting speaker still counts", () => {
    const m = new LevelMeter();
    m.add(tone(2000));
    m.reset();
    expect(m.rms).toBe(0);      // the new window is empty
    expect(m.peak).toBe(0);
    expect(m.maxRms).toBe(2000); // but the capture as a whole did hear speech
  });

  it("an empty meter reports zero rather than NaN", () => {
    const m = new LevelMeter();
    expect(m.rms).toBe(0);
    expect(m.maxRms).toBe(0);
  });
});
