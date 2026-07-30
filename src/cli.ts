#!/usr/bin/env node
/**
 * set-copilot — voice dictation + meeting copilot for Claude Code.
 *
 * Subcommands:
 *   init                     scaffold skills + config into the current project
 *   capture [--mic-only]     start audio capture + transcription
 *   stop                     stop the running capture (via PID file)
 *   transcript [--force]     stitch a raw transcript into readable .md + sentence .jsonl
 *                            (skips inputs already recorded in the recovery ledger)
 *   recovery <sub>           the recovery ledger: status [--json] | claim | mark | abandon
 *   status                   is capture running? how many lines captured?
 *   digest                   (re)build the knowledge index/context/digest
 *   prompt                   print the copilot policy (alert categories + instructions)
 *   poll [seconds]           long-poll the transcript for the copilot monitor
 *   wall [--port N] [--no-fake-feed] [--reset]  start the local monitor-wall display server
 *   wall-stop                stop the wall serving this runtime dir (via wall.pid)
 *   wall-shot <url>          screenshot a URL (headless Chromium) onto the wall
 *   wall-layout <route> <id> switch a live window's layout at runtime (geometry only)
 *   mirror-policy [--apply]  print the resolved chat→wall mirror policy as JSON;
 *                            --apply filters a message on stdin by it (exit 3 = drop)
 *   mirror-follow            follow the session transcript and mirror each new message to
 *                            the wall (--once drains and exits; replaces the Stop hook)
 *   sources                  list audio input devices
 *   doctor [--mirror]        audio + env + setup health check (probes real signal);
 *                            --mirror checks only chat→wall readiness and exits non-zero
 *   beep [--end]             play the OS chime (start: single, end: double)
 *   notify <title> [body]    OS desktop notification (--critical for alerts)
 *   path <name>              print a resolved runtime path (skills use this)
 */

import { spawn, spawnSync } from "node:child_process";
import { homedir, platform } from "node:os";
import {
  cpSync, existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, realpathSync, rmSync, statSync,
} from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { basename, dirname, join, relative, resolve } from "node:path";

import {
  loadConfig, userConfigDir, CONFIG_FILENAME, keywordIndexPath, enrichedContextPath,
  digestMarkdownPath, type CopilotConfig,
} from "./config.js";
import { handoverTranscriptOnce, lastTranscript, printTranscriptOnce } from "./handover.js";
import {
  appendEntry, doneEntry, fingerprintFile, isDone, isRecoveryStep, ledgerPath, makeEntry,
  readLedger, stepStatus, RECOVERY_STEPS, STITCH_VERSION,
} from "./recovery-ledger.js";
import {
  formatStats, loadRedactions, parseSpeakerMap, resolveInputs, stitchArtifactsExist, stitchFile,
} from "./transcript-stitch-run.js";
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
    case "transcript": return cmdTranscript(args);
    case "recovery": return cmdRecovery(args);
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
    case "wall-layout": {
      // Reshape a live window's geometry (wall-chat-mirror): switch which named layout a
      // route uses, mid-session, no restart. Appends a `layout` command to the canonical
      // log; the running wall validates the id against its registry and re-derives the grid.
      const positional = args.filter((a) => !a.startsWith("-"));
      const route = positional[0];
      const layout = positional[1];
      if (!route || !layout) {
        console.error('Usage: set-copilot wall-layout <route> <layout-id>   e.g. set-copilot wall-layout /wall mirror');
        process.exit(1);
      }
      const { emitWallEvents } = await import("./wall/emit.js");
      const res = emitWallEvents(loadConfig(), { kind: "layout", route, layout });
      for (const d of res.dropped) console.error(`[wall-layout] dropped: ${d.reason}`);
      if (res.emitted === 0) process.exit(1);
      console.log(`[wall-layout] switched ${route} → ${layout}`);
      return;
    }
    case "mirror-policy": return cmdMirrorPolicy(args.includes("--apply"), args.includes("--json"));
    case "mirror-follow": return cmdMirrorFollow(args);
    case "sources": {
      const { listSources } = await import("./audio.js");
      for (const s of await listSources()) console.log(`  ${s}`);
      return;
    }
    case "doctor": {
      const { runDoctor } = await import("./doctor.js");
      return runDoctor(loadConfig(), { mirrorOnly: args.includes("--mirror") });
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
 * Idempotently add a `Stop` command hook to a Claude Code `settings.json`, preserving
 * every other setting and hook. Returns true if it added the hook, false if an identical
 * command was already registered (so a re-run of `init` neither duplicates nor clobbers).
 *
 * The merge is deliberately conservative: it parses the existing JSON (or starts from
 * `{}`), touches ONLY `hooks.Stop`, and re-serializes. A malformed settings.json is left
 * untouched (returns false with a warning) rather than overwritten — a user's hook config
 * is not something to lose to a parse error.
 */
export function registerStopHook(settingsPath: string, command: string): boolean {
  let settings: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf-8")) as Record<string, unknown>;
    } catch {
      console.warn(`[set-copilot] init: ${settingsPath} is not valid JSON — skipping hook registration`);
      return false;
    }
  }
  const hooks = (settings.hooks ??= {}) as Record<string, unknown>;
  const stop = (hooks.Stop ??= []) as { matcher?: string; hooks?: { type: string; command: string }[] }[];
  // Already present anywhere under Stop? Then this is a re-run — do nothing.
  for (const group of stop) {
    if (group.hooks?.some((h) => h.command === command)) return false;
  }
  // Reuse the empty-matcher group if one exists, else create it.
  let group = stop.find((g) => (g.matcher ?? "") === "");
  if (!group) { group = { matcher: "", hooks: [] }; stop.push(group); }
  (group.hooks ??= []).push({ type: "command", command });
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  return true;
}

