/**
 * Audio capture & transcription.
 *
 * Captures mic (and optionally system) audio, streams to Soniox, writes
 * sentence-level transcript JSONL. Claude Code monitors that file.
 */

import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EventEmitter } from "node:events";

import { loadConfig, keywordIndexPath } from "./config.js";
import { claimRuntimeDir, RuntimeDirBusyError } from "./runtime-dir.js";
import { startDualCapture, listSources, readInputGain } from "./audio.js";
import { SonioxRtClient, SonioxChunkClient } from "./soniox-rt.js";
import { WhisperLocalClient } from "./whisper-local.js";
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

/**
 * Surface a transcription drop instead of swallowing it.
 *
 * A dropped socket used to be a one-line `console.error` while the capture kept
 * running deaf. Now the reconnect is automatic, but the reader still has to KNOW a
 * gap happened — so it goes into the transcript itself as a `{"type":"reconnect"}`
 * line. The copilot reads that as "I may have missed something here", which is the
 * honest reading; an unbroken-looking transcript with a silent hole is not.
 */
function attachReconnectLogging(
  client: EventEmitter,
  writer: TranscriptWriter,
  label: "mic" | "system",
): void {
  client.on("reconnecting", (attempt: number, reason: string) => {
    console.error(`[set-copilot] ${label}: transcription dropped (${reason}) — reconnecting (attempt ${attempt})`);
  });
  client.on("reconnected", (downtimeMs: number, bufferedBytes: number) => {
    const secs = (downtimeMs / 1000).toFixed(1);
    const audioSecs = (bufferedBytes / 32_000).toFixed(1);
    console.log(`[set-copilot] ${label}: transcription reconnected after ${secs}s (replayed ${audioSecs}s of audio)`);
    writer.writeEvent("reconnect", {
      speaker: label,
      downtime_ms: downtimeMs,
      replayed_audio_ms: Math.round((bufferedBytes / 32_000) * 1000),
    });
  });
}

/**
 * Running signal level over s16le mono audio.
 *
 * `rms` is the loudness of a whole window, `peak` the loudest single sample. Speech
 * moves rms into the thousands; a room's noise floor sits in the tens or low
 * hundreds, and a digital input with nothing plugged into it reads ~1. That
 * distinction is the whole point: it separates "the mic hears you" from "the mic is
 * delivering silence at a perfect 32 kB/s".
 */
export class LevelMeter {
  private sumSquares = 0;
  private samples = 0;
  /** Loudest sample in the current window. */
  peak = 0;
  /** Loudest rms of any window so far — survives reset(), so it answers "did anything
   *  ever reach speech level during this capture?". */
  peakRms = 0;

  add(chunk: Buffer): void {
    for (let i = 0; i + 1 < chunk.length; i += 2) {
      const v = chunk.readInt16LE(i);
      this.sumSquares += v * v;
      this.samples++;
      const a = v < 0 ? -v : v;
      if (a > this.peak) this.peak = a;
    }
  }

  get rms(): number {
    return this.samples ? Math.round(Math.sqrt(this.sumSquares / this.samples)) : 0;
  }

  /** Highest rms seen anywhere in the capture, current window included. */
  get maxRms(): number {
    return Math.max(this.peakRms, this.rms);
  }

  /** Close the current window and open a new one. */
  reset(): void {
    if (this.rms > this.peakRms) this.peakRms = this.rms;
    this.sumSquares = 0;
    this.samples = 0;
    this.peak = 0;
  }
}

/**
 * Above this rms a window holds speech rather than room noise.
 *
 * Measured on the capture that failed on 2026-08-27: 44 consecutive seconds of noise
 * floor at rms 68 (peak ~270), while normal speech into the same mic sits an order of
 * magnitude higher. 300 sits in the empty band between the two.
 */
export const SPEECH_RMS_THRESHOLD = 300;

/**
 * Below this input gain a capture is worth a warning. Measured on this hardware:
 * at 59% (-13.83 dB) speech reached rms 68 and transcribed to nothing; at 100% the
 * same mic in the same room produced tokens immediately.
 */
const GAIN_WARN_PERCENT = 75;

