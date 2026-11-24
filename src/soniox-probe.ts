/**
 * The secret-free Soniox RT endpoint probe — `set-copilot probe` (SYS-1311).
 *
 * The 2026-10-28 1006 storm left "which layer killed the socket?" undecidable, and
 * answering it took a five-minute hand-written /tmp probe. This is that probe, built in.
 * It reads NO config and NO .env: with a hardcoded DUMMY key it only measures whether
 * the path delivers the server's verdict —
 *
 *   DNS → TCP → TLS → WS upgrade → the Soniox L7 answer, in band.
 *
 * On a healthy path the server rejects the dummy key in band (error_code 401,
 * unauthenticated) within seconds and closes cleanly — exit 0. Every other reading
 * (transport error, a bare close 1006, another in-band code, silence) is printed and
 * exited 1. Read it against the capture log: a drop storm plus a RED probe indicts the
 * machine's outbound path or the layer below the protocol (the reconnecting line's
 * new error=/connected-for= fields name it); a GREEN probe during a storm means the
 * endpoint speaks and the loss is below L7 on the client side.
 */
import WebSocket from "ws";

export const SONIOX_RT_URL = "wss://stt-rt.soniox.com/transcribe-websocket";
/** Bounded: a probe that hangs is itself a finding, not something to wait out. */
export const PROBE_TIMEOUT_MS = 15_000;
const HANDSHAKE_TIMEOUT_MS = 10_000;

export interface SonioxProbeResult {
  ok: boolean;
  verdict: string;
  handshakeMs?: number;
}

export async function runSonioxProbe(
  log: (line: string) => void = (line) => console.log(line),
): Promise<SonioxProbeResult> {
  const startedAt = Date.now();
  return await new Promise<SonioxProbeResult>((resolve) => {
    let done = false;
    const finish = (result: SonioxProbeResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { ws.terminate(); } catch { /* already dead */ }
      log(`[set-copilot] probe: ${result.verdict}`);
      resolve(result);
    };

    // The DUMMY key is the point: this probe must never carry a real secret, so it can
    // run from any checkout, any session, without touching .env.
    const ws = new WebSocket(SONIOX_RT_URL, { handshakeTimeout: HANDSHAKE_TIMEOUT_MS });

    const timer = setTimeout(() => {
      finish({
        ok: false,
        verdict: `no answer of any kind within ${PROBE_TIMEOUT_MS / 1000}s — the path is black-holing; check the machine's outbound network`,
      });
    }, PROBE_TIMEOUT_MS);

    ws.on("open", () => {
      const handshakeMs = Date.now() - startedAt;
      log(`[set-copilot] probe: handshake OPEN in ${handshakeMs}ms — sending the config with a DUMMY key (secret-free)`);
      ws.send(JSON.stringify({
        api_key: "DUMMY",
        model: "stt-rt-v5",
        language_hints: ["hu"],
        sample_rate: 16000,
        audio_format: "s16le",
        num_channels: 1,
      }));
    });

    ws.on("message", (data: Buffer | string) => {
      let msg: { error_code?: number; error_type?: string } = {};
      try { msg = JSON.parse(String(data)); } catch { /* a non-JSON answer is a finding */ }
      const handshakeMs = Date.now() - startedAt;
      if (msg.error_code === 401 || msg.error_type === "unauthenticated") {
        const detail = [
          msg.error_code != null ? `error_code ${msg.error_code}` : "",
          msg.error_type ?? "",
        ].filter(Boolean).join(" ");
        finish({
          ok: true,
          handshakeMs,
          verdict: `path healthy — DNS→TCP→TLS→WS upgrade→L7 all answered; the server judged the DUMMY key in band (${detail}) in ${handshakeMs}ms`,
        });
      } else {
        finish({
          ok: false,
          handshakeMs,
          verdict: `unexpected in-band answer in ${handshakeMs}ms: ${String(data).slice(0, 200)}`,
        });
      }
    });

    ws.on("error", (err: Error) => {
      const e = err as NodeJS.ErrnoException;
      const code = typeof e.code === "string" ? e.code : "-";
      finish({
        ok: false,
        verdict: `transport error before any in-band answer: ${code}${err.message ? ` ${err.message}` : " (no message)"} — this is the layer the reconnecting line's error= field names`,
      });
    });

    ws.on("close", (code: number) => {
      // An error's own close lands here after finish() already resolved; a BARE close
      // without any prior event is the message-less 1006 the 2026-10-28 storm printed.
      finish({
        ok: false,
        verdict: `socket closed (code=${code}) with no in-band answer — the message-less 1006 signature; the kill happened below the protocol (TLS or edge), not at the Soniox L7`,
      });
    });
  });
}
