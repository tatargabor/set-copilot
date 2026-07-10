/**
 * Synthesized start/stop tones.
 *
 * Start = rising sweep (C5 → C6), stop = falling sweep (C6 → C5) — you can
 * tell by ear which way the session went without looking at the terminal.
 * Generated on first use and cached in the OS temp dir; no binary assets in
 * the package.
 */

import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SAMPLE_RATE = 22050;

export function ensureTone(kind: "start" | "end"): string {
  const path = join(tmpdir(), `set-copilot-tone-${kind}.wav`);
  if (!existsSync(path)) {
    writeFileSync(path, kind === "start"
      ? synthSweep(523.25, 1046.5, 0.4)   // rising: C5 → C6
      : synthSweep(1046.5, 523.25, 0.45)); // falling: C6 → C5
  }
  return path;
}

/** Exponential-glide sine sweep with click-free attack/release envelope. */
function synthSweep(fromHz: number, toHz: number, seconds: number): Buffer {
  const n = Math.round(SAMPLE_RATE * seconds);
  const pcm = Buffer.alloc(n * 2);
  const attack = Math.round(SAMPLE_RATE * 0.015);
  const release = Math.round(SAMPLE_RATE * 0.08);
  const ratio = toHz / fromHz;

  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const freq = fromHz * Math.pow(ratio, t); // exponential glide sounds musical
    phase += (2 * Math.PI * freq) / SAMPLE_RATE;
    let amp = 0.4;
    if (i < attack) amp *= i / attack;
    if (i > n - release) amp *= (n - i) / release;
    pcm.writeInt16LE(Math.round(Math.sin(phase) * amp * 32767), i * 2);
  }
  return wavWrap(pcm);
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
