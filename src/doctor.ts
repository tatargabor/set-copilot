/**
 * `set-copilot doctor` — environment + audio + setup health check.
 *
 * Answers the question the hard way learned on 2026-07-10: "capture says
 * connected, transcript stays empty — why?" It probes the actual audio chain
 * (binary → device → bytes → signal) instead of guessing.
 *
 * Since 2026-07-29 it also answers the two questions that went unanswered through two
 * live meetings on 2026-07-28: "is this config still doing what it says?" and "can the
 * chat→wall mirror actually fire?" Both were diagnosable from files already on disk;
 * nothing reported them. This file does the READING; `diagnostics.ts` does the deciding.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

import { CONFIG_FILENAME, userConfigDir, type CopilotConfig } from "./config.js";
import { listSources, parecBin, soxBin } from "./audio.js";
import {
  diagnoseConfig, diagnoseMirror, stopHookRegistered,
  type Finding, type HookSource, type MirrorReport, type RawConfigFile,
} from "./diagnostics.js";

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
    const bin = os === "darwin" ? soxBin() : parecBin();
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

// ---- collectors (file access only — no diagnosis, see diagnostics.ts D1) ----

/** The hook script the chat→wall mirror runs; matched by basename, never by full command. */
const HOOK_SCRIPT = "wall-mirror.sh";

/** One config file with the metadata the report prints alongside its findings. */
export interface ConfigFileState extends RawConfigFile {
  exists: boolean;
  /** Last-modified time, so "how old is this?" is answerable at a glance. */
  mtime?: Date;
}

export interface ConfigState {
  files: ConfigFileState[];
  envRuntimeDir?: string;
  hasWall: boolean;
}

function readConfigFileState(path: string): ConfigFileState {
  if (!existsSync(path)) return { path, exists: false };
  let mtime: Date | undefined;
  try { mtime = statSync(path).mtime; } catch { /* unreadable stat is not worth a finding */ }
  try {
    return { path, exists: true, mtime, data: JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown> };
  } catch (err) {
    return { path, exists: true, mtime, parseError: (err as Error).message };
  }
}

/**
 * Does this project actually use a wall? Only then is a missing `wall` section worth a
 * line — on a dictation-only project the built-in defaults being in force is not news.
 *
 * Evidence a wall actually RAN — artifacts in the runtime dir or in any session-scoped
 * dir the skills created. Deliberately not "the meeting-copilot skill is installed":
 * every `init` installs it, so that would make a fresh project's first `init` report a
 * missing `wall` section, which is the "operators stop reading" failure mode.
 */
function projectUsesWall(cfg: CopilotConfig): boolean {
  // Only PROJECT-scoped evidence counts. The default runtime dir (`/tmp/set-copilot`) is
  // shared across every project on the machine, so a wall another project ran leaves
  // artifacts there that say nothing about this one.
  if (cfg.runtimeDir.startsWith(cfg.projectRoot)
    && (existsSync(join(cfg.runtimeDir, "wall.pid")) || existsSync(join(cfg.runtimeDir, "wall-events.jsonl")))) {
    return true;
  }
  const scoped = join(cfg.projectRoot, ".set", "copilot");
  try {
    for (const entry of readdirSync(scoped)) {
      if (existsSync(join(scoped, entry, "wall-events.jsonl"))) return true;
    }
  } catch { /* no scoped dir yet */ }
  return false;
}

/** Read both config files that participate in resolution, plus the context the diagnosis needs. */
export function collectConfigState(cfg: CopilotConfig): ConfigState {
  const userPath = join(userConfigDir(), CONFIG_FILENAME);
  const projPath = join(cfg.projectRoot, CONFIG_FILENAME);
  const files = [readConfigFileState(userPath)];
  if (projPath !== userPath) files.push(readConfigFileState(projPath));
  return {
    files,
    envRuntimeDir: process.env.SET_COPILOT_DIR || undefined,
    hasWall: projectUsesWall(cfg),
  };
}

