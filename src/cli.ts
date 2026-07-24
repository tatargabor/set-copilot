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
 *   prompt                   print the copilot policy (alert categories + instructions)
 *   poll [seconds]           long-poll the transcript for the copilot monitor
 *   wall [--port N] [--no-fake-feed] [--reset]  start the local monitor-wall display server
 *   wall-stop                stop the wall serving this runtime dir (via wall.pid)
 *   wall-shot <url>          screenshot a URL (headless Chromium) onto the wall
 *   sources                  list audio input devices
 *   doctor                   audio + env health check (probes real signal)
 *   beep [--end]             play the OS chime (start: single, end: double)
 *   notify <title> [body]    OS desktop notification (--critical for alerts)
 *   path <name>              print a resolved runtime path (skills use this)
 */

import { spawn, spawnSync } from "node:child_process";
import { homedir, platform } from "node:os";
import {
  cpSync, existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, statSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";

import {
  loadConfig, userConfigDir, CONFIG_FILENAME, keywordIndexPath, enrichedContextPath,
  digestMarkdownPath, type CopilotConfig,
} from "./config.js";
import { handoverTranscriptOnce, lastTranscript, printTranscriptOnce } from "./handover.js";
import { playTone } from "./tones.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, "..");

async function main(): Promise<void> {
  const [cmd, ...args] = process.argv.slice(2);
  switch (cmd) {
    case "init": return cmdInit(args.includes("--global"));
    case "capture": {
      const { runCapture } = await import("./capture.js");
      const maxMinutesRaw = flag(args, "--max-minutes");
      return runCapture({
        micOnly: args.includes("--mic-only"),
        output: flag(args, "--output"),
        maxMinutes: maxMinutesRaw ? parseFloat(maxMinutesRaw) : undefined,
      });
    }
    case "stop": return cmdStop(args.includes("--print"));
    case "status": return cmdStatus();
    case "digest": {
      const { runDigest } = await import("./knowledge/run-digest.js");
      console.log(await runDigest(loadConfig()));
      return;
    }
    case "prompt": {
      const { renderCopilotPrompt } = await import("./copilot-prompt.js");
      process.stdout.write(renderCopilotPrompt(loadConfig()));
      return;
    }
    case "poll": {
      const { runPoll } = await import("./poll.js");
      return runPoll(loadConfig(), args[0] ? parseInt(args[0], 10) : 60);
    }
    case "wall": {
      const { runWall } = await import("./wall/index.js");
      const portRaw = flag(args, "--port");
      await runWall(loadConfig(), {
        port: portRaw ? parseInt(portRaw, 10) : undefined,
        fakeFeed: !args.includes("--no-fake-feed"),
        reset: args.includes("--reset"),
      });
      return; // server keeps the process alive; Ctrl-C stops it
    }
    case "wall-stop": return cmdWallStop();
    case "wall-shot": return cmdWallShot(args);
    case "wall-emit": {
      // A producer's hand on the wall: push a DisplayEvent (or a JSON array of them)
      // onto the canonical events log. The producer is a fork of the main session
      // (fork-wall-producer D1), so this seam is the only way anything reaches the
      // wall. JSON comes from the first argument, or from stdin when none is given.
      const { emitWallEvents } = await import("./wall/emit.js");
      const positional = args.find((a) => !a.startsWith("-"));
      let payload = positional;
      if (!payload) {
        const { readFileSync } = await import("node:fs");
        try { payload = readFileSync(0, "utf-8").trim(); } catch { payload = ""; }
      }
      if (!payload) {
        console.error('Usage: set-copilot wall-emit \'{"category":"súgás","zone":"private","text":"…"}\'  (or a JSON array, or pipe JSON on stdin)');
        process.exit(1);
      }
      let parsed: unknown;
      try { parsed = JSON.parse(payload); } catch (e) {
        console.error(`[wall-emit] invalid JSON: ${(e as Error).message}`);
        process.exit(1);
      }
      const res = emitWallEvents(loadConfig(), parsed);
      for (const d of res.dropped) console.error(`[wall-emit] dropped: ${d.reason}`);
      console.log(`[wall-emit] emitted ${res.emitted}${res.dropped.length ? `, dropped ${res.dropped.length}` : ""}`);
      if (res.emitted === 0) process.exit(1);
      return;
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

/**
 * Project init writes into ./.claude + ./set-copilot.config.json.
 * Global init (--global) writes into ~/.claude/skills + the user config dir, so
 * /ds works from any cwd — the secret and mic live there once, not per project.
 */
function cmdInit(global = false): void {
  const cfgHome = userConfigDir();
  const skillsDest = global
    ? join(homedir(), ".claude", "skills")
    : join(process.cwd(), ".claude", "skills");
  const cfgPath = join(global ? cfgHome : process.cwd(), CONFIG_FILENAME);

  const skillsSrc = join(PKG_ROOT, "skills");
  mkdirSync(skillsDest, { recursive: true });

  let copied = 0;
  for (const name of readdirSync(skillsSrc)) {
    const src = join(skillsSrc, name);
    if (!statSync(src).isDirectory()) continue;
    cpSync(src, join(skillsDest, name), { recursive: true });
    copied++;
  }
  console.log(`✓ Installed ${copied} skills into ${skillsDest} (dictate, dd, ds, meeting-copilot)`);

  mkdirSync(cfgHome, { recursive: true });
  if (existsSync(cfgPath)) {
    console.log(`• ${cfgPath} already exists — left untouched`);
  } else {
    cpSync(join(PKG_ROOT, "set-copilot.config.example.json"), cfgPath);
    console.log(`✓ Wrote ${cfgPath}`);
  }

  const envPath = join(cfgHome, ".env");
  if (existsSync(envPath)) {
    console.log(`• ${envPath} already exists — left untouched`);
  } else {
    writeFileSync(envPath, "SONIOX_API_KEY=\n", { mode: 0o600 });
    console.log(`✓ Wrote ${envPath} — put your Soniox key in it`);
  }

  console.log(`
Next steps:
  1. Put SONIOX_API_KEY into ${envPath} (get a key at https://soniox.com).
     It is the fallback for every project — a project-local .env overrides it.
  2. Pick your microphone:  set-copilot sources  → put the right input into
     ${cfgPath} audio.micSource (empty = system default, which is
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

function cmdStop(print = false): void {
  const cfg = loadConfig();
  const pf = pidFile();
  if (!existsSync(pf)) {
    // No chime here: `stop` runs on every SessionEnd (including /clear), so a stop
    // that found nothing to stop must stay silent — otherwise every /clear beeps.
    console.log("[set-copilot] No capture running");
    // A capture that hit its --max-minutes limit removed its own PID file, but its
    // transcript is still waiting to be handed over — so hand over even with nothing to kill.
    handoverAtStop(cfg, print);
    return;
  }
  const pid = parseInt(readFileSync(pf, "utf-8").trim(), 10);
  try {
    process.kill(pid, "SIGTERM");
    // Wait for the capture process to actually exit so its shutdown handler finishes
    // flushing the transcript BEFORE the caller reads it. The budget must cover the
    // Soniox end-of-stream round-trip (finalize(), up to 6s) — the old 2s cut the
    // flush off and the caller printed a transcript missing its last words.
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      try { process.kill(pid, 0); } catch { break; } // exited
      sleepMs(25);
    }
    console.log(`[set-copilot] Stopped capture (pid ${pid})`);
  } catch {
    console.log("[set-copilot] Capture already stopped");
  }
  beep("end"); // async — does not delay the caller
  handoverAtStop(cfg, print);
}

/**
 * Hand the just-stopped transcript over exactly once. Dictation (`--print`) emits
 * the contents as the user's message; the meeting path archives WITHOUT reprinting
 * and reports where the file landed — so the copilot flow never replays the whole
 * transcript into the session as if freshly spoken, yet can still point a
 * post-meeting step at the saved artifact.
 */
function handoverAtStop(cfg: CopilotConfig, print: boolean): void {
  if (print) { printTranscriptOnce(cfg); return; }
  const saved = handoverTranscriptOnce(cfg);
  console.log(saved
    ? `[set-copilot] Transcript saved: ${saved}`
    : "[set-copilot] Nothing to hand over");
}

// ---- wall lifecycle --------------------------------------------------------

/**
 * Stop the wall serving this runtime dir, found through `wall.pid` — the same
 * PID-file discipline `stop` uses for capture, so a `/meeting-copilot stop` can
 * tear down exactly the wall this session started and never another project's.
 * The wall removes its own pid/url on a clean exit; we clean up too in case it
 * was already dead (a stale claim would otherwise refuse the next start).
 */
function cmdWallStop(): void {
  const cfg = loadConfig();
  const pf = join(cfg.runtimeDir, "wall.pid");
  if (!existsSync(pf)) { console.log("[set-copilot] No wall running"); return; }
  const pid = parseInt(readFileSync(pf, "utf-8").trim(), 10);
  try {
    process.kill(pid, "SIGTERM");
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      try { process.kill(pid, 0); } catch { break; } // exited
      sleepMs(25);
    }
    console.log(`[set-copilot] Stopped wall (pid ${pid})`);
  } catch {
    console.log("[set-copilot] Wall already stopped");
  }
  try { rmSync(pf, { force: true }); } catch { /* best effort */ }
  try { rmSync(join(cfg.runtimeDir, "wall.url"), { force: true }); } catch { /* best effort */ }
}

/** Chromium/Chrome binaries we try, in preference order, for `wall-shot`. */
const BROWSER_BINS = ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable", "chrome"];

function findBrowser(): string | undefined {
  for (const bin of BROWSER_BINS) {
    const r = spawnSync(bin, ["--version"], { stdio: "ignore" });
    if (!r.error && r.status === 0) return bin;
  }
  return undefined;
}

/**
 * Screenshot a URL with headless Chromium and put it on the wall as an `image`.
 *
 * This is the answer to pages that refuse to be iframed (`X-Frame-Options` /
 * `CSP frame-ancestors` — news sites, Google, banks): render to a PNG server-side
 * and show the picture, which works for ANY page because there is no frame. The
 * wall is display-not-runtime anyway, so a static shot loses nothing that the
 * iframe path offered (its sandboxed frame is unreadable and non-interactive too).
 *
 * The PNG lands under the runtime dir and is emitted as a project-relative path,
 * because the wall's `/media` only serves files inside the project root. With the
 * scoped runtime dir (`$PWD/.set/copilot/$SESSION`) that holds; a shot taken
 * against the shared `/tmp` runtime dir is outside the project and the emit will
 * report the confinement rejection rather than serve it.
 */
async function cmdWallShot(args: string[]): Promise<void> {
  const cfg = loadConfig();
  const url = args.find((a) => !a.startsWith("-"));
  if (!url) {
    console.error("Usage: set-copilot wall-shot <url> [--category <id>] [--zone both|private|public] [--caption <text>]");
    process.exit(1);
  }
  const category = flag(args, "--category") ?? "architektúra";
  const zone = flag(args, "--zone") ?? "both";
  const caption = flag(args, "--caption");

  const bin = findBrowser();
  if (!bin) {
    console.error(`[wall-shot] no headless browser found — install Chromium or Google Chrome (tried: ${BROWSER_BINS.join(", ")})`);
    process.exit(1);
  }

  const shotsDir = join(cfg.runtimeDir, "shots");
  mkdirSync(shotsDir, { recursive: true });
  const png = join(shotsDir, `shot-${Date.now()}.png`);

  // `--headless=new` is the modern headless; `--no-sandbox` keeps it working in the
  // containerized/root environments a copilot often runs in. A hard timeout stops a
  // page that never settles from hanging the command.
  const r = spawnSync(bin, [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
    "--window-size=1280,800", `--screenshot=${png}`, url,
  ], { stdio: "ignore", timeout: 45_000 });
  if (r.status !== 0 || !existsSync(png)) {
    console.error(`[wall-shot] screenshot failed (${bin} exit ${r.status ?? "timeout/signal"})`);
    process.exit(1);
  }

  const rel = relative(cfg.projectRoot, png);
  const { emitWallEvents } = await import("./wall/emit.js");
  const image: Record<string, unknown> = { src: rel };
  if (caption) image.caption = caption;
  const res = emitWallEvents(cfg, { category, zone, priority: "immediate", image });
  for (const d of res.dropped) console.error(`[wall-shot] dropped: ${d.reason}`);
  if (res.emitted === 0) process.exit(1);
  console.log(`[wall-shot] ${url} → ${rel} (emitted to '${category}')`);
}

function cmdStatus(): void {
  const cfg = loadConfig();
  const pf = join(cfg.runtimeDir, "capture.pid");
  let running = false;
  if (existsSync(pf)) {
    const pid = parseInt(readFileSync(pf, "utf-8").trim(), 10);
    try { process.kill(pid, 0); running = true; } catch { running = false; }
  }
  // The capture records which file it writes — dictation and meeting mode differ.
  const out = lastTranscript(cfg);
  const lines = existsSync(out)
    ? readFileSync(out, "utf-8").split("\n").filter(Boolean).length
    : 0;
  console.log(`capture: ${running ? "running" : "stopped"} · transcript: ${out} (${lines} lines)`);
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
    "wall-url": join(cfg.runtimeDir, "wall.url"),
    "wall-pid": join(cfg.runtimeDir, "wall.pid"),
  };
  if (!name || !(name in map)) {
    console.error(`Usage: set-copilot path <${Object.keys(map).join("|")}>`);
    process.exit(1);
  }
  console.log(map[name]);
}

// ---- OS-aware feedback -----------------------------------------------------

/**
 * Start = rising motif, end = falling motif — direction tells you by ear
 * whether the session just started or stopped. Playback never blocks.
 * Custom sounds via config audio.toneStart / audio.toneEnd.
 */
function beep(kind: "start" | "end" = "start"): void {
  let custom: string | undefined;
  try {
    const cfg = loadConfig();
    custom = kind === "start" ? cfg.audio.toneStart : cfg.audio.toneEnd;
  } catch { /* no config — use the built-in tone */ }
  playTone(kind, custom || undefined);
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

  set-copilot init [--global]      scaffold skills + config into this project
                                   (--global: ~/.claude/skills + user config dir,
                                   so /ds works from any directory)
  set-copilot capture [--mic-only] [--max-minutes N]
                                   start capture (mic-only = dictation; plays the
                                   rising tone when live, self-stops after N min)
  set-copilot stop [--print]       stop the running capture (--print: also emit the
                                   transcript, then archive it so it is handed over
                                   exactly once)
  set-copilot status               capture state + transcript line count
  set-copilot digest               (re)build knowledge index/context/digest
  set-copilot prompt               print the copilot policy the skill loads
                                   (alert categories + copilot.instructions)
  set-copilot poll [seconds]       long-poll the transcript (copilot monitor)
  set-copilot wall [--port N] [--no-fake-feed]
                                   start the local monitor-wall display (SSE);
                                   prints window URLs. On a taken port it walks to
                                   the next free one; writes wall.pid + wall.url.
                                   Fake-feed on by default
  set-copilot wall-stop            stop the wall serving this runtime dir (wall.pid)
  set-copilot wall-emit '<json>'   push a DisplayEvent (or JSON array) onto the
                                   wall — the main session's producer seam (D9)
  set-copilot wall-shot <url> [--category id] [--zone z] [--caption t]
                                   headless-Chromium screenshot of <url> onto the
                                   wall as an image (for pages that block iframing)
  set-copilot sources              list audio input devices
  set-copilot doctor               audio + env health check (probes real signal)
  set-copilot beep [--end]         OS chime (start: single, --end: double)
  set-copilot notify <t> [b]       OS desktop notification (--critical)
  set-copilot path <name>          print a resolved runtime path

Config:  ./${CONFIG_FILENAME}  →  ${join(userConfigDir(), CONFIG_FILENAME)}
Secret:  SONIOX_API_KEY  (env  →  ./.env  →  ${join(userConfigDir(), ".env")})
`);
}

main().catch((err) => {
  console.error("[set-copilot] Fatal:", err);
  process.exit(1);
});
