import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { addWavHeader, type TranscriptEvent } from "./soniox-rt.js";

export interface WhisperLocalOptions {
  /** whisper.cpp CLI binary (e.g. "whisper-cli" or an absolute path) */
  bin: string;
  /** Path to a ggml model file (e.g. ggml-base.bin) */
  model: string;
  language?: string;
  sampleRate?: number;
}

/**
 * Local, offline speech-to-text via whisper.cpp — the free alternative to Soniox.
 *
 * Same contract as SonioxChunkClient (start / sendAudio / finalize / close, and a
 * "transcript" event carrying a TranscriptEvent), so capture.ts wires it the same
 * way. It buffers PCM and, every `chunkIntervalMs`, writes the buffer to a temp WAV
 * and runs whisper.cpp on it. No network, no API key.
 *
 * whisper is chunk-based by nature, so this mirrors the chunk client rather than the
 * real-time WS one; there is no "reconnect" concept (nothing to disconnect from).
 */
export class WhisperLocalClient extends EventEmitter {
  private bin: string;
  private model: string;
  private language: string;
  private sampleRate: number;
  private speaker: "mic" | "system";
  private chunkIntervalMs: number;
  private buffer: Buffer[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private startTime = 0;
  private chunkSeq = 0;

  constructor(
    opts: WhisperLocalOptions,
    speaker: "mic" | "system",
    chunkIntervalMs = 10_000,
  ) {
    super();
    this.bin = opts.bin;
    this.model = opts.model;
    this.language = opts.language || "auto";
    this.sampleRate = opts.sampleRate || 16000;
    this.speaker = speaker;
    this.chunkIntervalMs = chunkIntervalMs;
  }

  start(): void {
    this.startTime = Date.now();
    this.timer = setInterval(() => this.flushChunk(), this.chunkIntervalMs);
    this.emit("connected");
  }

  sendAudio(pcmChunk: Buffer): void {
    this.buffer.push(pcmChunk);
  }

  private async flushChunk(): Promise<void> {
    if (this.buffer.length === 0) return;
    const audioData = Buffer.concat(this.buffer);
    this.buffer = [];

    try {
      const text = await this.transcribeChunk(audioData);
      if (text.trim()) {
        const event: TranscriptEvent = {
          speaker: this.speaker,
          text: text.trim(),
          isFinal: true,
          timestampMs: Date.now() - this.startTime,
        };
        this.emit("transcript", event);
      }
    } catch (err) {
      this.emit("error", err instanceof Error ? err : new Error(String(err)));
    }
  }

  private transcribeChunk(pcmData: Buffer): Promise<string> {
    return new Promise((resolvePromise, reject) => {
      const wav = addWavHeader(pcmData, this.sampleRate);
      // Unique per chunk+speaker so mic and system runs never collide.
      const wavPath = join(tmpdir(), `set-copilot-${process.pid}-${this.speaker}-${this.chunkSeq++}.wav`);
      try {
        writeFileSync(wavPath, wav);
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }

      // -nt (no timestamps) -np (no prints) → stdout is just the transcript text.
      const args = ["-m", this.model, "-f", wavPath, "-l", this.language, "-nt", "-np"];
      const proc = spawn(this.bin, args, { stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      let errOut = "";
      proc.stdout!.on("data", (d: Buffer) => { out += d.toString(); });
      proc.stderr!.on("data", (d: Buffer) => { errOut += d.toString(); });

      const cleanup = () => { try { unlinkSync(wavPath); } catch { /* already gone */ } };

      proc.on("error", (err) => {
        cleanup();
        reject(new Error(`whisper.cpp failed to spawn (${this.bin}): ${err.message}`));
      });
      proc.on("close", (code) => {
        cleanup();
        if (code !== 0) {
          reject(new Error(`whisper.cpp exited ${code}: ${errOut.trim().split("\n").slice(-1)[0] || "unknown error"}`));
          return;
        }
        resolvePromise(cleanWhisperText(out));
      });
    });
  }

  async finalize(timeoutMs = 20_000): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await Promise.race([
      this.flushChunk().catch(() => {}),
      new Promise<void>((r) => setTimeout(r, timeoutMs)),
    ]);
  }

  close(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.flushChunk().catch(() => {});
  }
}

/**
 * whisper.cpp prints non-speech segments as bracketed markers — [BLANK_AUDIO],
 * (speaking foreign language), *music* — for silent or non-verbal chunks. Drop any
 * line that is entirely one such marker, so silence does not reach the transcript.
 */
export function cleanWhisperText(raw: string): string {
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^[[(*].*[\])*]$/.test(l))
    .join(" ")
    .trim();
}