/** Is a process alive? Signal 0 asks without touching it — the same check `wall-stop` makes. */
function pidAlive(pidPath: string): boolean {
  if (!existsSync(pidPath)) return false;
  const pid = parseInt(readFileSync(pidPath, "utf-8").trim(), 10);
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/** Read one settings.json and answer only "is the hook registered?" — parse failure is "unknown", never "missing". */
function hookSource(path: string): HookSource {
  if (!existsSync(path)) return { path, registered: false };
  try {
    return { path, registered: stopHookRegistered(JSON.parse(readFileSync(path, "utf-8")), HOOK_SCRIPT) };
  } catch {
    return { path, registered: "unknown" };
  }
}

/**
 * Collect the mirror's three preconditions.
 *
 * `cfg.runtimeDir` is already resolved exactly as capture resolves it
 * (`SET_COPILOT_DIR` → config → default), and the report prints it: the marker and the
 * wall are scoped to that dir, so a scope mismatch is itself a common cause of "the
 * mirror does nothing" and must be visible rather than inferred.
 */
export function collectMirrorState(cfg: CopilotConfig): MirrorReport {
  const projClaude = join(cfg.projectRoot, ".claude");
  const userClaude = join(homedir(), ".claude");
  return diagnoseMirror({
    hookCommands: [hookSource(join(projClaude, "settings.json")), hookSource(join(userClaude, "settings.json"))],
    scriptExists:
      existsSync(join(projClaude, "hooks", HOOK_SCRIPT)) || existsSync(join(userClaude, "hooks", HOOK_SCRIPT)),
    markerExists: existsSync(join(cfg.runtimeDir, "wall-mirror.enabled")),
    wallRunning: pidAlive(join(cfg.runtimeDir, "wall.pid")),
    runtimeDir: cfg.runtimeDir,
  });
}

// ---- rendering --------------------------------------------------------------

function formatMtime(mtime: Date | undefined): string {
  if (!mtime) return "ismeretlen dátum";
  const days = Math.floor((Date.now() - mtime.getTime()) / 86_400_000);
  return `${mtime.toISOString().slice(0, 10)}, ${days} napja`;
}

function printFinding(f: Finding): void {
  console.log(`    ${f.level === "warn" ? "⚠" : "•"} ${f.message}`);
  if (f.fix) console.log(`      → ${f.fix}`);
}

/**
 * Render the config section. Findings are ADVISORY — a drifted config does not stop a
 * recording, and `doctor`'s exit code means exactly "you cannot record". Diluting it
 * would make the code useless in scripts (D5), so nothing here touches `failed`.
 */
export function printConfigSection(state: ConfigState): Finding[] {
  console.log("  • config fájlok:");
  for (const f of state.files) {
    console.log(`      ${f.path} — ${f.exists ? formatMtime(f.mtime) : "nincs"}`);
  }
  const findings = diagnoseConfig(state.files, { envRuntimeDir: state.envRuntimeDir, hasWall: state.hasWall });
  if (findings.length) for (const f of findings) printFinding(f);
  else console.log("    ✓ nincs eltérés a config fájlokban");
  return findings;
}

/** Render mirror readiness as the three independent states the operator acts on separately. */
export function printMirrorSection(report: MirrorReport): void {
  console.log(`  • chat→fal tükrözés (runtime dir: ${report.runtimeDir}):`);
  for (const s of [report.hook, report.marker, report.wall]) {
    console.log(`      ${s.ok === true ? "✓" : s.ok === "unknown" ? "?" : "✗"} ${s.message}`);
    if (s.fix) console.log(`        → ${s.fix}`);
  }
  if (report.ready) console.log("    ✓ a tükrözés aktív — nincs teendő");
}

export interface DoctorOptions {
  /** Skip the audio probes, print only mirror readiness, and EXIT NON-ZERO when the hook is unregistered. */
  mirrorOnly?: boolean;
}

export async function runDoctor(cfg: CopilotConfig, opts: DoctorOptions = {}): Promise<void> {
  // `doctor --mirror` is a different contract from `doctor`: a fast, targeted readiness
  // gate whose non-zero exit means "the thing you asked about is not ready". That is what
  // makes it usable as the skill's precondition check before it writes the opt-in marker.
  if (opts.mirrorOnly) {
    const report = collectMirrorState(cfg);
    printMirrorSection(report);
    // The gate is hook registration ONLY: at enable time the wall legitimately may not be
    // running yet and the marker is what we are about to write. "unknown" is not a pass —
    // an unreadable settings.json cannot vouch for the hook.
    if (report.hookRegistered !== true) {
      // The fix belongs on THIS line too: the skill reports the CLI's message, and a
      // caller that quotes only the summary must still carry the installing command.
      const fix = report.hook.fix ? ` — javítás: ${report.hook.fix}` : "";
      console.log(`\n[set-copilot] doctor --mirror: a tükrözés nem kapcsolható be — ${report.hook.message}${fix}`);
      process.exit(1);
    }
    console.log("\n[set-copilot] doctor --mirror: a Stop hook regisztrálva — a tükrözés bekapcsolható");
    return;
  }

  let failed = false;
  const os = platform();

  // 1. STT backend credentials/dependencies
  if (cfg.sttBackend === "whisper") {
    const w = spawnSync(cfg.whisper.bin, ["--help"], { stdio: "ignore" });
    if (w.error) {
      console.log(`  ✗ whisper bináris nem futtatható: ${cfg.whisper.bin} — telepítsd (brew install whisper-cpp)`);
      failed = true;
    } else {
      console.log(`  ✓ whisper bináris: ${cfg.whisper.bin}`);
    }
    if (existsSync(cfg.whisper.model)) {
      console.log(`  ✓ whisper modell: ${cfg.whisper.model}`);
    } else {
      console.log(`  ✗ whisper modell hiányzik: ${cfg.whisper.model} — tölts le egyet (pl. ggml-small.en.bin) vagy állítsd a whisper.model / WHISPER_MODEL értéket`);
      failed = true;
    }
  } else if (cfg.sonioxApiKey) {
    console.log("  ✓ SONIOX_API_KEY beállítva");
  } else {
    console.log("  ✗ SONIOX_API_KEY hiányzik (.env vagy környezeti változó)");
    failed = true;
  }

  // 2. Audio binary
  const bin = os === "darwin" ? soxBin() : parecBin();
  const which = spawnSync(bin, ["--version"], { stdio: "ignore" });
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

  // 5. Setup: config drift + mirror readiness. Both are advisory here — they answer
  //    "will this behave as configured?", not "can this machine record?", so neither
  //    touches `failed` (D5). `doctor --mirror` is the gating form.
  const configFindings = printConfigSection(collectConfigState(cfg));
  printMirrorSection(collectMirrorState(cfg));

  // The summary is scoped to what the exit code means — the recording chain. Saying
  // "minden rendben" over a ⚠ above would read as a blanket all-clear and undo the
  // whole point of printing the findings.
  const advisory = configFindings.some((f) => f.level === "warn");
  console.log(failed
    ? "\n[set-copilot] doctor: HIBA — a fenti ✗ pontokat javítsd a felvétel előtt"
    : advisory
      ? "\n[set-copilot] doctor: a felvételi lánc rendben — a fenti ⚠ nem blokkolja a felvételt, de a beállítás nem azt csinálja, amit a config mond"
      : "\n[set-copilot] doctor: minden rendben");
  if (failed) process.exit(1);
}
