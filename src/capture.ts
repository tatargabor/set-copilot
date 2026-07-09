/**
 * Audio capture & transcription.
 *
 * Captures mic (and optionally system) audio, streams to Soniox, writes
 * sentence-level transcript JSONL. Claude Code monitors that file.
 */

import { truncateSync, closeSync, openSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

import { loadConfig, keywordIndexPath } from "./config.js";
import { startDualCapture, listSources } from "./audio.js";
import { SonioxRtClient, SonioxChunkClient } from "./soniox-rt.js";
import { TranscriptWriter } from "./transcript-writer.js";
import { buildMatcher, loadKeywordIndex } from "./knowledge/keyword-matcher.js";

export interface CaptureOptions {
  /** Dictation mode: capture mic only, no system audio, no topic analysis */
  micOnly?: boolean;
  /** Override the output JSONL path */
  output?: string;
}

export async function runCapture(opts: CaptureOptions = {}): Promise<void> {
  const cfg = loadConfig();

  if (!cfg.sonioxApiKey) {
    console.error("[set-copilot] SONIOX_API_KEY is required (set it in .env or the environment)");
    process.exit(1);
  }

  const micOnly = opts.micOnly ?? process.env.MIC_ONLY === "1";
  const output = opts.output ?? (micOnly ? cfg.dictationOutput : cfg.transcriptOutput);

  // Truncate the output file so each session starts clean.
  mkdirSync(dirname(output), { recursive: true });
  closeSync(openSync(output, "a"));
  truncateSync(output, 0);

  // PID file lets `set-copilot stop` and the poll loop find/track this process
  // without brittle pkill pattern matching (works identically on Linux + macOS).
  const pidFile = join(cfg.runtimeDir, "capture.pid");
  writeFileSync(pidFile, String(process.pid));
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
  micClient.on("connected", () => console.log("[set-copilot] Mic: connected"));

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

  capture.micStream.on("data", (chunk: Buffer) => micClient.sendAudio(chunk));
  if (sysClient) capture.systemStream.on("data", (chunk: Buffer) => sysClient!.sendAudio(chunk));
  capture.micStream.on("error", (err) => console.error(`[set-copilot] Mic stream: ${err.message}`));
  capture.systemStream.on("error", (err) => console.error(`[set-copilot] Sys stream: ${err.message}`));

  const shutdown = () => {
    console.log("\n[set-copilot] Stopping...");
    capture.stop();
    micClient.close();
    if (sysClient) sysClient.close();
    writer.close();
    try { rmSync(pidFile); } catch { /* already gone */ }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  void listSources; // available for `set-copilot sources`
  console.log("[set-copilot] Recording — Ctrl+C to stop");
}
