import { describe, it, expect } from "vitest";
import { parseInputGain } from "./audio.js";

/** Trimmed from real `pactl list sources` output on the machine where this bug appeared. */
const PACTL = `Source #2
	State: SUSPENDED
	Name: alsa_input.usb-046d_HD_Pro_Webcam_C920-02.analog-stereo
	Description: HD Pro Webcam C920 Analog Stereo
	Mute: no
	Volume: front-left: 38550 /  59% / -13.83 dB,   front-right: 38550 /  59% / -13.83 dB
	        balance 0.00
	Base Volume: 12110 /  18% / -44.00 dB

Source #4
	State: SUSPENDED
	Name: alsa_input.usb-Generic_USB_Audio-00.iec958-stereo
	Description: USB Audio Digital Stereo (IEC958)
	Mute: yes
	Volume: front-left: 67859 / 104% / 0.91 dB,   front-right: 67859 / 104% / 0.91 dB
`;

describe("parseInputGain — the drifted gain that silently empties a transcript", () => {
  it("reads the volume of the named source, not the first one in the list", () => {
    expect(parseInputGain(PACTL, "alsa_input.usb-Generic_USB_Audio-00.iec958-stereo"))
      .toEqual({ source: "alsa_input.usb-Generic_USB_Audio-00.iec958-stereo", percent: 104, muted: true });
  });

  it("reads the percentage, ignoring the raw value and the dB that follow it", () => {
    expect(parseInputGain(PACTL, "alsa_input.usb-046d_HD_Pro_Webcam_C920-02.analog-stereo"))
      .toEqual({ source: "alsa_input.usb-046d_HD_Pro_Webcam_C920-02.analog-stereo", percent: 59, muted: false });
  });

  it("does not confuse Base Volume with the current volume", () => {
    // Base Volume is 18% on this device — reporting that would warn on every capture.
    expect(parseInputGain(PACTL, "alsa_input.usb-046d_HD_Pro_Webcam_C920-02.analog-stereo")?.percent).toBe(59);
  });

  it("declines rather than guessing when no source is configured", () => {
    expect(parseInputGain(PACTL, undefined)).toBeNull();
  });

  it("returns null for a source that is not in the output", () => {
    expect(parseInputGain(PACTL, "alsa_input.does-not-exist")).toBeNull();
  });

  it("returns null when pactl produced nothing", () => {
    expect(parseInputGain("", "alsa_input.usb-046d_HD_Pro_Webcam_C920-02.analog-stereo")).toBeNull();
  });
});
