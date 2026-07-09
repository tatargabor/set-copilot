import { spawn, ChildProcess } from "node:child_process";
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

  const micProc = spawn("parec", micArgs, { stdio: ["ignore", "pipe", "ignore"] });
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
    const sysProc = spawn("parec", sysArgs, { stdio: ["ignore", "pipe", "ignore"] });
    processes.push(sysProc);
    systemStream = sysProc.stdout!;
  }

  return {
    micStream: micProc.stdout!,
    systemStream,
    stop: () => killAll(processes),
  };
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

  const micProc = spawn("sox", micArgs, { stdio: ["ignore", "pipe", "ignore"] });
  const processes: ChildProcess[] = [micProc];

  let systemStream: Readable;
  if (micOnly) {
    systemStream = new Readable({ read() {} });
  } else {
    const sysArgs = [
      "-t", "coreaudio",
      monitorSource || "BlackHole 2ch",
      "-t", "raw",
      "-r", String(sampleRate),
      "-b", "16",
      "-c", "1",
      "-e", "signed-integer",
      "-",
    ];
    const sysProc = spawn("sox", sysArgs, { stdio: ["ignore", "pipe", "ignore"] });
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
      proc.on("close", () => {
        resolve(output.split("\n").filter(Boolean));
      });
    });
  } else if (os === "darwin") {
    return new Promise((resolve) => {
      const proc = spawn("sox", ["--help-device", "coreaudio"], { stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      proc.stderr!.on("data", (d: Buffer) => { output += d.toString(); });
      proc.on("close", () => {
        resolve(output.split("\n").filter(Boolean));
      });
    });
  }
  return [];
}