/**
 * Idempotently REMOVE every `Stop` hook entry whose command invokes `scriptBasename`,
 * preserving every other setting and hook. Returns true if it removed anything.
 *
 * The inverse of `registerStopHook`, and deliberately as conservative: it matches by
 * basename (as `stopHookRegistered` does, because init writes a different command string for
 * a project than for `--global`, and a user may have wrapped it), it drops a hook group only
 * when removal empties it, and a malformed settings.json is left untouched with a warning
 * rather than rewritten. A stale registration is not cosmetic here: with the follower running,
 * a surviving mirror hook would double-emit every line.
 */
export function unregisterStopHook(settingsPath: string, scriptBasename: string): boolean {
  if (!existsSync(settingsPath)) return false;
  let settings: Record<string, unknown>;
  try {
    settings = JSON.parse(readFileSync(settingsPath, "utf-8")) as Record<string, unknown>;
  } catch {
    console.warn(`[set-copilot] init: ${settingsPath} is not valid JSON — skipping hook removal`);
    return false;
  }
  const hooks = settings.hooks as Record<string, unknown> | undefined;
  const stop = hooks?.Stop as { matcher?: string; hooks?: { type: string; command: string }[] }[] | undefined;
  if (!Array.isArray(stop)) return false;

  let removed = false;
  for (const group of stop) {
    if (!group || !Array.isArray(group.hooks)) continue;
    const keep = group.hooks.filter((h) => !(typeof h?.command === "string" && h.command.includes(scriptBasename)));
    if (keep.length !== group.hooks.length) { group.hooks = keep; removed = true; }
  }
  if (!removed) return false;
  // Drop groups this emptied, but never a group that held something else.
  (hooks as Record<string, unknown>).Stop = stop.filter((g) => (g.hooks?.length ?? 0) > 0);
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  return true;
}

/**
 * Project init writes into ./.claude + ./set-copilot.config.json.
 * Global init (--global) writes into ~/.claude/skills + the user config dir, so
 * /ds works from any cwd — the secret and mic live there once, not per project.
 */
/**
 * Print what the diagnostics see in an already-existing config — the same findings
 * `doctor` reports, so the one command a user runs to set a project up is also the one
 * that tells them the setup rotted. Reads only; a healthy config gets an explicit
 * "no drift found", because the healthy case is also an answer.
 */
async function reportConfigDrift(): Promise<void> {
  const { collectConfigState } = await import("./doctor.js");
  const { diagnoseConfig } = await import("./diagnostics.js");
  let state;
  try {
    state = collectConfigState(loadConfig());
  } catch (err) {
    // A malformed config throws in `loadConfig`. init worked before this check existed
    // and must keep working — report and move on rather than aborting the scaffold.
    console.log(`  ⚠ could not read the existing config: ${(err as Error).message}`);
    return;
  }
  const findings = diagnoseConfig(state.files, { envRuntimeDir: state.envRuntimeDir, hasWall: state.hasWall });
  if (!findings.length) {
    console.log("  ✓ no drift found in the existing config");
    return;
  }
  for (const f of findings) {
    console.log(`  ${f.level === "warn" ? "⚠" : "•"} ${f.message}`);
    if (f.fix) console.log(`    → ${f.fix}`);
  }
}

