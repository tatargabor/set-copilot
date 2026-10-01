/**
 * The reconnect timeline (soniox-rt). Measured on a two-hour call: every reconnect
 * restarted the channel's clock at zero, and a replaced socket kept delivering tokens on
 * its old clock — two streams feeding one channel, and a transcript that could not be put
 * back in order. These pin the three repairs: one live socket, its late tokens dropped, and
 * every token on the client's own timeline.
 */

import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sockets: FakeSocket[] = [];

class FakeSocket extends EventEmitter {
  static OPEN = 1;
  readyState = 0;
  sent: unknown[] = [];
  constructor(public url: string) {
    super();
    sockets.push(this);
  }
  send(data: unknown): void { this.sent.push(data); }
  ping(): void {}
  terminate(): void { this.readyState = 3; }
  close(): void { this.readyState = 3; }
  open(): void { this.readyState = 1; this.emit("open"); }
  tokens(...t: { text: string; start_ms: number }[]): void {
    this.emit("message", JSON.stringify({ tokens: t.map((x) => ({ ...x, is_final: true })) }));
  }
}

vi.mock("ws", () => ({ default: FakeSocket }));

const { SonioxRtClient } = await import("./soniox-rt.js");

beforeEach(() => {
  sockets.length = 0;
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => vi.useRealTimers());

function client() {
  const c = new SonioxRtClient({ apiKey: "k", sampleRate: 16000 }, "mic");
  const got: { text: string; timestampMs: number }[] = [];
  c.on("transcript", (e) => got.push(e));
  c.on("error", () => {});
  return { c, got };
}

describe("soniox reconnect timeline", () => {
  it("puts a reconnected stream's tokens after the reconnect, not back at zero", () => {
    const { c, got } = client();
    c.connect();
    sockets[0]!.open();
    sockets[0]!.tokens({ text: "before", start_ms: 1_000 });

    vi.advanceTimersByTime(300_000); // five minutes in, the socket drops
    sockets[0]!.emit("close", 1006, Buffer.from(""));
    vi.advanceTimersByTime(500); // backoff → new socket
    sockets[1]!.open();
    sockets[1]!.tokens({ text: "after", start_ms: 200 });

    expect(got.map((e) => e.text)).toEqual(["before", "after"]);
    expect(got[1]!.timestampMs).toBeGreaterThan(300_000);
  });

  it("drops tokens that still arrive on a replaced socket", () => {
    const { c, got } = client();
    c.connect();
    sockets[0]!.open();
    vi.advanceTimersByTime(60_000);
    sockets[0]!.emit("close", 1006, Buffer.from(""));
    vi.advanceTimersByTime(500);
    sockets[1]!.open();
    sockets[0]!.tokens({ text: "stale", start_ms: 59_000 });
    sockets[1]!.tokens({ text: "live", start_ms: 100 });
    expect(got.map((e) => e.text)).toEqual(["live"]);
  });

  it("does not open a second socket when the replaced one closes late", () => {
    const { c } = client();
    c.connect();
    sockets[0]!.open();
    sockets[0]!.emit("close", 1006, Buffer.from(""));
    vi.advanceTimersByTime(500);
    sockets[1]!.open();
    sockets[0]!.emit("close", 1006, Buffer.from("")); // late close of the old socket
    vi.advanceTimersByTime(10_000);
    expect(sockets).toHaveLength(2);
  });

  it("never stamps a token later than now", () => {
    const { c, got } = client();
    c.connect();
    sockets[0]!.open();
    vi.advanceTimersByTime(5_000);
    sockets[0]!.tokens({ text: "early", start_ms: 9_999_999 });
    expect(got[0]!.timestampMs).toBeLessThanOrEqual(5_000);
  });
});