export async function runCapture(opts: CaptureOptions = {}): Promise<void> {
  const cfg = loadConfig();

  if (cfg.sttBackend === "soniox" && !cfg.sonioxApiKey) {
    console.error("[set-copilot] SONIOX_API_KEY is required (set it in .env or the environment)");
    process.exit(1);
  }
  if (cfg.sttBackend === "whisper" && !existsSync(cfg.whisper.model)) {
    console.error(`[set-copilot] whisper model not found: ${cfg.whisper.model}`);
    console.error("[set-copilot] Download one (e.g. ggml-small.en.bin) or set whisper.model / WHISPER_MODEL. See: set-copilot doctor");
    process.exit(1);
  }

  const micOnly = opts.micOnly ?? process.env.MIC_ONLY === "1";
  const output = opts.output ?? (micOnly ? cfg.dictationOutput : cfg.transcriptOutput);

  // Ownership of the runtime dir — the PID file, the refusal against a live owner,
  // the archive of an unconsumed transcript, and the state consumers read. Shared
  // with `replay`, which is the other legitimate owner of a runtime dir; see
  // `runtime-dir.ts` for why that rule lives in one place.
  let claim;
  try {
    claim = claimRuntimeDir({ runtimeDir: cfg.runtimeDir, output });
  } catch (err) {
    if (err instanceof RuntimeDirBusyError) {
      console.error(`[set-copilot] ${err.message}`);
      process.exit(1);
    }
    throw err;
  }

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
    fastLane: cfg.copilot.fastLane,
  });

  const useWhisper = cfg.sttBackend === "whisper";
  const useRt = !useWhisper && cfg.sonioxMode !== "chunk";
  const soniox = { apiKey: cfg.sonioxApiKey, language: cfg.language, sampleRate: cfg.audio.sampleRate };
  const whisper = { bin: cfg.whisper.bin, model: cfg.whisper.model, language: cfg.language, sampleRate: cfg.audio.sampleRate };

  let micClient: SonioxRtClient | SonioxChunkClient | WhisperLocalClient;
  let sysClient: SonioxRtClient | SonioxChunkClient | WhisperLocalClient | null = null;

  if (useWhisper) {
    micClient = new WhisperLocalClient(whisper, "mic", 10_000);
    if (!micOnly) sysClient = new WhisperLocalClient(whisper, "system", 10_000);
    console.log(`[set-copilot] STT backend: whisper (local) — ${cfg.whisper.model}`);
  } else if (useRt) {
    micClient = new SonioxRtClient(soniox, "mic");
    if (!micOnly) sysClient = new SonioxRtClient(soniox, "system");
  } else {
    micClient = new SonioxChunkClient(soniox, "mic", 10_000);
    if (!micOnly) sysClient = new SonioxChunkClient(soniox, "system", 10_000);
  }

  /** Any token at all from the mic — zero of these is the symptom we must explain. */
  let micTokens = 0;

  micClient.on("transcript", (event) => {
    micTokens++;
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
  attachReconnectLogging(micClient, writer, "mic");
  micClient.on("closed", (code: number, reason: string) =>
    console.error(`[set-copilot] Mic transcription connection closed (code=${code}${reason ? `, reason=${reason}` : ""})`));

  if (sysClient) {
    sysClient.on("transcript", (event) => {
      writer.onTranscript(event);
      if (event.isFinal && event.text.trim()) {
        process.stdout.write(`\r[sys] ${event.text.trim().slice(0, 80)}\n`);
      }
    });
    sysClient.on("error", (err) => console.error(`[set-copilot] Sys error: ${err.message}`));
    sysClient.on("connected", () => console.log("[set-copilot] Sys: connected"));
    attachReconnectLogging(sysClient, writer, "system");
    sysClient.on("closed", (code: number, reason: string) =>
      console.error(`[set-copilot] Sys transcription connection closed (code=${code}${reason ? `, reason=${reason}` : ""})`));
  }

  if (useRt) {
    (micClient as SonioxRtClient).connect();
    if (sysClient) (sysClient as SonioxRtClient).connect();
  } else {
    // Chunk (Soniox) and whisper both poll on a timer via start().
    (micClient as SonioxChunkClient | WhisperLocalClient).start();
    if (sysClient) (sysClient as SonioxChunkClient | WhisperLocalClient).start();
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
  //
  // Bytes alone are NOT enough, and the gap cost a whole dictation on 2026-08-27:
  // parec on a live-but-deaf input delivers a flawless 32 kB/s of near-silence, so the
  // counter climbed, the socket stayed open, Soniox correctly returned nothing, and the
  // capture reported no problem for three minutes. Hence the level meters — bytes say
  // the pipe is open, rms says whether anything is coming through it.
  let micBytes = 0;
  let sysBytes = 0;
  const micLevel = new LevelMeter();
  const sysLevel = new LevelMeter();
  capture.micStream.on("data", (chunk: Buffer) => { micBytes += chunk.length; micLevel.add(chunk); micClient.sendAudio(chunk); });
  if (sysClient) capture.systemStream.on("data", (chunk: Buffer) => { sysBytes += chunk.length; sysLevel.add(chunk); sysClient!.sendAudio(chunk); });
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
    // Level of the minute just ended, not of the whole capture — a mic that goes
    // dead halfway through has to be visible while it is still happening.
    const mic = `mic=${Math.round(micBytes / 1024)}KB rms=${micLevel.rms} peak=${micLevel.peak}`;
    const sys = micOnly ? "" : ` sys=${Math.round(sysBytes / 1024)}KB rms=${sysLevel.rms}`;
    console.log(`[set-copilot] audio: ${mic}${sys} tokens=${micTokens}`);
    micLevel.reset();
    sysLevel.reset();
  }, 60_000);

  /**
   * The deaf-capture watchdog.
   *
   * Two failures look identical from the outside — an empty transcript — and neither
   * said anything until now:
   *   - audio flows but never rises above the noise floor (wrong input device, muted
   *     headset, gain too low, nobody near the mic)
   *   - the level is fine but the STT backend hands back nothing
   * They need opposite fixes, so the message has to name which one it is.
   */
  let deafWarned = false;
  const deafCheck = setInterval(() => {
    if (deafWarned || micBytes === 0) return;
    deafWarned = true;
    if (micLevel.maxRms < SPEECH_RMS_THRESHOLD) {
      console.error(`[set-copilot] WARNING: 30s of audio, but the level never rose above the noise floor (max rms ${micLevel.maxRms}, speech starts around ${SPEECH_RMS_THRESHOLD}) — nothing can be transcribed from this. Check that the input in \`set-copilot sources\` is the one you speak into, and its gain.`);
    } else if (micTokens === 0) {
      console.error("[set-copilot] WARNING: speech-level audio for 30s but not one transcript token has come back — the STT backend is taking the audio and returning nothing. Check the key and model with `set-copilot doctor`.");
    } else {
      deafWarned = false; // healthy: leave the watchdog armed for a later failure
    }
  }, 30_000);

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
    clearInterval(deafCheck);
    capture.stop();

    await Promise.all([
      micClient.finalize(),
      sysClient ? sysClient.finalize() : Promise.resolve(),
    ]);

    // An empty transcript has to explain itself HERE — stop is the moment someone is
    // actually reading, and with `/ds` running in the background it is the only moment.
    // Silence at this point is what turned a one-line diagnosis into a recurring mystery.
    if (micTokens === 0) {
      const secs = Math.round(micBytes / 32_000);
      if (micBytes === 0) {
        console.error("[set-copilot] EMPTY TRANSCRIPT: the mic delivered 0 bytes — the audio process never produced anything. Check `set-copilot sources` and that parec/sox works.");
      } else if (micLevel.maxRms < SPEECH_RMS_THRESHOLD) {
        console.error(`[set-copilot] EMPTY TRANSCRIPT: ${secs}s of audio arrived, but it never rose above the noise floor (max rms ${micLevel.maxRms} < ${SPEECH_RMS_THRESHOLD}) — nothing was spoken into THIS input. Check \`set-copilot sources\` and the input gain.`);
      } else {
        console.error(`[set-copilot] EMPTY TRANSCRIPT: speech-level audio reached the STT backend (max rms ${micLevel.maxRms}) but it returned no tokens — check the key and model with \`set-copilot doctor\`.`);
      }
    }

    writer.close();
    claim.release();
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

  // A gain that drifted down is the one root cause you cannot hear and cannot see in
  // the byte counter, and it recurs — conferencing apps move the per-device input
  // volume and leave it there. Say it at startup, before three minutes are wasted.
  void readInputGain(cfg.audio.micSource || undefined).then((gain) => {
    if (!gain) return;
    if (gain.muted) {
      console.error(`[set-copilot] WARNING: the mic (${gain.source}) is MUTED — nothing will be transcribed.`);
    } else if (gain.percent < GAIN_WARN_PERCENT) {
      console.error(`[set-copilot] WARNING: mic input gain is ${gain.percent}% — low gain has produced empty transcripts before. Raise it with: pactl set-source-volume ${gain.source} 100%`);
    } else {
      console.log(`[set-copilot] Mic gain: ${gain.percent}%`);
    }
  });
}