async function cmdInit(global = false): Promise<void> {
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
  console.log(`✓ Installed ${copied} skills into ${skillsDest} (dictate, dd, ds, meeting-copilot, transcript-recover, set-repair)`);

  // The chat→wall mirror is NO LONGER a Stop hook (wall-mirror-follower): a turn-boundary
  // hook is late by construction and was measured delivering the previous message while the
  // one written 0.2 s earlier never arrived. `mirror-follow` replaces it, so init REMOVES a
  // registration an earlier version added — leaving it would double-emit every line.
  const claudeBase = global ? join(homedir(), ".claude") : join(process.cwd(), ".claude");
  const hooksSrc = join(PKG_ROOT, "hooks");
  if (existsSync(hooksSrc)) {
    const hooksDest = join(claudeBase, "hooks");
    mkdirSync(hooksDest, { recursive: true });
    cpSync(hooksSrc, hooksDest, { recursive: true });
    if (unregisterStopHook(join(claudeBase, "settings.json"), "wall-mirror.sh")) {
      console.log(`✓ Removed the retired wall-mirror Stop hook from ${join(claudeBase, "settings.json")}`);
      console.log(`  → mirroring now runs as \`set-copilot mirror-follow\`, started by /meeting-copilot`);
    }
    // The recovery guard stays a Stop hook: it gates the END of a turn, which is exactly
    // when it has something to say. A recovery review that is never recorded costs a re-read
    // of a whole meeting. Self-gating (`recovery.active`), so a non-recovering session never sees it.
    const guardCmd = global
      ? `bash "${join(hooksDest, "recovery-guard.sh")}"`
      : `bash "$CLAUDE_PROJECT_DIR/.claude/hooks/recovery-guard.sh"`;
    if (registerStopHook(join(claudeBase, "settings.json"), guardCmd)) {
      console.log(`✓ Installed recovery-guard Stop hook into ${join(claudeBase, "settings.json")}`);
    } else {
      console.log(`• recovery-guard Stop hook already registered — left untouched`);
    }
  }

  mkdirSync(cfgHome, { recursive: true });
  if (existsSync(cfgPath)) {
    console.log(`• ${cfgPath} already exists — left untouched`);
    // "Left untouched" is true but not an answer: the 2026-07-28 field failure was a
    // config that init had happily left alone for two weeks while its keywords resolved
    // to zero. So report what the existing file actually does. This path READS ONLY —
    // init still writes nothing here, per "diagnostics report, never repair".
    await reportConfigDrift();
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

// ---- mirror policy ---------------------------------------------------------

/**
 * `mirror-policy` prints the project's resolved chat→wall mirror policy as JSON;
 * `--apply` reads a message on stdin and writes the mirror-ready text, exiting 3 when the
 * policy says this message is not wall material.
 *
 * The judgement itself lives in `mirror-policy.ts` and this is a thin wrapper over it: the
 * follower needs the same decision per message and cannot afford a process spawn on the
 * latency path it exists to shorten, so there is one implementation with two callers rather
 * than two implementations free to disagree. Exit 3 (not 1) survives from the hook era for
 * the same reason it was chosen: a crashing Node exits 1, and conflating the two would make a
 * broken lookup look like a filler verdict.
 *
 * `--apply` prints the chunks separated by a blank line — the WHOLE message, since length
 * control divides rather than truncates. A caller that needs the divisions uses `--json`.
 */
async function cmdMirrorPolicy(apply: boolean, asJson = false): Promise<void> {
  const cfg = loadConfig();
  const p = cfg.copilot.mirror;
  if (!apply) {
    console.log(JSON.stringify({
      enabled: p.enabled, category: p.category, minLength: p.minLength,
      // `maxLength` is the CHUNK budget now, not a ceiling on the message.
      maxLength: p.maxLength, fillerPhrases: p.fillerPhrases, codeBlocks: p.codeBlocks,
    }));
    return;
  }

  const stdin: Buffer[] = [];
  for await (const c of process.stdin) stdin.push(c as Buffer);
  const raw = Buffer.concat(stdin).toString("utf-8");

  const { applyMirrorPolicy } = await import("./mirror-policy.js");
  const verdict = applyMirrorPolicy(raw, p);
  if (verdict.decision !== "emit") {
    if (asJson) console.log(JSON.stringify(verdict));
    process.exit(3);
  }
  if (asJson) { console.log(JSON.stringify(verdict)); return; }
  process.stdout.write(verdict.chunks.join("\n\n"));
}

/**
 * `mirror-follow` — the chat→wall mirror's delivery process (wall-mirror-follower).
 *
 * Follows the session transcript and emits every new assistant text block as it is written.
 * `--once` drains and exits, which is what `stop` uses so the last thing said still reaches
 * the wall before it goes down.
 */
async function cmdMirrorFollow(args: string[]): Promise<void> {
  const cfg = loadConfig();
  const {
    checkMirrorPid, drainMirror, resolveTranscriptPath, startMirrorFollow,
  } = await import("./mirror-follow.js");

  const flag = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  // The runtime dir is named for the session (the skills scope it as
  // `.set/copilot/$CLAUDE_CODE_SESSION_ID`), so its basename is the id unless told otherwise.
  const sessionId = flag("--session") ?? basename(cfg.runtimeDir);
  const resolved = resolveTranscriptPath({
    explicit: flag("--transcript"), sessionId, cwd: cfg.projectRoot ?? process.cwd(),
  });
  if (!resolved.ok) {
    console.error(`[set-copilot] mirror-follow: ${resolved.reason}`);
    process.exit(1);
  }

  const opts = { transcript: resolved.path, force: args.includes("--force") };
  if (args.includes("--once")) {
    const r = drainMirror(cfg, opts);
    console.log(`[set-copilot] mirror drain: ${r.emitted} kiküldve, ${r.suppressed} elnyomva, ${r.considered} vizsgálva`);
    if (r.failure) { console.error(`[set-copilot] mirror: ${r.failure}`); process.exit(1); }
    return;
  }

  // A second follower would orphan the first: the same refusal as a second capture.
  const owner = checkMirrorPid(cfg.runtimeDir);
  if (owner.state === "live") {
    console.error(`[set-copilot] mirror-follow: már fut egy figyelő ehhez a runtime dirhez (pid ${owner.pid})`);
    process.exit(1);
  }

  const handle = startMirrorFollow(cfg, opts);
  console.log(`[set-copilot] mirror-follow: ${resolved.path} (${resolved.how})`);
  const shutdown = (): void => { handle.stop(); process.exit(0); };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

// ---- stop / status ---------------------------------------------------------

/**
 * Deliver what the transcript already holds, then stop the follower.
 *
 * Called from `stop` AND `wall-stop`, because either can be the teardown that ends mirroring,
 * and a message that was written but not yet delivered is exactly the loss this change exists
 * to prevent. Synchronous and bounded: the drain reads a file and appends to another.
 *
 * It reports what it could not deliver instead of exiting as if it had — an undelivered
 * closing summary that nobody mentions is how the mirror looked "fine" for a whole session.
 */
async function drainMirrorAtStop(cfg: CopilotConfig): Promise<void> {
  const marker = join(cfg.runtimeDir, "wall-mirror.enabled");
  if (!existsSync(marker)) return; // mirroring was never opted in for this session
  try {
    // Loaded lazily: `stop` runs on every SessionEnd, so a session that never mirrored must
    // not pay for the mirror path at all.
    const mod = await import("./mirror-follow.js");
    const sessionId = basename(cfg.runtimeDir);
    const resolved = mod.resolveTranscriptPath({ sessionId, cwd: cfg.projectRoot ?? process.cwd() });
    if (resolved.ok) {
      const r = mod.drainMirror(cfg, { transcript: resolved.path });
      if (r.emitted) console.log(`[set-copilot] Mirrored ${r.emitted} pending message(s) before shutdown`);
      if (r.failure) console.error(`[set-copilot] Mirror drain incomplete — NOT delivered: ${r.failure}`);
    } else {
      console.error(`[set-copilot] Mirror drain skipped: ${resolved.reason}`);
    }
    const pid = mod.mirrorPid(cfg.runtimeDir);
    if (pid !== null) {
      try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ }
      console.log(`[set-copilot] Stopped mirror follower (pid ${pid})`);
    }
  } catch (e) {
    // Mirroring is a display convenience: losing it must never break the stop path.
    console.error(`[set-copilot] Mirror drain failed: ${(e as Error).message}`);
  }
}

function pidFile(): string {
  return join(loadConfig().runtimeDir, "capture.pid");
}

async function cmdStop(print = false): Promise<void> {
  const cfg = loadConfig();
  const pf = pidFile();
  if (!existsSync(pf)) {
    // No chime here: `stop` runs on every SessionEnd (including /clear), so a stop
    // that found nothing to stop must stay silent — otherwise every /clear beeps.
    console.log("[set-copilot] No capture running");
    // A capture that hit its --max-minutes limit removed its own PID file, but its
    // transcript is still waiting to be handed over — so hand over even with nothing to kill.
    await drainMirrorAtStop(cfg);
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
  // Mirror what is still pending before the follower goes away — same reason as `wall-stop`:
  // the last thing said is the most valuable thing a wall can hold.
  await drainMirrorAtStop(cfg);
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
  // Dictation returns here: the raw text IS the user's message, not a document, so it
  // gets no derived artifacts.
  if (print) { printTranscriptOnce(cfg); return; }
  const saved = handoverTranscriptOnce(cfg);
  if (!saved) { console.log("[set-copilot] Nothing to hand over"); return; }
  console.log(`[set-copilot] Transcript saved: ${saved}`);
  if (cfg.transcript.stitchOnStop) stitchAtStop(cfg, saved);
}

/**
 * Produce the readable + structured transcripts from the ARCHIVED file, after the rename.
 *
 * Running it here rather than leaving it to a later command is the whole point: the loss
 * this exists to prevent came from a processing step reading the raw JSONL because that
 * was the file at hand. Running it AFTER the rename keeps the single `renameSync` the sole
 * source of truth for "handed over exactly once" — and a failure here is reported, never
 * fatal, because the archive is the invariant and these files are the convenience.
 */
function stitchAtStop(cfg: CopilotConfig, archived: string): void {
  try {
    const out = stitchFile(archived, cfg);
    if (!out) return; // nothing said — no zero-byte artifacts
    // Aligned with "Transcript saved: " so the three paths read as one block.
    console.log(`[set-copilot] Readable:         ${out.markdown}`);
    console.log(`[set-copilot] Structured:       ${out.structured}`);
  } catch (err) {
    console.error(
      `[set-copilot] Could not build the readable transcript: ${(err as Error).message}\n` +
      `              The archived transcript is intact — retry with: set-copilot transcript --input ${archived}`,
    );
  }
}

// ---- transcript stitch -----------------------------------------------------

/**
 * `set-copilot transcript` — raw transcript JSONL → readable markdown + sentence-level
 * JSONL. The post-process the fields `a30d12f` added were recorded FOR, and the backfill
 * path for an archive written before any of this existed.
 */
function cmdTranscript(args: string[]): void {
  const cfg = loadConfig();
  const speakersArg = flag(args, "--speakers");
  const redactArg = flag(args, "--redact");
  const outArg = flag(args, "--out");
  const inputArg = flag(args, "--input");

  const inputs = inputArg ? resolveInputs(inputArg) : [lastTranscript(cfg)].filter((p) => existsSync(p));
  if (!inputs.length) {
    console.error(`[set-copilot] No transcript to stitch${inputArg ? `: ${inputArg}` : " in " + cfg.runtimeDir}`);
    process.exit(1);
  }
  // `--out` names ONE file, so it cannot apply to a batch — silently writing all of them
  // to the same path would destroy every result but the last.
  if (outArg && inputs.length > 1) {
    console.error(`[set-copilot] --out takes a single input, but ${inputs.length} matched — drop --out to write beside each`);
    process.exit(1);
  }

  const opts = {
    out: outArg,
    speakers: speakersArg ? parseSpeakerMap(speakersArg) : undefined,
    redactions: redactArg ? loadRedactions(redactArg) : undefined,
  };

  // Once fixed, do not fix again (recovery-ledger). A batch over an archive becomes
  // re-runnable: the second pass does nothing, so adding one recording to a directory of
  // 258 costs one stitch, not 259 — and a reviewed `.md` is not clobbered by a re-run.
  const force = args.includes("--force");
  const ledger = readLedger(ledgerPath(cfg));
  let skipped = 0;
  let stale = 0;
  const todo: string[] = [];
  for (const input of inputs) {
    if (force) { todo.push(input); continue; }
    let fp: string;
    try { fp = fingerprintFile(input); } catch { todo.push(input); continue; }
    if (!isDone(ledger, fp, "stitch")) { todo.push(input); continue; }
    skipped++;
    // Staleness is REPORTED, never acted on: an auto-redo on a version bump turns a patch
    // release into an unbounded bill across every project's archive. The operator decides.
    const entry = doneEntry(ledger, fp, "stitch");
    if ((entry?.version ?? 0) < STITCH_VERSION) stale++;
  }

  if (!todo.length) {
    console.error(`[set-copilot] Nothing to do — ${skipped} transcript(s) already stitched. Use --force to redo.`);
    if (stale) console.error(`[set-copilot] ${stale} of them were stitched under an older algorithm version (now v${STITCH_VERSION}).`);
    return;
  }

  let done = 0;
  for (const input of todo) {
    try {
      const result = stitchFile(input, cfg, opts);
      if (!result) { console.error(`[set-copilot] Nothing to stitch: ${input}`); continue; }
      done++;
      console.log(result.markdown);
      console.log(result.structured);
      if (args.includes("--stats")) console.error(formatStats(result));
    } catch (err) {
      // One unreadable file must not abort a 179-file backfill.
      console.error(`[set-copilot] Failed on ${input}: ${(err as Error).message}`);
    }
  }
  if (inputs.length > 1 || skipped) {
    console.error(`[set-copilot] Stitched ${done}/${todo.length} transcripts${skipped ? `, skipped ${skipped} already done` : ""}`);
  }
  if (stale) {
    console.error(`[set-copilot] ${stale} skipped transcript(s) were stitched under an older algorithm version (now v${STITCH_VERSION}) — re-run with --force to redo them.`);
  }
  if (!done) process.exit(1);
}

// ---- recovery ledger -------------------------------------------------------

/**
 * `set-copilot recovery <status|claim|mark|abandon>` — the ledger's operator surface.
 *
 * `mark` is deliberately not bookkeeping after the fact: it is the channel a review's
 * findings are DELIVERED through, so skipping the record means failing to deliver the work.
 * That is the same shape as `wall-emit` — the model supplies content, the engine owns the
 * durable side effect — and it is what makes the correct path the easy one.
 */
async function cmdRecovery(args: string[]): Promise<void> {
  const cfg = loadConfig();
  const sub = args.find((a) => !a.startsWith("-")) ?? "status";
  const rest = args.filter((a) => a !== sub);
  const path = ledgerPath(cfg);

  if (sub === "status") return cmdRecoveryStatus(cfg, rest, path);

  const step = (flag(rest, "--step") ?? "review") as string;
  if (!isRecoveryStep(step)) {
    console.error(`[set-copilot] recovery: unknown step "${step}" — expected one of ${RECOVERY_STEPS.join(", ")}`);
    process.exit(1);
  }
  const file = rest.find((a) => !a.startsWith("--") && a !== step);
  if (!file || !existsSync(file)) {
    console.error(`[set-copilot] recovery ${sub}: needs a transcript file that exists${file ? ` (not found: ${file})` : ""}`);
    process.exit(1);
  }
  const fp = fingerprintFile(file);

  if (sub === "claim") {
    appendEntry(path, makeEntry(fp, step, "claimed", { path: file }));
    console.log(`[set-copilot] claimed ${step} of ${file}`);
    console.log(`[set-copilot] finish with: set-copilot recovery mark ${file} --step ${step} --findings-file <json>`);
    return;
  }

  if (sub === "abandon") {
    const reason = flag(rest, "--reason") ?? "no reason given";
    appendEntry(path, makeEntry(fp, step, "abandoned", { path: file, reason }));
    console.log(`[set-copilot] abandoned ${step} of ${file} (${reason}) — it returns to pending`);
    return;
  }

  if (sub === "mark") {
    const findingsFile = flag(rest, "--findings-file");
    let payload = "";
    if (findingsFile) {
      payload = readFileSync(findingsFile, "utf-8");
    } else {
      try { payload = readFileSync(0, "utf-8"); } catch { payload = ""; }
    }
    let findings: unknown;
    try { findings = JSON.parse(payload); } catch {
      // The record cannot be written without the result it is supposed to carry — that is
      // the point of routing delivery through `mark`. Recording a completion here with no
      // findings would assert a review whose output went nowhere.
      console.error(`[set-copilot] recovery mark: needs the findings as JSON (--findings-file <path>, or on stdin)`);
      process.exit(1);
    }
    if (!Array.isArray(findings)) {
      console.error(`[set-copilot] recovery mark: the findings must be a JSON array (use [] for "nothing was missed")`);
      process.exit(1);
    }
    appendEntry(path, makeEntry(fp, step, "done", { path: file, outcome: { findings: findings.length } }));
    console.log(`[set-copilot] recorded ${step} of ${file} — ${findings.length} finding(s)`);
    return;
  }

  console.error(`[set-copilot] recovery: unknown subcommand "${sub}" — expected status, claim, mark or abandon`);
  process.exit(1);
}

/** Read-only: appends nothing, stitches nothing. */
function cmdRecoveryStatus(cfg: CopilotConfig, args: string[], path: string): void {
  const inputArg = flag(args, "--input");
  const inputs = inputArg ? resolveInputs(inputArg) : defaultRecoveryInputs(cfg);
  const ledger = readLedger(path);

  interface Row { file: string; stitch: string; review: string; version: number | null }
  const rows: Row[] = [];
  for (const file of inputs) {
    let fp: string;
    try { fp = fingerprintFile(file); } catch { continue; }
    // A stitch the ledger has never heard of, whose artifacts are nonetheless on disk, is
    // its own status — not "pending". It predates the ledger (or was written by another
    // checkout), so its algorithm version is unknown and it is NOT counted as done either.
    const stitch = stepStatus(ledger, fp, "stitch");
    rows.push({
      file,
      stitch: stitch === "pending" && stitchArtifactsExist(file) ? "artifacts" : stitch,
      review: stepStatus(ledger, fp, "review"),
      version: doneEntry(ledger, fp, "stitch")?.version ?? null,
    });
  }
  const dangling = rows.filter((r) => r.stitch === "claimed" || r.review === "claimed");
  const hookInstalled = stopHookInstalled(cfg);

  if (args.includes("--json")) {
    // The machine shape the skills consume, so a skill never parses human text.
    process.stdout.write(`${JSON.stringify({
      ledger: path,
      stitchVersion: STITCH_VERSION,
      hookInstalled,
      transcripts: rows,
      pending: {
        stitch: rows.filter((r) => r.stitch === "pending").map((r) => r.file),
        review: rows.filter((r) => r.review === "pending").map((r) => r.file),
      },
      dangling: dangling.map((r) => ({ file: r.file, step: r.stitch === "claimed" ? "stitch" : "review" })),
      artifactsOnly: rows.filter((r) => r.stitch === "artifacts").map((r) => r.file),
      staleStitch: rows.filter((r) => r.stitch === "done" && (r.version ?? 0) < STITCH_VERSION).map((r) => r.file),
    }, null, 2)}\n`);
    return;
  }

  if (!rows.length) {
    console.log(`[set-copilot] recovery: no transcripts found${inputArg ? ` for ${inputArg}` : ` under ${cfg.projectRoot}`}`);
    return;
  }
  console.log(`ledger: ${path} (stitch algorithm v${STITCH_VERSION})`);
  console.log(`enforcement hook: ${hookInstalled ? "installed" : "NOT installed — completion is not enforced in this project"}`);
  for (const r of rows) {
    const stale = r.stitch === "done" && (r.version ?? 0) < STITCH_VERSION ? ` (v${r.version})` : "";
    console.log(`  ${r.stitch.padEnd(9)}${stale.padEnd(6)} ${r.review.padEnd(7)}  ${displayPath(cfg, r.file)}`);
  }
  const pendingStitch = rows.filter((r) => r.stitch === "pending").length;
  const pendingReview = rows.filter((r) => r.review === "pending").length;
  const onDisk = rows.filter((r) => r.stitch === "artifacts").length;
  console.log(`\n${rows.length} transcript(s): ${pendingStitch} pending stitch, ${pendingReview} pending review`);
  if (onDisk) {
    console.log(`  ${onDisk} already have artifacts on disk with no ledger entry (stitched before the ledger; version unknown).`);
  }
  // Dangling claims are reported separately and prominently — never folded into "pending",
  // because "someone started this and did not finish" is information, not an absence.
  if (dangling.length) {
    console.log(`\n⚠ ${dangling.length} unfinished claim(s) — resolve with \`recovery mark\` or \`recovery abandon\`:`);
    for (const r of dangling) console.log(`  ${r.file}`);
  }
}

/**
 * A path to show the operator: project-relative when it IS under the project, absolute
 * otherwise. `relative()` alone answers `../../../../../set-copilot/transcript.jsonl` for the
 * global runtime dir — which reads like a project file, and is the one path a copy-paste is
 * most likely to get wrong.
 */
function displayPath(cfg: CopilotConfig, file: string): string {
  const rel = relative(cfg.projectRoot, file);
  return !rel || rel.startsWith("..") ? file : rel;
}

/** Is a set-copilot Stop hook registered for this project (or globally)? */
function stopHookInstalled(cfg: CopilotConfig): boolean {
  for (const base of [join(cfg.projectRoot, ".claude"), join(homedir(), ".claude")]) {
    const settings = join(base, "settings.json");
    if (!existsSync(settings)) continue;
    try {
      const raw = readFileSync(settings, "utf-8");
      if (raw.includes("recovery-guard.sh")) return true;
    } catch { /* unreadable settings: treat as not installed */ }
  }
  return false;
}

/**
 * Where to look for transcripts when `--input` is not given: every per-session runtime dir
 * under the project. A recording filed by hand under a non-conventional name needs an
 * explicit `--input` glob — the directory scan only knows the capture's own naming.
 */
function defaultRecoveryInputs(cfg: CopilotConfig): string[] {
  const base = join(cfg.projectRoot, ".set", "copilot");
  const found = new Set<string>();
  for (const dir of [cfg.runtimeDir, ...listDirs(base)]) {
    for (const f of resolveInputs(dir)) found.add(f);
  }
  return [...found].sort();
}

function listDirs(base: string): string[] {
  if (!existsSync(base)) return [];
  try {
    return readdirSync(base)
      .map((n) => join(base, n))
      .filter((p) => { try { return statSync(p).isDirectory(); } catch { return false; } });
  } catch {
    return [];
  }
}

// ---- wall lifecycle --------------------------------------------------------

/**
 * Stop the wall serving this runtime dir, found through `wall.pid` — the same
 * PID-file discipline `stop` uses for capture, so a `/meeting-copilot stop` can
 * tear down exactly the wall this session started and never another project's.
 * The wall removes its own pid/url on a clean exit; we clean up too in case it
 * was already dead (a stale claim would otherwise refuse the next start).
 */
async function cmdWallStop(): Promise<void> {
  const cfg = loadConfig();
  const pf = join(cfg.runtimeDir, "wall.pid");
  if (!existsSync(pf)) { console.log("[set-copilot] No wall running"); return; }
  // Drain BEFORE the wall goes down: the closing summary is the most valuable thing a wall
  // holds, and until now it could never appear — it is written in the same turn that stops
  // the wall, so any turn-boundary mechanism saw it only after the wall was gone.
  await drainMirrorAtStop(cfg);
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
  set-copilot transcript [--input <jsonl|dir|glob>] [--out <md>]
              [--speakers mic=A,system=B] [--redact <json>] [--stats]
                                   stitch a raw transcript back into sentences:
                                   readable .md + sentence-level .jsonl. Default
                                   input is this runtime dir's last transcript;
                                   a dir/glob backfills a whole archive. Inputs
                                   already recorded in the recovery ledger are
                                   SKIPPED; --force redoes them
  set-copilot recovery status [--input <dir|glob>] [--json]
                                   per transcript, per step: pending / done /
                                   claimed-but-unfinished. Read-only
  set-copilot recovery claim <file> --step review
                                   mark an attempt BEFORE the expensive read; a
                                   claim is never a completion
  set-copilot recovery mark <file> --step review --findings-file <json>
                                   deliver a review's findings AND record it, in
                                   one act ([] means "nothing was missed")
  set-copilot recovery abandon <file> --step review [--reason <text>]
                                   resolve a claim without completing it
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
  set-copilot wall-layout <route> <layout-id>
                                   switch a live window's layout at runtime (e.g.
                                   /wall mirror) — geometry only, no restart
  set-copilot mirror-policy [--apply]
                                   resolved chat→wall mirror policy as JSON; --apply
                                   filters stdin by it (exit 3 = not wall material)
  set-copilot mirror-follow [--once] [--transcript P] [--session ID]
                                   follow the session transcript and mirror each new
                                   message to the wall as it is written (--once drains)
  set-copilot sources              list audio input devices
  set-copilot doctor               audio + env + setup health check (probes real
                                   signal; also reports config drift + mirror readiness)
  set-copilot doctor --mirror      chat→wall mirror readiness only (no audio probe);
                                   exits non-zero when the Stop hook is not registered
  set-copilot beep [--end]         OS chime (start: single, --end: double)
  set-copilot notify <t> [b]       OS desktop notification (--critical)
  set-copilot path <name>          print a resolved runtime path

Config:  ./${CONFIG_FILENAME}  →  ${join(userConfigDir(), CONFIG_FILENAME)}
Secret:  SONIOX_API_KEY  (env  →  ./.env  →  ${join(userConfigDir(), ".env")})
`);
}

// Run only when invoked as the CLI entry point — not when imported (e.g. by a test that
// exercises `registerStopHook`), which would otherwise dispatch on the test runner's argv.
// `realpathSync` on argv[1] is load-bearing: the installed `set-copilot` bin is a SYMLINK
// (npm link / node_modules/.bin), so argv[1] is the link path while import.meta.url is the
// real dist file — comparing them without resolving the link makes the CLI a silent no-op.
function isCliEntry(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}

if (isCliEntry()) {
  main().catch((err) => {
    console.error("[set-copilot] Fatal:", err);
    process.exit(1);
  });
}
