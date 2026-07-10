/**
 * Synthesized start/stop tones.
 *
 * Start = rising two-note bell motif (G5 → C6), stop = falling (C6 → G5) —
 * direction tells you by ear which way the session went. Bell-like additive
 * synthesis (harmonic partials + exponential decay) instead of a raw sine
 * sweep, so it sounds like a product notification, not a test signal.
 *
 * Generated on first use and cached in the OS temp dir; no binary assets in
 * the package. Custom sounds can override via config (audio.toneStart /
 * audio.toneEnd — any file paplay/afplay can play).
 */

import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { platform, tmpdir } from "node:os";
import { join } from "node:path";

const SAMPLE_RATE = 44100;
/** Bump when the synthesis changes — the cache file name carries it. */
const TONE_VERSION = "v2";

/**
 * Fire-and-forget playback — never blocks the caller.
 * `customPath` (from config audio.toneStart/toneEnd) wins when set and exists.
 */
export function playTone(kind: "start" | "end", customPath?: string): void {
  const os = platform();
  if (os !== "darwin" && os !== "linux") {
    process.stdout.write(kind === "end" ? "\x07\x07" : "\x07");
    return;
  }
  try {
    const sound = customPath && existsSync(customPath) ? customPath : ensureTone(kind);
    const player = os === "darwin" ? "afplay" : "paplay";
    spawn(player, [sound], { stdio: "ignore", detached: true }).unref();
  } catch {
    process.stdout.write("\x07");
  }
}

export function ensureTone(kind: "start" | "end"): string {
  const path = join(tmpdir(), `set-copilot-tone-${TONE_VERSION}-${kind}.wav`);
  if (!existsSync(path)) {
    // G5 = 784 Hz, C6 = 1046.5 Hz — a rising/falling perfect fourth.
    writeFileSync(path, kind === "start"
      ? synthMotif([783.99, 1046.5])
      : synthMotif([1046.5, 783.99]));
  }
  return path;
}

/** Two overlapping bell notes, 130 ms apart, ~0.7 s total ring. */
function synthMotif(freqs: number[]): Buffer {
  const noteGapS = 0.13;
  const noteLenS = 0.55;
  const total = noteGapS * (freqs.length - 1) + noteLenS;
  const n = Math.round(SAMPLE_RATE * total);
  const mix = new Float64Array(n);

  freqs.forEach((f, idx) => addBell(mix, Math.round(SAMPLE_RATE * noteGapS * idx), f, noteLenS));

  // Normalize to a comfortable peak, then quantize to 16-bit PCM.
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(mix[i]));
  const gain = peak > 0 ? 0.45 / peak : 0;
  const pcm = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    pcm.writeInt16LE(Math.round(mix[i] * gain * 32767), i * 2);
  }
  return wavWrap(pcm);
}

/**
 * One bell/glockenspiel note: harmonic partials with a touch of inharmonic
 * shimmer, near-instant attack, exponential decay.
 */
function addBell(buf: Float64Array, offset: number, freq: number, lenS: number): void {
  const partials: Array<[number, number]> = [
    [1, 1.0],
    [2, 0.35],
    [3, 0.18],
    [4.2, 0.07], // slightly inharmonic — the "metallic" shimmer of a bell
  ];
  const n = Math.min(Math.round(SAMPLE_RATE * lenS), buf.length - offset);
  const attack = Math.round(SAMPLE_RATE * 0.003);
  const tau = 0.16; // seconds — decay constant

  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    let env = Math.exp(-t / tau);
    if (i < attack) env *= i / attack;
    let s = 0;
    for (const [mult, amp] of partials) {
      s += amp * Math.sin(2 * Math.PI * freq * mult * t);
    }
    buf[offset + i] += s * env;
  }
}

function wavWrap(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(pcm.length + 36, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
