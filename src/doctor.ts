/**
 * `set-copilot doctor` — environment + audio health check.
 *
 * Answers the question the hard way learned on 2026-07-10: "capture says
 * connected, transcript stays empty — why?" It probes the actual audio chain
 * (binary → device → bytes → signal) instead of guessing.
 */

import { spawn, spawnSync } from "node:child_process";
import { platform } from "node:os";

import type { CopilotConfig } from "./config.js";
import { listSources, parecBin } from "./audio.js";

interface ProbeResult {
  bytes: number;
  peak: number;
}

/** Probe with one retry: a suspended device occasionally yields 0 bytes on first open. */
async function probeSourceRetry(device: string | undefined, sampleRate: number): Promise<ProbeResult> {
  const first = await probeSource(device, sampleRate);
  if (first.bytes > 0) return first;
  return probeSource(device, sampleRate);
}

/** Capture ~3s from a source and report byte count + peak amplitude. */
function probeSource(device: string | undefined, sampleRate: number): Promise<ProbeResult> {
  return new Promise((resolvePromise) => {
    const os = platform();
    const bin = os === "darwin" ? "sox" : parecBin();
    const args = os === "darwin"
      ? ["-t", "coreaudio", device || "default", "-t", "raw", "-r", String(sampleRate), "-b", "16", "-c", "1", "-e", "signed-integer", "-"]
      : ["--format=s16le", "--rate", String(sampleRate), "--channels=1", ...(device ? ["--device", device] : [])];

    const proc = spawn(bin, args, { stdio: ["ignore", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    proc.stdout!.on("data", (d: Buffer) => chunks.push(d));

    const finish = () => {
      const data = Buffer.concat(chunks);
      let peak = 0;
      for (let i = 0; i + 1 < data.length; i += 2) {
        const v = Math.abs(data.readInt16LE(i));
        if (v > peak) peak = v;
      }
      resolvePromise({ bytes: data.length, peak });
    };

    // SIGKILL: a broken parec (see linuxbrew-vs-PipeWire) ignores SIGTERM too.
    // 3s: a SUSPENDED source can take >1s to resume before bytes flow.
    const killer = setTimeout(() => proc.kill("SIGKILL"), 3000);
    // Hard guard in case even spawn/kill wedges.
    const guard = setTimeout(finish, 5000);
    proc.on("exit", () => { clearTimeout(killer); clearTimeout(guard); finish(); });
    proc.on("error", () => { clearTimeout(killer); clearTimeout(guard); finish(); });
  });
}

function verdict(label: string, r: ProbeResult, expectedBytesPerSec: number, silenceIsNormal = false): boolean {
  if (r.bytes === 0) {
    console.log(`  ✗ ${label}: 0 byte — nem folyik hang (rossz eszköz vagy törött parec/sox)`);
    return false;
  }
  const secs = r.bytes / expectedBytesPerSec;
  if (r.peak === 0) {
    console.log(silenceIsNormal
      ? `  ✓ ${label}: ${Math.round(r.bytes / 1024)} KB folyik, jel csupa nulla — ha épp nem szól semmi, ez normális`
      : `  ⚠ ${label}: ${Math.round(r.bytes / 1024)} KB (~${secs.toFixed(1)}s), de a jel csupa nulla — digitális csend, valószínűleg rossz eszköz (beszélj bele próba közben!)`);
    return true;
  }
  console.log(`  ✓ ${label}: ${Math.round(r.bytes / 1024)} KB, peak=${r.peak} — él a jel`);
  return true;
}

export async function runDoctor(cfg: CopilotConfig): Promise<void> {
  let failed = false;
  const os = platform();

  // 1. API key
  if (cfg.sonioxApiKey) {
    console.log("  ✓ SONIOX_API_KEY beállítva");
  } else {
    console.log("  ✗ SONIOX_API_KEY hiányzik (.env vagy környezeti változó)");
    failed = true;
  }

  // 2. Audio binary
  const bin = os === "darwin" ? "sox" : parecBin();
  const which = spawnSync(os === "darwin" ? "sox" : bin, ["--version"], { stdio: "ignore" });
  if (which.error) {
    console.log(`  ✗ ${bin} nem futtatható — telepítsd (${os === "darwin" ? "brew install sox" : "pulseaudio-utils / pipewire-pulse"})`);
    failed = true;
  } else {
    console.log(`  ✓ audio bináris: ${bin}`);
  }

  // 3. Sources
  const sources = await listSources();
  if (sources.length) {
    console.log(`  • elérhető források (${sources.length}):`);
    for (const s of sources) console.log(`      ${s}`);
  }
  console.log(`  • config micSource: ${cfg.audio.micSource || "(üres — rendszer-default)"}`);
  console.log(`  • config monitorSource: ${cfg.audio.monitorSource || "(üres — @DEFAULT_MONITOR@)"}`);

  // 4. Probe mic + monitor
  if (!which.error) {
    console.log("  • mikrofon-próba (3s)...");
    const mic = await probeSourceRetry(cfg.audio.micSource || undefined, cfg.audio.sampleRate);
    if (!verdict("mikrofon", mic, cfg.audio.sampleRate * 2)) failed = true;

    if (os === "linux") {
      console.log("  • rendszerhang-próba (3s)...");
      const mon = await probeSourceRetry(cfg.audio.monitorSource || "@DEFAULT_MONITOR@", cfg.audio.sampleRate);
      // Silent monitor is normal when nothing is playing — 0 bytes is not.
      if (!verdict("rendszerhang (monitor)", mon, cfg.audio.sampleRate * 2, true)) failed = true;
    }
  }

  console.log(failed
    ? "\n[set-copilot] doctor: HIBA — a fenti ✗ pontokat javítsd a felvétel előtt"
    : "\n[set-copilot] doctor: minden rendben");
  if (failed) process.exit(1);
}
