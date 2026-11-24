/**
 * The probe (SYS-1311): secret-free by construction, bounded, and every failure shape
 * is a distinct reading. The socket is mocked — no network in the tests.
 */
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sockets: FakeSocket[] = [];

class FakeSocket extends EventEmitter {
  static OPEN = 1;
  readyState = 0;
  sent: unknown[] = [];
  constructor(public url: string, public opts?: unknown) {
    super();
    sockets.push(this);
  }
  send(data: unknown): void { this.sent.push(data); }
  terminate(): void { this.readyState = 3; }
  close(): void { this.readyState = 3; }
  open(): void { this.readyState = 1; this.emit("open"); }
  answer(obj: unknown): void { this.emit("message", JSON.stringify(obj)); }
}

vi.mock("ws", () => ({ default: FakeSocket }));

const { runSonioxProbe, SONIOX_RT_URL } = await import("./soniox-probe.js");

beforeEach(() => {
  sockets.length = 0;
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => vi.useRealTimers());

describe("soniox probe", () => {
  it("sends the DUMMY key against the documented URL and passes on the in-band 401", async () => {
    const lines: string[] = [];
    const p = runSonioxProbe((l) => lines.push(l));
    vi.advanceTimersByTime(505); // the measured healthy handshake
    sockets[0]!.open();
    const config = JSON.parse(String(sockets[0]!.sent[0]));
    expect(sockets[0]!.url).toBe(SONIOX_RT_URL);
    expect(config.api_key).toBe("DUMMY"); // the secret-free promise, pinned
    expect(config.model).toBe("stt-rt-v5");
    sockets[0]!.answer({ error_code: 401, error_type: "unauthenticated" });
    const r = await p;
    expect(r.ok).toBe(true);
    expect(r.handshakeMs).toBe(505);
    expect(lines.join("\n")).toContain("path healthy");
  });

  it("reports a message-less error as the below-protocol kill, with its (missing) code", async () => {
    const p = runSonioxProbe(() => {});
    sockets[0]!.emit("error", new Error(""));
    const r = await p;
    expect(r.ok).toBe(false);
    expect(r.verdict).toContain("(no message)");
  });

  it("names a transport error's code — the layer the reconnect line carries", async () => {
    const p = runSonioxProbe(() => {});
    sockets[0]!.emit("error", Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }));
    const r = await p;
    expect(r.ok).toBe(false);
    expect(r.verdict).toContain("ENOTFOUND");
  });

  it("reports a bare close 1006 with no prior events at all", async () => {
    const p = runSonioxProbe(() => {});
    sockets[0]!.emit("close", 1006);
    const r = await p;
    expect(r.ok).toBe(false);
    expect(r.verdict).toContain("1006");
    expect(r.verdict).toContain("below the protocol");
  });

  it("treats an unexpected in-band code as a finding and shows the payload", async () => {
    const p = runSonioxProbe(() => {});
    sockets[0]!.open();
    sockets[0]!.answer({ error_code: 403 });
    const r = await p;
    expect(r.ok).toBe(false);
    expect(r.verdict).toContain("403");
  });

  it("times out bounded when nothing answers at all", async () => {
    const p = runSonioxProbe(() => {});
    vi.advanceTimersByTime(15_000);
    const r = await p;
    expect(r.ok).toBe(false);
    expect(r.verdict).toContain("black-holing");
  });
});
