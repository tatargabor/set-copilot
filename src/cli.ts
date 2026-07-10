#!/usr/bin/env node
/**
 * set-copilot — voice dictation + meeting copilot for Claude Code.
 *
 * Subcommands:
 *   init                     scaffold skills + config into the current project
 *   capture [--mic-only]     start audio capture + transcription
 *   stop                     stop the running capture (via PID file)
 *   status                   is capture running? how many lines captured?
 *   digest                   (re)build the knowledge index/context/digest
 *   poll [seconds]           long-poll the transcript for the copilot monitor
 *   sources                  list audio input devices
 *   doctor                   audio + env health check (probes real signal)
 *   beep [--end]             play the OS chime (start: single, end: double)
 *   notify <title> [body]    OS desktop notification (--critical for alerts)
 *   path <name>              print a resolved runtime path (skills use this)
 */

import { spawn, spawnSync } from "node:child_process";
import { platform } from "node:os";
import {
  cpSync, existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import {
  loadConfig, CONFIG_FILENAME, keywordIndexPath, enrichedContextPath, digestMarkdownPath,
} from "./config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, "..");

async function main(): Promise<void> {
  const [cmd, ...args] = process.argv.slice(2);
  switch (cmd) {
    case "init": return cmdInit();
    case "capture": {
      const { runCapture } = await import("./capture.js");
      return runCapture({ micOnly: args.includes("--mic-only"), output: flag(args, "--output") });
    }
    case "stop": return cmdStop();
    case "status": return cmdStatus();
    case "digest": {
      const { runDigest } = await import("./knowledge/run-digest.js");
      console.log(await runDigest(loadConfig()));
      return;
    }
    case "poll": {
      const { runPoll } = await import("./poll.js");
      return runPoll(loadConfig(), args[0] ? parseInt(args[0], 10) : 60);
    }
    case "sources": {
      const { listSources } = await import("./audio.js");
      for (const s of await listSources()) console.log(`  ${s}`);
      return;
    }
    case "doctor": {
      const { runDoctor } = await import("./doctor.js");
      return runDoctor(loadConfig());
    }
    case "beep": return void beep(args.includes("--end") ? "end" : "start");
    case "notify": return void notify(args[0] ?? "", args[1] ?? "", args.includes("--critical"));
    case "path": return cmdPath(args[0]);
    case "help": case undefined: return printHelp();
    default:
      console.error(`Unknown command: ${cmd}\n`);
      printHelp();
      process.exit(1);
  }
}

// ---- init ------------------------------------------------------------------

function cmdInit(): void {
  const root = process.cwd();
  const skillsSrc = join(PKG_ROOT, "skills");
  const skillsDest = join(root, ".claude", "skills");
  mkdirSync(skillsDest, { recursive: true });

  let copied = 0;
  for (const name of readdirSync(skillsSrc)) {
    const src = join(skillsSrc, name);
    if (!statSync(src).isDirectory()) continue;
    cpSync(src, join(skillsDest, name), { recursive: true });
    copied++;
  }
  console.log(`✓ Installed ${copied} skills into .claude/skills/ (dictate, dd, ds, meeting-copilot)`);

  const cfgPath = join(root, CONFIG_FILENAME);
  if (existsSync(cfgPath)) {
    console.log(`• ${CONFIG_FILENAME} already exists — left untouched`);
  } else {
    cpSync(join(PKG_ROOT, "set-copilot.config.example.json"), cfgPath);
    console.log(`✓ Wrote ${CONFIG_FILENAME} (edit knowledge.sources for the copilot)`);
  }

  console.log(`
Next steps:
  1. Add SONIOX_API_KEY to your .env (get a key at https://soniox.com)
  2. Pick your microphone:  set-copilot sources  → put the right input into
     ${CONFIG_FILENAME} audio.micSource (empty = system default, which is
     often NOT the mic you speak into)
  3. Verify the chain:  set-copilot doctor  (probes mic + system audio for real signal)
  4. Edit ${CONFIG_FILENAME} — set knowledge.sources to your docs (optional; dictation needs none)
  5. In Claude Code:  /ds  (start dictation) · /dd (stop) · /meeting-copilot start
`);
}

// ---- stop / status ---------------------------------------------------------

function pidFile(): string {
  return join(loadConfig().runtimeDir, "capture.pid");
}

function cmdStop(): void {
  const pf = pidFile();
  if (!existsSync(pf)) {
    beep("end");
    console.log("[set-copilot] No capture running");
    return;
  }
  const pid = parseInt(readFileSync(pf, "utf-8").trim(), 10);
  try {
    process.kill(pid, "SIGTERM");
    // Wait for the capture process to actually exit (max 2s) so its shutdown
    // handler finishes flushing the transcript BEFORE the caller reads it.
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      try { process.kill(pid, 0); } catch { break; } // exited
      sleepMs(25);
    }
    console.log(`[set-copilot] Stopped capture (pid ${pid})`);
  } catch {
    console.log("[set-copilot] Capture already stopped");
  }
  beep("end"); // async — does not delay the caller
}

