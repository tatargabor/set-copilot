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

/** How long a socket may go without answering a ping before we call it dead. */
const PING_INTERVAL_MS = 20_000;
const PONG_TIMEOUT_MS = 15_000;
/** Reconnect backoff: 0.5s, 1s, 2s, 4s, then 8s forever. */
const RECONNECT_BACKOFF_MS = [500, 1000, 2000, 4000, 8000];
/** Audio kept while the socket is down, so a reconnect does not lose speech. 16 kHz s16le = 32 kB/s. */
const RECONNECT_BUFFER_BYTES = 32_000 * 15; // ~15 seconds

/**
 * Real-time Soniox WebSocket streaming client.
 *
 * Emits:
 *  - "transcript" (TranscriptEvent) — partial or final transcript tokens
 *  - "error" (Error) — connection or transcription errors
 *  - "connected" — WebSocket connected
 *  - "reconnecting" (attempt, reason) — the socket dropped; a new one is coming. The
 *    reason carries the drop diagnostics (SYS-1311): the error's code, if the socket
 *    raised one, and how long the socket had been up when it died — so a storm of
 *    message-less 1006s can still be attributed to a layer after the fact.
 *  - "reconnected" (downtimeMs, bufferedBytes) — speech resumed after a drop
 *  - "closed" — WebSocket closed for good (we are shutting down)
 *
 * ## Why the reconnect exists
 *
 * Until 2026-07-14 a dropped socket was only logged. The process stayed alive, the
 * mic kept streaming, and `sendAudio()` silently discarded every chunk because the
 * socket was no longer OPEN — so the capture did not crash, it went DEAF: `status`
 * said "running", the byte counters kept climbing, and no transcript line ever
 * appeared again. In a 2-hour meeting that happened repeatedly and the only cure was
 * a manual restart. A single WS close must never cost the rest of the meeting.
 *
 * Two failure modes, two defences:
 *   - socket closes    → reconnect with backoff, replaying the audio buffered meanwhile
 *   - socket half-open → ping/pong: a socket that misses a pong is dead, force-reconnect
 * A half-open socket reports OPEN forever, so the close handler alone cannot see it.
 */
/**
 * Soniox error codes no reconnect can fix: a malformed request (400), a bad or revoked key
 * (401), an exhausted balance (402), a forbidden model or account (403). Measured
 * 2026-11-19: a 402 looped as one reconnect per second, on both channels, until stopped
 * by hand. Rate limits (429) and server errors (5xx) stay retryable.
 */
export function isFatalSonioxError(code: unknown): boolean {
  const n = Number(code);
  return n === 400 || n === 401 || n === 402 || n === 403;
}

