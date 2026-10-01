import { spawn, ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { Readable } from "node:stream";
import { platform } from "node:os";

export interface AudioCaptureOptions {
  micSource?: string;
  monitorSource?: string;
  sampleRate?: number;
  micOnly?: boolean;
}

export interface DualChannelCapture {
  micStream: Readable;
  systemStream: Readable;
  stop: () => void;
}

/**
 * Captures audio from two sources:
 * - mic: your microphone
 * - system: system audio output (the other party)
 *
 * Linux: uses parec (PulseAudio/PipeWire)
 * macOS: uses sox with CoreAudio (requires BlackHole for system audio)
 */
export function startDualCapture(opts: AudioCaptureOptions = {}): DualChannelCapture {
  const sampleRate = opts.sampleRate || 16000;
  const os = platform();

  if (os === "linux") {
    return startLinuxCapture(sampleRate, opts.micSource, opts.monitorSource, opts.micOnly);
  } else if (os === "darwin") {
    return startMacCapture(sampleRate, opts.micSource, opts.monitorSource, opts.micOnly);
  } else {
    throw new Error(`Unsupported platform: ${os}. Only linux and darwin are supported.`);
  }
}

/**
 * Resolve the parec binary. Prefer the distro binary over whatever shadows it
 * on PATH — a Homebrew/linuxbrew parec built against plain PulseAudio can hang
 * silently against PipeWire (0 bytes forever, no error), which manifests as
 * "connected but never transcribes".
 */
export function parecBin(): string {
  return existsSync("/usr/bin/parec") ? "/usr/bin/parec" : "parec";
}

/**
 * Resolve the sox binary. On macOS, GUI/background-launched processes frequently
 * do NOT inherit the Homebrew bin dir on PATH, so a bare `spawn("sox")` fails with
 * ENOENT ("spawn sox ENOENT") even though sox is installed — and the capture then
 * flows 0 bytes with no obvious cause. Probe the common Homebrew locations first,
 * then fall back to PATH.
 */
export function soxBin(): string {
  for (const p of ["/opt/homebrew/bin/sox", "/usr/local/bin/sox"]) {
    if (existsSync(p)) return p;
  }
  return "sox";
}

function startLinuxCapture(
  sampleRate: number,
  micSource?: string,
  monitorSource?: string,
  micOnly?: boolean,
): DualChannelCapture {
  const micArgs = [
    "--format=s16le",
    "--rate", String(sampleRate),
    "--channels=1",
    ...(micSource ? ["--device", micSource] : []),
  ];

  const micProc = spawn(parecBin(), micArgs, { stdio: ["ignore", "pipe", "pipe"] });
  wireProcDiagnostics(micProc, "mic");
  const processes: ChildProcess[] = [micProc];

  let systemStream: Readable;
  if (micOnly) {
    systemStream = new Readable({ read() {} });
  } else {
    const sysArgs = [
      "--format=s16le",
      "--rate", String(sampleRate),
      "--channels=1",
      ...(monitorSource ? ["--device", monitorSource] : ["--device", getDefaultMonitor()]),
    ];
    const sysProc = spawn(parecBin(), sysArgs, { stdio: ["ignore", "pipe", "pipe"] });
    wireProcDiagnostics(sysProc, "sys");
    processes.push(sysProc);
    systemStream = sysProc.stdout!;
  }

  return {
    micStream: micProc.stdout!,
    systemStream,
    stop: () => killAll(processes),
  };
}

/**
 * Audio processes must not die silently: surface stderr and unexpected exits.
 * Without this, a failed parec/sox leaves the Soniox connection "connected"
 * with zero audio and an empty transcript — undebuggable from the outside.
 */
function wireProcDiagnostics(proc: ChildProcess, label: string, failHint?: string): void {
  let hintShown = false;
  const showHint = () => {
    if (failHint && !hintShown) {
      hintShown = true;
      console.error(`[set-copilot] ${label}: ${failHint}`);
    }
  };
  proc.stderr?.on("data", (d: Buffer) => {
    const line = d.toString().trim();
    if (line) console.error(`[set-copilot] ${label} capture stderr: ${line}`);
    // A device that cannot be opened is a setup issue, not a transient error —
    // surface the actionable hint next to the raw sox message.
    if (/can ?not open|can't open|no such/i.test(line)) showHint();
  });
  proc.on("exit", (code, signal) => {
    if (code !== 0 && signal !== "SIGTERM") {
      console.error(`[set-copilot] ${label} capture process exited (code=${code}, signal=${signal}) — no more audio from this source`);
      showHint();
    }
  });
  proc.on("error", (err) => {
    console.error(`[set-copilot] ${label} capture spawn failed: ${err.message}`);
    showHint();
  });
}

function startMacCapture(
  sampleRate: number,
  micSource?: string,
  monitorSource?: string,
  micOnly?: boolean,
): DualChannelCapture {
  const micArgs = [
    "-t", "coreaudio",
    micSource || "default",
    "-t", "raw",
    "-r", String(sampleRate),
    "-b", "16",
    "-c", "1",
    "-e", "signed-integer",
    "-",
  ];

  const micProc = spawn(soxBin(), micArgs, { stdio: ["ignore", "pipe", "pipe"] });
  wireProcDiagnostics(micProc, "mic");
  const processes: ChildProcess[] = [micProc];

  let systemStream: Readable;
  if (micOnly) {
    systemStream = new Readable({ read() {} });
  } else {
    const sysDevice = monitorSource || "BlackHole 2ch";
    const sysArgs = [
      "-t", "coreaudio",
      sysDevice,
      "-t", "raw",
      "-r", String(sampleRate),
      "-b", "16",
      "-c", "1",
      "-e", "signed-integer",
      "-",
    ];
    const sysProc = spawn(soxBin(), sysArgs, { stdio: ["ignore", "pipe", "pipe"] });
    // System audio needs a virtual loopback device (BlackHole/Loopback). When it is
    // absent, sox fails to open it — mic capture still works, so continue mic-only
    // instead of leaving the user with a cryptic device error and no context.
    wireProcDiagnostics(sysProc, "sys", `system audio device "${sysDevice}" could not be opened — capturing mic only. Install BlackHole and route output to it (see README), or set monitorSource in the config, to capture the other party.`);
    processes.push(sysProc);
    systemStream = sysProc.stdout!;
  }

  return {
    micStream: micProc.stdout!,
    systemStream,
    stop: () => killAll(processes),
  };
}

function getDefaultMonitor(): string {
  // PipeWire/PulseAudio: the default monitor source captures all system output
  // Users can override via MONITOR_SOURCE env var
  return "@DEFAULT_MONITOR@";
}

function killAll(processes: ChildProcess[]): void {
  for (const proc of processes) {
    if (!proc.killed) {
      proc.kill("SIGTERM");
    }
  }
}

export interface InputGain {
  /** Source name as PulseAudio knows it. */
  source: string;
  /** Volume in percent — 100 is unity. */
  percent: number;
  muted: boolean;
}

/**
 * Read the PulseAudio input gain of a capture source.
 *
 * Worth a subprocess at startup because a drifting gain is a RECURRING cause of
 * empty transcripts: conferencing apps adjust the per-device input volume and leave
 * it there, and at ~60% this mic's speech landed at rms 68 — under anything an STT
 * backend can work with. The capture used to have no way to say that; it just went
 * quiet. Linux/PulseAudio only — everywhere else this returns null and the caller
 * simply does not warn.
 */
export async function readInputGain(source?: string): Promise<InputGain | null> {
  if (platform() !== "linux") return null;
  return new Promise((resolve) => {
    const proc = spawn("pactl", ["list", "sources"], { stdio: ["ignore", "pipe", "ignore"] });
    let output = "";
    proc.stdout!.on("data", (d: Buffer) => { output += d.toString(); });
    proc.on("error", () => resolve(null)); // no pactl — nothing to report
    proc.on("close", () => resolve(parseInputGain(output, source)));
  });
}

/**
 * Pull one source's volume and mute state out of `pactl list sources`.
 *
 * Without an explicit source name there is no reliable "the one we are recording"
 * in this output, so we decline rather than warn about the wrong device.
 */
export function parseInputGain(pactlOutput: string, source?: string): InputGain | null {
  if (!source) return null;
  const blocks = pactlOutput.split(/\n(?=Source #)/);
  for (const block of blocks) {
    const name = block.match(/^\s*Name:\s*(.+)$/m)?.[1]?.trim();
    if (name !== source) continue;
    const percent = block.match(/^\s*Volume:.*?(\d+)%/m)?.[1];
    const muted = /^\s*Mute:\s*yes/m.test(block);
    if (percent === undefined) return null;
    return { source, percent: Number(percent), muted };
  }
  return null;
}

/**
 * Parse `system_profiler SPAudioDataType -json` into CoreAudio **input** device
 * names, default input first.
 *
 * Kept pure and exported so the macOS device list is unit-testable — the shape
 * is Apple's, undocumented, and has moved before; a parser that only ever runs
 * against one machine's hardware is a parser nobody can verify.
 *
 * An entry is an input iff it declares `coreaudio_device_input` (channel count).
 * Output-only devices carry `coreaudio_device_output` instead and must not be
 * offered as a `micSource`.
 */
export function parseMacInputDevices(json: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  const groups = (parsed as { SPAudioDataType?: unknown })?.SPAudioDataType;
  if (!Array.isArray(groups)) return [];

  const inputs: { name: string; isDefault: boolean }[] = [];
  // The tree is one level deeper on some macOS versions (a "Devices" group that
  // holds the real entries), so walk `_items` recursively rather than indexing.
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    if (!node || typeof node !== "object") return;
    const item = node as Record<string, unknown>;
    const name = typeof item._name === "string" ? item._name : undefined;
    if (name && item.coreaudio_device_input !== undefined) {
      inputs.push({ name, isDefault: item.coreaudio_default_audio_input_device !== undefined });
    }
    if (item._items !== undefined) walk(item._items);
  };
  walk(groups);

  // Default first: it is the name `micSource: ""` already resolves to, so seeing
  // it at the top is what tells the reader their config is already correct.
  inputs.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  // The bare name comes first on the line so it stays copy-pasteable into micSource.
  return inputs.map((d) => (d.isDefault ? `${d.name}  (default input)` : d.name));
}

/**
 * List available audio sources (for config discovery)
 */
export async function listSources(): Promise<string[]> {
  const os = platform();
  if (os === "linux") {
    return new Promise((resolve) => {
      const proc = spawn("pactl", ["list", "sources", "short"], { stdio: ["ignore", "pipe", "ignore"] });
      let output = "";
      proc.stdout!.on("data", (d: Buffer) => { output += d.toString(); });
      // Missing binary emits an unhandled 'error' event that would crash the
      // process — swallow it and report no sources instead.
      proc.on("error", () => resolve([]));
      proc.on("close", () => {
        resolve(output.split("\n").filter(Boolean));
      });
    });
  } else if (os === "darwin") {
    // NOT `sox --help-device coreaudio`: current Homebrew sox builds reject the
    // flag outright ("getopt: parameter not recognized from `--help-device'"),
    // so the old implementation returned sox's own usage error as if it were a
    // device list — two bogus "sources" and the real mic nowhere in sight.
    // system_profiler is the OS's own answer and needs no third-party binary.
    return new Promise((resolve) => {
      const proc = spawn("system_profiler", ["SPAudioDataType", "-json"], { stdio: ["ignore", "pipe", "ignore"] });
      let output = "";
      proc.stdout!.on("data", (d: Buffer) => { output += d.toString(); });
      // Missing binary emits an unhandled 'error' event that would crash the
      // process — swallow it and report no sources instead.
      proc.on("error", () => resolve([]));
      proc.on("close", () => resolve(parseMacInputDevices(output)));
    });
  }
  return [];
}