function cmdStatus(): void {
  const cfg = loadConfig();
  const pf = join(cfg.runtimeDir, "capture.pid");
  let running = false;
  if (existsSync(pf)) {
    const pid = parseInt(readFileSync(pf, "utf-8").trim(), 10);
    try { process.kill(pid, 0); running = true; } catch { running = false; }
  }
  const lines = existsSync(cfg.transcriptOutput)
    ? readFileSync(cfg.transcriptOutput, "utf-8").split("\n").filter(Boolean).length
    : 0;
  console.log(`capture: ${running ? "running" : "stopped"} · transcript lines: ${lines}`);
}

// ---- path ------------------------------------------------------------------

function cmdPath(name?: string): void {
  const cfg = loadConfig();
  const map: Record<string, string> = {
    runtime: cfg.runtimeDir,
    transcript: cfg.transcriptOutput,
    dictation: cfg.dictationOutput,
    keywords: keywordIndexPath(cfg),
    context: enrichedContextPath(cfg),
    digest: digestMarkdownPath(cfg),
  };
  if (!name || !(name in map)) {
    console.error(`Usage: set-copilot path <${Object.keys(map).join("|")}>`);
    process.exit(1);
  }
  console.log(map[name]);
}

// ---- OS-aware feedback -----------------------------------------------------

/**
 * Start = one chime; end = double chime (like a ref calling off the match),
 * so you can tell by ear whether the copilot just started or stopped.
 *
 * Playback is fully async (detached player, unref'd): a chime is ~1.3s and a
 * synchronous beep used to block `stop` for seconds. The CLI must never wait
 * for sound.
 */
function beep(kind: "start" | "end" = "start"): void {
  const os = platform();
  const sound = os === "darwin"
    ? "/System/Library/Sounds/Glass.aiff"
    : "/usr/share/sounds/freedesktop/stereo/complete.oga";
  const player = os === "darwin" ? "afplay" : "paplay";

  if ((os !== "darwin" && os !== "linux") || !existsSync(sound)) {
    process.stdout.write(kind === "end" ? "\x07\x07" : "\x07");
    return;
  }
  const script = kind === "end"
    ? `${player} '${sound}'; ${player} '${sound}'`
    : `${player} '${sound}'`;
  try {
    spawn("sh", ["-c", script], { stdio: "ignore", detached: true }).unref();
  } catch {
    process.stdout.write("\x07");
  }
}

/** Synchronous sleep without burning CPU (used while waiting for capture exit). */
function sleepMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function notify(title: string, body: string, critical: boolean): void {
  const os = platform();
  if (os === "darwin") {
    const script = `display notification ${q(body)} with title ${q(title)}`;
    run("osascript", ["-e", script]);
    if (critical) run("afplay", ["/System/Library/Sounds/Sosumi.aiff"]);
  } else if (os === "linux") {
    run("notify-send", ["-t", "30000", ...(critical ? ["-u", "critical"] : []), title, body]);
    if (critical) run("paplay", ["/usr/share/sounds/freedesktop/stereo/dialog-warning.oga"]);
  }
}

function q(s: string): string {
  return `"${s.replace(/"/g, '\\"')}"`;
}

/** Fire-and-forget spawn; returns false if the binary is missing */
function run(bin: string, args: string[]): boolean {
  const r = spawnSync(bin, args, { stdio: "ignore" });
  if (r.error) {
    // detached fallback attempt for players that fork
    try { spawn(bin, args, { stdio: "ignore", detached: true }).unref(); } catch { return false; }
    return false;
  }
  return r.status === 0;
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function printHelp(): void {
  console.log(`
set-copilot — voice dictation + meeting copilot for Claude Code

  set-copilot init                 scaffold skills + config into this project
  set-copilot capture [--mic-only] start capture (mic-only = dictation)
  set-copilot stop                 stop the running capture
  set-copilot status               capture state + transcript line count
  set-copilot digest               (re)build knowledge index/context/digest
  set-copilot poll [seconds]       long-poll the transcript (copilot monitor)
  set-copilot sources              list audio input devices
  set-copilot doctor               audio + env health check (probes real signal)
  set-copilot beep [--end]         OS chime (start: single, --end: double)
  set-copilot notify <t> [b]       OS desktop notification (--critical)
  set-copilot path <name>          print a resolved runtime path

Config:  ${CONFIG_FILENAME}   ·   Secret:  SONIOX_API_KEY (env / .env)
`);
}

main().catch((err) => {
  console.error("[set-copilot] Fatal:", err);
  process.exit(1);
});
