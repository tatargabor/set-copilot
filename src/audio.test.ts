/**
 * macOS input-device discovery.
 *
 * These tests exist because the path they cover shipped broken and nothing
 * noticed: `listSources()` asked `sox --help-device coreaudio`, current Homebrew
 * sox builds reject the flag, and the usage error came back **as the device
 * list** — two lines of sox complaint where the microphone should have been.
 * A device list nobody can assert against is a device list nobody can trust,
 * so the parse is pure and the fixture is a real `system_profiler` payload.
 */

import { describe, expect, it } from "vitest";

import { parseMacInputDevices } from "./audio.js";

/** Trimmed from a real `system_profiler SPAudioDataType -json` on macOS 15. */
const REAL_PAYLOAD = JSON.stringify({
  SPAudioDataType: [
    {
      _name: "coreaudio_device",
      _items: [
        {
          _name: "Gabor's iPhone Microphone",
          coreaudio_device_input: 1,
          coreaudio_device_srate: 48000,
          coreaudio_device_transport: "coreaudio_device_type_unknown",
        },
        {
          _name: "HD Pro Webcam C920",
          coreaudio_default_audio_input_device: "spaudio_yes",
          coreaudio_device_input: 2,
          coreaudio_device_srate: 16000,
          coreaudio_device_transport: "coreaudio_device_type_usb",
        },
        {
          _name: "Mac mini Speakers",
          coreaudio_default_audio_output_device: "spaudio_yes",
          coreaudio_default_audio_system_device: "spaudio_yes",
          coreaudio_device_output: 2,
        },
      ],
    },
  ],
});

describe("parseMacInputDevices", () => {
  it("lists inputs only — an output-only device is never offered as a mic", () => {
    const devices = parseMacInputDevices(REAL_PAYLOAD);
    expect(devices).toHaveLength(2);
    expect(devices.join("\n")).not.toContain("Mac mini Speakers");
  });

  it("puts the default input first and marks it", () => {
    const [first, second] = parseMacInputDevices(REAL_PAYLOAD);
    expect(first).toBe("HD Pro Webcam C920  (default input)");
    expect(second).toBe("Gabor's iPhone Microphone");
  });

  it("keeps the bare device name at the start of the line, copy-pasteable into micSource", () => {
    for (const line of parseMacInputDevices(REAL_PAYLOAD)) {
      expect(line.split("  ")[0]).not.toMatch(/[()]/);
    }
  });

  it("finds devices nested one level deeper — the tree shape varies by macOS version", () => {
    const nested = JSON.stringify({
      SPAudioDataType: [
        { _name: "top", _items: [{ _name: "Devices", _items: [{ _name: "Studio Mic", coreaudio_device_input: 1 }] }] },
      ],
    });
    expect(parseMacInputDevices(nested)).toEqual(["Studio Mic"]);
  });

  it("returns nothing rather than throwing when system_profiler gives non-JSON", () => {
    // The old failure mode dressed an error up as data; the replacement must not
    // repeat it in a new shape. `sources` printing nothing is a readable answer.
    expect(parseMacInputDevices("sox FAIL: invalid option")).toEqual([]);
    expect(parseMacInputDevices("")).toEqual([]);
    expect(parseMacInputDevices("{}")).toEqual([]);
    expect(parseMacInputDevices('{"SPAudioDataType":"nope"}')).toEqual([]);
  });
});
