import WebSocket from "ws";
import { EventEmitter } from "node:events";

export interface TranscriptToken {
  text: string;
  is_final: boolean;
  speaker?: number;
  start_ms?: number;
  end_ms?: number;
}

export interface TranscriptEvent {
  speaker: "mic" | "system";
  text: string;
  isFinal: boolean;
  timestampMs: number;
}

interface SonioxRtOptions {
  apiKey: string;
  language?: string;
  sampleRate?: number;
}

/**
 * Real-time Soniox WebSocket streaming client.
 *
 * Emits:
 *  - "transcript" (TranscriptEvent) — partial or final transcript tokens
 *  - "error" (Error) — connection or transcription errors
 *  - "connected" — WebSocket connected
 *  - "closed" — WebSocket closed
 */
export class SonioxRtClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private apiKey: string;
  private language: string;
  private sampleRate: number;
  private speaker: "mic" | "system";
  private startTime: number = 0;

  constructor(opts: SonioxRtOptions, speaker: "mic" | "system") {
    super();
    this.apiKey = opts.apiKey;
    this.language = opts.language || "hu";
    this.sampleRate = opts.sampleRate || 16000;
    this.speaker = speaker;
  }

  connect(): void {
    const url = `wss://stt-rt.soniox.com/transcribe-websocket`;
    this.ws = new WebSocket(url);
    this.startTime = Date.now();

    this.ws.on("open", () => {
      const config = {
        api_key: this.apiKey,
        model: "stt-rt-v5",
        language_hints: [this.language],
        sample_rate: this.sampleRate,
        audio_format: "s16le",
        num_channels: 1,
      };
      this.ws!.send(JSON.stringify(config));
      this.emit("connected");
    });

    this.ws.on("message", (data: Buffer | string) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.error) {
          this.emit("error", new Error(`Soniox RT error: ${msg.error}`));
          return;
        }
        if (msg.tokens) {
          for (const token of msg.tokens as TranscriptToken[]) {
            const event: TranscriptEvent = {
              speaker: this.speaker,
              text: token.text,
              isFinal: token.is_final,
              timestampMs: token.start_ms ?? (Date.now() - this.startTime),
            };
            this.emit("transcript", event);
          }
        }
        if (msg.text !== undefined) {
          const event: TranscriptEvent = {
            speaker: this.speaker,
            text: msg.text,
            isFinal: msg.is_final ?? true,
            timestampMs: Date.now() - this.startTime,
          };
          this.emit("transcript", event);
        }
      } catch (err) {
        this.emit("error", err instanceof Error ? err : new Error(String(err)));
      }
    });

    this.ws.on("error", (err: Error) => {
      this.emit("error", err);
    });

    this.ws.on("close", (code: number, reason: Buffer) => {
      this.emit("closed", code, reason.toString());
    });
  }

  sendAudio(pcmChunk: Buffer): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(pcmChunk);
    }
  }

  /**
   * End-of-stream, THEN wait for the tail.
   *
   * Soniox holds the most recent audio in a non-final (still revisable) state — it
   * only promotes those tokens to final once it knows no more audio is coming. The
   * signal for that is an empty-string message; the server then flushes the pending
   * tokens and replies `finished: true`.
   *
   * Calling `close()` straight away (what we used to do) drops exactly that tail —
   * every dictation lost its last few words, and the more abruptly you stopped, the
   * more you lost. So: signal, wait for `finished` (or the socket to close), and only
   * then tear down. Bounded by `timeoutMs` so a dead socket cannot hang the shutdown.
   */
  async finalize(timeoutMs = 6000): Promise<void> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      this.close();
      return;
    }

    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        ws.off("message", onMessage);
        ws.off("close", finish);
        resolve();
      };

      const onMessage = (data: Buffer | string) => {
        try {
          const msg = JSON.parse(data.toString());
          // The tokens in this message are still delivered by the normal "message"
          // handler registered in connect() — we only watch for the end marker here.
          if (msg.finished === true) finish();
        } catch {
          /* not JSON — ignore, the main handler reports it */
        }
      };

      const timer = setTimeout(finish, timeoutMs);
      ws.on("message", onMessage);
      ws.on("close", finish);

      ws.send(""); // end-of-stream: "no more audio, flush what you're holding"
    });

    this.close();
  }

  close(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

/**
 * Fallback: 30-second chunk async transcription.
 * Uses the existing Soniox async API if RT WebSocket doesn't support Hungarian.
 */
export class SonioxChunkClient extends EventEmitter {
  private apiKey: string;
  private language: string;
  private sampleRate: number;
  private speaker: "mic" | "system";
  private buffer: Buffer[] = [];
  private bufferBytes = 0;
  private chunkIntervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private startTime: number = 0;

  constructor(
    opts: SonioxRtOptions,
    speaker: "mic" | "system",
    chunkIntervalMs: number = 30_000,
  ) {
    super();
    this.apiKey = opts.apiKey;
    this.language = opts.language || "hu";
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
    this.bufferBytes += pcmChunk.length;
  }

  private async flushChunk(): Promise<void> {
    if (this.buffer.length === 0) return;

    const audioData = Buffer.concat(this.buffer);
    this.buffer = [];
    this.bufferBytes = 0;

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

  private async transcribeChunk(pcmData: Buffer): Promise<string> {
    // Add WAV header to raw PCM
    const wavData = addWavHeader(pcmData, this.sampleRate);

    // Upload file
    const boundary = `----FormBoundary${Date.now()}`;
    const parts = [
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="chunk.wav"\r\nContent-Type: audio/wav\r\n\r\n`,
      wavData,
      `\r\n--${boundary}--\r\n`,
    ];
    const body = Buffer.concat([
      Buffer.from(parts[0] as string),
      parts[1] as Buffer,
      Buffer.from(parts[2] as string),
    ]);

    const uploadResp = await fetch("https://api.soniox.com/v1/files", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });

    if (!uploadResp.ok) {
      throw new Error(`Soniox upload failed: ${uploadResp.status}`);
    }

    const { id: fileId } = (await uploadResp.json()) as { id: string };

    // Create transcription
    const createResp = await fetch("https://api.soniox.com/v1/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        file_id: fileId,
        model: "stt-async-v4",
        language_hints: [this.language],
      }),
    });

    if (!createResp.ok) {
      throw new Error(`Soniox transcription create failed: ${createResp.status}`);
    }

    const txn = (await createResp.json()) as { id: string; status: string };

    // Poll for completion
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const pollResp = await fetch(
        `https://api.soniox.com/v1/transcriptions/${txn.id}`,
        { headers: { Authorization: `Bearer ${this.apiKey}` } },
      );
      if (!pollResp.ok) continue;
      const result = (await pollResp.json()) as { status: string; text?: string };
      if (result.status === "completed") {
        // Fetch transcript text
        const txtResp = await fetch(
          `https://api.soniox.com/v1/transcriptions/${txn.id}/transcript`,
          { headers: { Authorization: `Bearer ${this.apiKey}` } },
        );
        if (txtResp.ok) {
          const txt = (await txtResp.json()) as { text?: string };
          return txt.text || "";
        }
        return result.text || "";
      }
      if (result.status === "error") {
        throw new Error("Soniox transcription error");
      }
    }

    throw new Error("Soniox transcription timed out");
  }

  /**
   * Same contract as SonioxRtClient.finalize(): transcribe the audio still sitting in
   * the buffer and only resolve once its tokens have been emitted. `close()` used to
   * fire the flush and forget it, so the caller exited before the chunk came back —
   * on this path that dropped up to a full chunk interval (30s) of speech.
   */
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
    // Flush remaining
    this.flushChunk().catch(() => {});
  }
}

function addWavHeader(pcmData: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  const dataSize = pcmData.length;
  const fileSize = dataSize + 36;

  header.write("RIFF", 0);
  header.writeUInt32LE(fileSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmData]);
}
