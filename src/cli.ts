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
 *   beep                     play the OS start/stop chime
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
  2. Edit ${CONFIG_FILENAME} — set knowledge.sources to your docs (optional; dictation needs none)
  3. In Claude Code:  /ds  (start dictation) · /dd (stop) · /meeting-copilot start
`);
}

// ---- stop / status ---------------------------------------------------------

function pidFile(): string {
  return join(loadConfig().runtimeDir, "capture.pid");
}

function cmdStop(): void {
  beep("end");
  const pf = pidFile();
  if (!existsSync(pf)) {
    console.log("[set-copilot] No capture running");
    return;
  }
  const pid = parseInt(readFileSync(pf, "utf-8").trim(), 10);
  try {
    process.kill(pid, "SIGTERM");
    console.log(`[set-copilot] Stopped capture (pid ${pid})`);
  } catch {
    console.log("[set-copilot] Capture already stopped");
  }
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
 */
function beep(kind: "start" | "end" = "start"): void {
  const os = platform();
  const times = kind === "end" ? 2 : 1;
  for (let i = 0; i < times; i++) {
    if (i > 0) sleepMs(180);
    if (os === "darwin") {
      run("afplay", ["/System/Library/Sounds/Glass.aiff"]);
    } else if (os === "linux") {
      if (!run("paplay", ["/usr/share/sounds/freedesktop/stereo/complete.oga"])) {
        process.stdout.write("\x07");
      }
    } else {
      process.stdout.write("\x07");
    }
  }
}

/** Synchronous pause between the two end-chimes (CLI exits right after). */
function sleepMs(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) { /* busy-wait, <200ms */ }
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
