import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { renderAlerts, renderCopilotPrompt } from "./copilot-prompt.js";
import { DEFAULT_ALERTS, type CopilotConfig } from "./config.js";
import type { AlertCategory } from "./knowledge/types.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "sc-prompt-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const cfg = (copilot: CopilotConfig["copilot"]): CopilotConfig =>
  ({ projectRoot: root, copilot }) as CopilotConfig;

describe("renderAlerts", () => {
  it("orders categories by priority, highest first", () => {
    const alerts: AlertCategory[] = [
      { key: "low one", emoji: "❓", priority: "low", when: "l" },
      { key: "high one", emoji: "⚠", priority: "high", when: "h" },
      { key: "mid one", emoji: "📋", priority: "medium", when: "m" },
    ];
    const order = [...renderAlerts(alerts).matchAll(/^\S+ \*\*(.+?)\*\* \(/gm)].map((m) => m[1]);
    expect(order).toEqual(["HIGH ONE", "MID ONE", "LOW ONE"]);
  });

  it("renders the Feedback block by default (acknowledge on)", () => {
    const out = renderAlerts(DEFAULT_ALERTS);
    expect(out).toContain("## Feedback — liveness & wall echo");
    expect(out).toContain("Direct address");
    expect(out).toContain("Wall echo");
  });

  it("omits the Feedback block when acknowledge is off", () => {
    const out = renderAlerts(DEFAULT_ALERTS, { acknowledge: false });
    expect(out).not.toContain("## Feedback");
  });

  it("renders each category's trigger condition verbatim", () => {
    const out = renderAlerts([
      { key: "pricing", emoji: "💰", priority: "high", when: "a discount over 20% is offered" },
    ]);
    expect(out).toContain("💰 **PRICING** (high priority)");
    expect(out).toContain("Speak up when: a discount over 20% is offered");
  });

  it("emits the notify command only for categories that ask for it", () => {
    const withNotify = renderAlerts([
      { key: "pricing", emoji: "💰", priority: "high", notify: true, when: "x" },
    ]);
    expect(withNotify).toContain("set-copilot notify");
    expect(withNotify).toContain("desktop notification");

    const without = renderAlerts([{ key: "pricing", emoji: "💰", priority: "high", when: "x" }]);
    expect(without).not.toContain("set-copilot notify");
  });

  it("always instructs silence for anything uncategorised", () => {
    expect(renderAlerts(DEFAULT_ALERTS)).toContain("say nothing");
  });

  it("uses an explicit label over the key when given", () => {
    const out = renderAlerts([
      { key: "contradiction", label: "ütközés", emoji: "⚠", priority: "high", when: "x" },
    ]);
    expect(out).toContain("**ÜTKÖZÉS**");
  });
});

describe("renderCopilotPrompt", () => {
  it("appends the project's instructions file verbatim", () => {
    writeFileSync(join(root, "prompt.md"), "Domain terms are Hungarian. Dates are DD/MM.\n");
    const out = renderCopilotPrompt(cfg({ instructions: "prompt.md", alerts: DEFAULT_ALERTS }));
    expect(out).toContain("## Project instructions");
    expect(out).toContain("Domain terms are Hungarian. Dates are DD/MM.");
  });

  it("omits the instructions section when none is configured", () => {
    const out = renderCopilotPrompt(cfg({ alerts: DEFAULT_ALERTS }));
    expect(out).not.toContain("## Project instructions");
    expect(out).toContain("## Alert categories");
  });

  it("says so loudly when the instructions file is missing, rather than failing silently", () => {
    const out = renderCopilotPrompt(cfg({ instructions: "gone.md", alerts: DEFAULT_ALERTS }));
    expect(out).toContain("gone.md");
    expect(out).toContain("does not exist");
  });
});

/**
 * How talkative the copilot is used to be hardcoded ("anything else: say nothing"),
 * which made a bug-triage watcher and a design-call participant impossible to express
 * in the same package. It is config now, so these assertions guard the three levels.
 */
describe("engagement", () => {
  const alerts: AlertCategory[] = [{ key: "x", emoji: "⚠", priority: "high", when: "w" }];

  it("defaults to reactive — a watcher that stays silent between alerts", () => {
    const out = renderAlerts(alerts);
    expect(out).toContain("**reactive.**");
    expect(out).toContain("say nothing");
    expect(out).toContain("at most 3 lines");
  });

  it("participant mode licenses confirming, refuting and adding — but still not filler", () => {
    const out = renderAlerts(alerts, { engagement: "participant", maxLines: 6 });
    expect(out).toContain("**participant.**");
    expect(out).toContain("Refute");
    expect(out).toContain("Confirm");
    expect(out).toContain("Still no filler");
    expect(out).toContain("at most 6 lines");
    expect(out).not.toContain("**reactive.**");
  });

  it("silent mode drops everything below high priority", () => {
    const out = renderAlerts(alerts, { engagement: "silent" });
    expect(out).toContain("**silent.**");
    expect(out).toContain("high");
  });

  it("mentions web research only when it is allowed", () => {
    expect(renderAlerts(alerts, { engagement: "participant" })).not.toContain("WebSearch");
    expect(
      renderAlerts(alerts, { engagement: "participant", allowWebResearch: true }),
    ).toContain("WebSearch");
  });
});
