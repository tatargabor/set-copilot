/**
 * Audio capture & transcription.
 *
 * Captures mic (and optionally system) audio, streams to Soniox, writes
 * sentence-level transcript JSONL. Claude Code monitors that file.
 */

import {
  closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { loadConfig, keywordIndexPath } from "./config.js";
import { startDualCapture, listSources } from "./audio.js";
import { SonioxRtClient, SonioxChunkClient } from "./soniox-rt.js";
import { TranscriptWriter } from "./transcript-writer.js";
import { buildMatcher, loadKeywordIndex } from "./knowledge/keyword-matcher.js";
import { playTone } from "./tones.js";

export interface CaptureOptions {
  /** Dictation mode: capture mic only, no system audio, no topic analysis */
  micOnly?: boolean;
  /** Override the output JSONL path */
  output?: string;
  /** Self-stop after this many minutes (built-in timer — no external sleep needed) */
  maxMinutes?: number;
}

/** PID of the capture owning `pidFile`, or null if the file is stale/absent. */
function livePid(pidFile: string): number | null {
  if (!existsSync(pidFile)) return null;
  const pid = parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
  if (!Number.isFinite(pid)) return null;
  try {
    process.kill(pid, 0);
    return pid;
  } catch {
    return null; // process is gone — the PID file is a leftover
  }
}

/** Move a non-empty transcript to `<name>-<timestamp>.jsonl` so it survives the next capture. */
function archivePrevious(output: string): void {
  if (!existsSync(output) || statSync(output).size === 0) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const archived = `${output.replace(/\.jsonl$/, "")}-${stamp}.jsonl`;
  renameSync(output, archived);
  console.log(`[set-copilot] Previous transcript archived: ${archived}`);
}

export async function runCapture(opts: CaptureOptions = {}): Promise<void> {
  const cfg = loadConfig();

  if (!cfg.sonioxApiKey) {
    console.error("[set-copilot] SONIOX_API_KEY is required (set it in .env or the environment)");
    process.exit(1);
  }

  const micOnly = opts.micOnly ?? process.env.MIC_ONLY === "1";
  const output = opts.output ?? (micOnly ? cfg.dictationOutput : cfg.transcriptOutput);

  mkdirSync(cfg.runtimeDir, { recursive: true });
  mkdirSync(dirname(output), { recursive: true });

  // PID file lets `set-copilot stop` and the poll loop find/track this process
  // without brittle pkill pattern matching (works identically on Linux + macOS).
  // A second capture in the same runtime dir would overwrite it, orphaning the
  // first process (it keeps recording, nothing can stop it) — so refuse instead.
  const pidFile = join(cfg.runtimeDir, "capture.pid");
  const alive = livePid(pidFile);
  if (alive !== null) {
    console.error(
      `[set-copilot] A capture is already running (pid ${alive}) in ${cfg.runtimeDir} — run \`set-copilot stop\` first.`,
    );
    process.exit(1);
  }

  // Rotate the previous transcript aside rather than truncating it: past dictations
  // stay readable, while the configured output path keeps naming the current one.
  archivePrevious(output);
  closeSync(openSync(output, "a"));

  writeFileSync(pidFile, String(process.pid));
  // Record the transcript path: `stop --print` and `status` need it, and only the
  // capture knows whether this run is dictation or meeting mode.
  writeFileSync(join(cfg.runtimeDir, "capture.output"), output);
  // Reset the poll offset so the monitor reads from the top of the fresh file.
  writeFileSync(join(cfg.runtimeDir, "poll-offset"), "0");

  console.log(`[set-copilot] Starting capture (${micOnly ? "dictation" : "meeting"})`);
  console.log(`[set-copilot] Output: ${output}`);

  // Topic matcher: dictation needs none; meeting mode loads the keyword index.
  const topicMatcher = micOnly
    ? undefined
    : buildMatcher(loadKeywordIndex(keywordIndexPath(cfg)), {
        decisionIdPrefix: cfg.knowledge.decisionIdPrefix,
      });

  const writer = new TranscriptWriter(output, {
    silenceTimeoutMs: 3000,
    maxBufferWords: 80,
    topicMatcher,
    detect: cfg.detect,
  });

  const useRt = cfg.sonioxMode !== "chunk";
  const soniox = { apiKey: cfg.sonioxApiKey, language: cfg.language, sampleRate: cfg.audio.sampleRate };

  let micClient: SonioxRtClient | SonioxChunkClient;
  let sysClient: SonioxRtClient | SonioxChunkClient | null = null;
  let lastSpeaker: "mic" | "system" = "mic";

  if (useRt) {
    micClient = new SonioxRtClient(soniox, "mic");
    if (!micOnly) sysClient = new SonioxRtClient(soniox, "system");
  } else {
    micClient = new SonioxChunkClient(soniox, "mic", 10_000);
    if (!micOnly) sysClient = new SonioxChunkClient(soniox, "system", 10_000);
  }

  micClient.on("transcript", (event) => {
    if (lastSpeaker !== "mic") {
      writer.onSpeakerChange("mic");
      lastSpeaker = "mic";
    }
    writer.onTranscript(event);
    if (event.isFinal && event.text.trim()) {
      process.stdout.write(`\r[mic] ${event.text.trim().slice(0, 80)}\n`);
    }
  });
  micClient.on("error", (err) => console.error(`[set-copilot] Mic error: ${err.message}`));
  micClient.on("connected", () => {
    console.log("[set-copilot] Mic: connected");
    // The rising tone marks the moment you can actually start speaking —
    // played here (mic transcription live), not by the caller.
    playTone("start", cfg.audio.toneStart || undefined);
  });
  micClient.on("closed", (code: number, reason: string) =>
    console.error(`[set-copilot] Mic transcription connection closed (code=${code}${reason ? `, reason=${reason}` : ""})`));

  if (sysClient) {
    sysClient.on("transcript", (event) => {
      if (lastSpeaker !== "system") {
        writer.onSpeakerChange("system");
        lastSpeaker = "system";
      }
      writer.onTranscript(event);
      if (event.isFinal && event.text.trim()) {
        process.stdout.write(`\r[sys] ${event.text.trim().slice(0, 80)}\n`);
      }
    });
    sysClient.on("error", (err) => console.error(`[set-copilot] Sys error: ${err.message}`));
    sysClient.on("connected", () => console.log("[set-copilot] Sys: connected"));
    sysClient.on("closed", (code: number, reason: string) =>
      console.error(`[set-copilot] Sys transcription connection closed (code=${code}${reason ? `, reason=${reason}` : ""})`));
  }

  if (useRt) {
    (micClient as SonioxRtClient).connect();
    if (sysClient) (sysClient as SonioxRtClient).connect();
  } else {
    (micClient as SonioxChunkClient).start();
    if (sysClient) (sysClient as SonioxChunkClient).start();
  }

  const capture = startDualCapture({
    micSource: cfg.audio.micSource || undefined,
    monitorSource: cfg.audio.monitorSource || undefined,
    sampleRate: cfg.audio.sampleRate,
    micOnly,
  });

  // Byte counters: the single most useful signal when "nothing happens".
  // 16 kHz s16le mono = 32 000 B/s per stream — 0 bytes means the audio
  // process is not delivering (wrong device, broken parec/sox binary).
  let micBytes = 0;
  let sysBytes = 0;
  capture.micStream.on("data", (chunk: Buffer) => { micBytes += chunk.length; micClient.sendAudio(chunk); });
  if (sysClient) capture.systemStream.on("data", (chunk: Buffer) => { sysBytes += chunk.length; sysClient!.sendAudio(chunk); });
  capture.micStream.on("error", (err) => console.error(`[set-copilot] Mic stream: ${err.message}`));
  capture.systemStream.on("error", (err) => console.error(`[set-copilot] Sys stream: ${err.message}`));

  const noAudioCheck = setTimeout(() => {
    if (micBytes === 0) {
      console.error("[set-copilot] WARNING: 0 bytes from the mic after 5s — no audio is flowing. Check the input device (`set-copilot sources`) and that parec/sox works.");
    }
    if (!micOnly && sysBytes === 0) {
      console.error("[set-copilot] WARNING: 0 bytes from system audio after 5s — the monitor source is not delivering.");
    }
  }, 5000);

  const audioStats = setInterval(() => {
    console.log(`[set-copilot] audio: mic=${Math.round(micBytes / 1024)}KB sys=${Math.round(sysBytes / 1024)}KB`);
  }, 60_000);

  /**
   * Order matters: stop the mic FIRST (no new audio), then ask Soniox to flush the
   * tail it is still holding, and only close the writer once those last tokens have
   * arrived. Tearing the socket down synchronously — as this did until 2026-07-13 —
   * threw away the final words of every dictation.
   */
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return; // a second SIGTERM must not cut the flush short
    stopping = true;
    console.log("\n[set-copilot] Stopping...");
    clearTimeout(noAudioCheck);
    clearInterval(audioStats);
    capture.stop();

    await Promise.all([
      micClient.finalize(),
      sysClient ? sysClient.finalize() : Promise.resolve(),
    ]);

    writer.close();
    try { rmSync(pidFile); } catch { /* already gone */ }
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  if (opts.maxMinutes && opts.maxMinutes > 0) {
    setTimeout(() => {
      console.log(`[set-copilot] Max duration (${opts.maxMinutes} min) reached — stopping`);
      void shutdown();
    }, opts.maxMinutes * 60_000);
    console.log(`[set-copilot] Auto-stop after ${opts.maxMinutes} min`);
  }

  void listSources; // available for `set-copilot sources`
  console.log("[set-copilot] Recording — Ctrl+C to stop");
}