export class SonioxRtClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private apiKey: string;
  private language: string;
  private sampleRate: number;
  private speaker: "mic" | "system";
  private startTime: number = 0;

  /** True once finalize()/close() ran: an intentional teardown must not reconnect. */
  private closing = false;
  private attempt = 0;
  private downSince = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  /** Audio that arrived while the socket was down (bounded — oldest dropped first). */
  private pending: Buffer[] = [];
  private pendingBytes = 0;
  /**
   * Where the CURRENT socket's audio starts on this client's timeline, in ms since
   * `startTime`. Soniox times every token from the start of its own stream, so each
   * reconnect restarted the clock at zero — measured on a two-hour call: 37 restarts, and a
   * transcript that could not be put back in order from its timestamps.
   */
  private streamBaseMs = 0;
  /** When the CURRENT socket attempt started — a drop's age includes its handshake. */
  private connectStartedAt = 0;
  /** The last error the CURRENT socket raised, carried onto the reconnecting line. */
  private socketError: { code: string; message: string } | null = null;
  /** A Soniox refusal that a reconnect cannot fix; set, the close handler stops instead. */
  private fatal: { code: string; message: string } | null = null;

  constructor(opts: SonioxRtOptions, speaker: "mic" | "system") {
    super();
    this.apiKey = opts.apiKey;
    this.language = opts.language || "hu";
    this.sampleRate = opts.sampleRate || 16000;
    this.speaker = speaker;
  }

  connect(): void {
    if (this.closing) return;
    const url = `wss://stt-rt.soniox.com/transcribe-websocket`;
    // A replaced socket must be gone, not just forgotten: its late `close` used to schedule
    // a second reconnect while the new socket was already live, and two streams then fed
    // the same channel — the old one's tokens still arriving on the old clock.
    const old = this.ws;
    if (old) {
      old.removeAllListeners();
      old.on("error", () => { /* a socket being discarded may still error; nothing to do */ });
      try { old.terminate(); } catch { /* already closed */ }
    }
    const ws = new WebSocket(url);
    this.ws = ws;
    // Fresh attempt, fresh diagnostics: the previous socket's error must never be
    // reported as the new one's cause.
    this.connectStartedAt = Date.now();
    this.socketError = null;
    if (this.startTime === 0) this.startTime = Date.now();

    ws.on("open", () => {
      const config = {
        api_key: this.apiKey,
        model: "stt-rt-v5",
        language_hints: [this.language],
        sample_rate: this.sampleRate,
        audio_format: "s16le",
        num_channels: 1,
      };
      ws.send(JSON.stringify(config));

      const wasDown = this.downSince > 0;
      const downtime = wasDown ? Date.now() - this.downSince : 0;
      const buffered = this.pendingBytes;
      this.attempt = 0;
      this.downSince = 0;
      // The first audio this socket receives is the replayed buffer, which was spoken
      // `pendingBytes` worth of audio before now.
      this.streamBaseMs = Math.max(0, this.elapsedMs() - this.bytesToMs(this.pendingBytes));
      this.startHeartbeat(ws);
      // Replay what was spoken while we were disconnected — Soniox treats it as the
      // head of the new stream, so the words land instead of vanishing.
      this.flushPending(ws);

      if (wasDown) this.emit("reconnected", downtime, buffered);
      else this.emit("connected");
    });

    ws.on("message", (data: Buffer | string) => {
      if (ws !== this.ws) return; // a replaced socket's late tokens belong to no timeline
      try {
        const msg = JSON.parse(data.toString());
        // Soniox reports a refusal as `error_code` / `error_type` / `error_message` and then
        // closes the socket with a clean 1000. Checking only `msg.error` (as this did until
        // 2026-11-19) missed it: an exhausted balance (402) showed up as an endless
        // `socket closed (code=1000), error=none seen` reconnect loop and a silent transcript.
        if (msg.error_code != null || msg.error_message || msg.error) {
          const code = [msg.error_code, msg.error_type].filter((x) => x != null && x !== "").join(" ");
          const message = String(msg.error_message || msg.error || "");
          this.socketError = { code, message };
          if (isFatalSonioxError(msg.error_code)) this.fatal = this.socketError;
          this.emit("error", new Error(`Soniox RT error: ${[code, message].filter(Boolean).join(" — ")}`));
          return;
        }
        if (msg.tokens) {
          for (const token of msg.tokens as TranscriptToken[]) {
            const event: TranscriptEvent = {
              speaker: this.speaker,
              text: token.text,
              isFinal: token.is_final,
              timestampMs: this.tokenTime(token.start_ms),
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

    ws.on("pong", () => {
      if (this.pongTimer) clearTimeout(this.pongTimer);
      this.pongTimer = null;
    });

    ws.on("error", (err: Error) => {
      // File the error on the socket it belongs to: a superseded socket's late error
      // must not be reported as the live one's cause.
      if (ws === this.ws) {
        const e = err as NodeJS.ErrnoException;
        this.socketError = { code: typeof e.code === "string" ? e.code : "", message: err.message };
      }
      this.emit("error", err);
      // 'error' is always followed by 'close' — let the close handler do the reconnect.
    });

    ws.on("close", (code: number, reason: Buffer) => {
      if (ws !== this.ws) return; // superseded: its replacement owns the reconnect
      this.stopHeartbeat();
      if (this.closing) {
        this.emit("closed", code, reason.toString());
        return;
      }
      // A refusal no retry can fix (no balance, bad key, bad config): reconnecting only
      // hammers the API once a second and hides the cause. Stop and say why.
      if (this.fatal) {
        this.closing = true;
        this.pending = [];
        this.pendingBytes = 0;
        const f = this.fatal;
        this.emit("fatal", new Error(`Soniox refused the stream: ${[f.code, f.message].filter(Boolean).join(" — ")}`));
        this.emit("closed", code, reason.toString());
        return;
      }
      this.scheduleReconnect(`socket closed (code=${code}${reason.length ? `, ${reason}` : ""})`);
    });
  }

  private elapsedMs(): number {
    return this.startTime ? Date.now() - this.startTime : 0;
  }

  private bytesToMs(bytes: number): number {
    return (bytes / (this.sampleRate * 2)) * 1000; // s16le mono
  }

  /**
   * A token's time on this client's timeline: the stream's base plus the token's offset in
   * the stream, never later than now (a token cannot have been spoken in the future).
   */
  private tokenTime(startMs: number | undefined): number {
    const now = this.elapsedMs();
    return startMs == null ? now : Math.min(this.streamBaseMs + startMs, now);
  }

  /**
   * A socket that stops answering pings is dead even though `readyState` still says
   * OPEN. This is the half-open case that made the capture go deaf without ever
   * firing a close event.
   */
  private startHeartbeat(ws: WebSocket): void {
    this.stopHeartbeat();
    this.pingTimer = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (this.pongTimer) return; // a ping is already outstanding
      this.pongTimer = setTimeout(() => {
        this.pongTimer = null;
        if (this.closing) return;
        // Terminate (not close) — a half-open socket will not complete a handshake.
        ws.terminate();
        this.scheduleReconnect(`no pong within ${PONG_TIMEOUT_MS / 1000}s — socket is dead`);
      }, PONG_TIMEOUT_MS);
      try {
        ws.ping();
      } catch {
        /* the close handler picks it up */
      }
    }, PING_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.pongTimer) clearTimeout(this.pongTimer);
    this.pingTimer = null;
    this.pongTimer = null;
  }

  private scheduleReconnect(reason: string): void {
    if (this.closing || this.reconnectTimer) return;
    if (this.downSince === 0) this.downSince = Date.now();
    const delay = RECONNECT_BACKOFF_MS[Math.min(this.attempt, RECONNECT_BACKOFF_MS.length - 1)]!;
    this.attempt++;
    // The two fields the 2026-10-28 1006 storm lacked (SYS-1311): every drop there
    // printed a message-less `Mic error: ` + close 1006, and which layer killed the
    // socket (TLS? edge?) was undecidable from the log. The error's code names the layer
    // (ECONNRESET, ENOTFOUND, a ws protocol code…); the age separates a socket that
    // never got through its handshake from one that was up and then died.
    const err = this.socketError;
    const errField = err
      ? [err.code, err.message].filter(Boolean).join(" ") || "<no code, no message>"
      : "none seen";
    const age = this.connectStartedAt ? `${Date.now() - this.connectStartedAt}ms` : "?";
    this.emit("reconnecting", this.attempt, `${reason}, error=${errField}, connected-for=${age}`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private flushPending(ws: WebSocket): void {
    if (!this.pending.length) return;
    const chunks = this.pending;
    this.pending = [];
    this.pendingBytes = 0;
    for (const c of chunks) {
      if (ws.readyState === WebSocket.OPEN) ws.send(c);
    }
  }

  sendAudio(pcmChunk: Buffer): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(pcmChunk);
      return;
    }
    if (this.closing) return;
    // Socket is down: hold the audio for the reconnect rather than dropping it.
    this.pending.push(pcmChunk);
    this.pendingBytes += pcmChunk.length;
    while (this.pendingBytes > RECONNECT_BUFFER_BYTES && this.pending.length > 1) {
      this.pendingBytes -= this.pending.shift()!.length;
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
    // From here on a close is intentional: no reconnect, no heartbeat.
    this.closing = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      this.close();
      return;
    }

    // Speech captured during a reconnect gap would otherwise die with the process.
    this.flushPending(ws);

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
    this.closing = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
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
          text: chunkEventText(text),
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

export function addWavHeader(pcmData: Buffer, sampleRate: number): Buffer {
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

/**
 * The text of a chunked backend's event (`SonioxChunkClient`, `WhisperLocalClient`): the chunk,
 * trimmed, with ONE leading space. A chunk is transcribed on its own and ends at a word, so its
 * start is a word boundary — and the leading space is the only way a consumer of the stream
 * learns that. The real-time client's tokens carry it from Soniox; without it here, the next
 * chunk glued onto the previous one: the fast lane read `…Copilot` + `rajzold` as one word
 * (fast-lane-opener-boundary waits for an observed boundary after an opener), and the writer
 * marked every chunk resumption `midWord`, so the stitch joined two words into one.
 */
export function chunkEventText(text: string): string {
  return ` ${text.trim()}`;
}
