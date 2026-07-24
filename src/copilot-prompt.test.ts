import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { renderAlerts, renderCopilotPrompt, renderDrawingContract } from "./copilot-prompt.js";
import {
  DEFAULT_ALERTS,
  DEFAULT_CATEGORIES,
  DEFAULT_DRAWING_CONVENTIONS,
  type CopilotConfig,
} from "./config.js";
import type { AlertCategory } from "./knowledge/types.js";
import type { Category } from "./wall/types.js";

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

describe("renderDrawingContract", () => {
  const cats: Category[] = [
    { id: "súgás", label: "Súgás", icon: "💡", render: "text" },
    { id: "architektúra", label: "Architektúra", icon: "🕸", render: "graph" },
    { id: "metrika", label: "Metrika", icon: "📊", render: "chart" },
  ];

  it("lists the configured categories with their render types", () => {
    const out = renderDrawingContract(cats, []).join("\n");
    expect(out).toContain("`súgás`");
    expect(out).toContain("**text**");
    expect(out).toContain("`architektúra`");
    expect(out).toContain("**graph**");
    expect(out).toContain("`metrika`");
    expect(out).toContain("**chart**");
  });

  it("states the fork mechanics the producer model depends on", () => {
    const out = renderDrawingContract(cats, []).join("\n");
    // fork-producer: the fork inherits context, runs on the parent's model, and
    // is never spawned to wait or to keep a cache warm.
    expect(out).toContain('subagent_type: "fork"');
    expect(out).toContain("inherits this whole context");
    expect(out).toContain("the override is ignored");
    expect(out).toContain("keep a cache warm");
    expect(out).toContain("wall-emit");
  });

  it("renders project conventions verbatim", () => {
    const out = renderDrawingContract(cats, ["Only draw pricing flows.", "Never draw people."]).join("\n");
    expect(out).toContain("- Only draw pricing flows.");
    expect(out).toContain("- Never draw people.");
  });

  it("omits the when-to-draw section when a project configures no conventions", () => {
    const out = renderDrawingContract(cats, []).join("\n");
    expect(out).not.toContain("**When to draw:**");
    // The mechanics still render — conventions are judgement, not mechanics.
    expect(out).toContain("## Drawing the wall");
  });

  it("renders nothing at all when there are no categories", () => {
    expect(renderDrawingContract([], ["ignored"])).toEqual([]);
  });
});

describe("drawing contract in the full prompt", () => {
  const wallCfg = (
    copilot: Partial<CopilotConfig["copilot"]>,
    categories: Category[] = DEFAULT_CATEGORIES,
  ): CopilotConfig =>
    ({
      projectRoot: root,
      copilot: { alerts: DEFAULT_ALERTS, ...copilot },
      wall: { categories },
    }) as CopilotConfig;

  it("includes the contract by default", () => {
    const out = renderCopilotPrompt(
      wallCfg({ drawing: { enabled: true, conventions: DEFAULT_DRAWING_CONVENTIONS } }),
    );
    expect(out).toContain("## Drawing the wall");
    expect(out).toContain("**When to draw:**");
    // The default conventions encode the Haiku-worker lesson: don't transcribe.
    expect(out).toContain("you are transcribing, not drawing");
  });

  it("omits the contract when drawing is disabled", () => {
    const out = renderCopilotPrompt(
      wallCfg({ drawing: { enabled: false, conventions: DEFAULT_DRAWING_CONVENTIONS } }),
    );
    expect(out).not.toContain("## Drawing the wall");
  });

  it("carries a project's renamed categories through with no skill edit", () => {
    // fork-producer "Contract is configurable": swapping the registry in config is
    // enough — nothing in src/ or skills/ names these ids.
    const renamed: Category[] = [
      { id: "hint", label: "Hint", icon: "💡", render: "text" },
      { id: "flow", label: "Flow", icon: "🕸", render: "graph" },
    ];
    const out = renderCopilotPrompt(
      wallCfg({ drawing: { enabled: true, conventions: [] } }, renamed),
    );
    expect(out).toContain("`hint`");
    expect(out).toContain("`flow`");
    expect(out).not.toContain("`architektúra`");
    expect(out).not.toContain("`metrika`");
  });

  it("does not crash on a hand-built config with no wall or drawing section", () => {
    const bare = { projectRoot: root, copilot: { alerts: DEFAULT_ALERTS } } as CopilotConfig;
    expect(() => renderCopilotPrompt(bare)).not.toThrow();
    expect(renderCopilotPrompt(bare)).not.toContain("## Drawing the wall");
  });
});

describe("renderBoxPolicies", () => {
  const wallCfg = (windows: unknown[]) =>
    ({
      projectRoot: root,
      copilot: { alerts: DEFAULT_ALERTS },
      wall: {
        categories: DEFAULT_CATEGORIES,
        layouts: [{ id: "third-two-thirds", areas: [["szöveg", "prezentáció"]], columns: ["1fr", "2fr"] }],
        windows,
      },
    }) as unknown as CopilotConfig;

  it("renders nothing when no box declares a policy — the common case stays compact", () => {
    const out = renderCopilotPrompt(
      wallCfg([
        {
          name: "én", route: "/", zones: ["private", "both"], layout: "third-two-thirds",
          boxes: { szöveg: { behavior: "scroll", cats: ["súgás"] } },
        },
      ]),
    );
    expect(out).not.toContain("## Per-box policy");
  });

  it("renders one section per policy-declaring box, naming zone and surface", () => {
    const out = renderCopilotPrompt(
      wallCfg([
        {
          name: "én", route: "/", zones: ["private", "both"], layout: "third-two-thirds",
          boxes: {
            szöveg: { behavior: "scroll", cats: ["súgás"], policy: { instructions: "Ellenőrizd, amit mond." } },
            prezentáció: { behavior: "latest", cats: ["architektúra"] },
          },
        },
        {
          name: "fal", route: "/wall", zones: ["public", "both"], layout: "third-two-thirds",
          boxes: { szöveg: { behavior: "scroll", cats: ["súgás"], policy: { instructions: "Narrálj." } } },
        },
      ]),
    );
    expect(out).toContain("## Per-box policy");
    expect(out).toContain("### én → szöveg");
    expect(out).toContain("### fal → szöveg");
    // A reader can tell the two mandates apart without opening the config.
    expect(out).toContain("Ellenőrizd, amit mond.");
    expect(out).toContain("Narrálj.");
    // The box with no policy of its own is not given a section.
    expect(out).not.toContain("### én → prezentáció");
  });

  it("prints only the overridden keys, so inherited values cannot drift", () => {
    const out = renderCopilotPrompt(
      wallCfg([
        {
          name: "én", route: "/", zones: ["private"], layout: "third-two-thirds",
          boxes: { szöveg: { behavior: "scroll", cats: ["súgás"], policy: { engagement: "participant" } } },
        },
      ]),
    );
    expect(out).toContain("Engagement: **participant**");
    expect(out).not.toContain("Max lines:");
  });

  it("reads a policy instructions file when the string is a path", () => {
    writeFileSync(join(root, "box.md"), "Fájlból jövő szabály.\n");
    const out = renderCopilotPrompt(
      wallCfg([
        {
          name: "én", route: "/", zones: ["private"], layout: "third-two-thirds",
          boxes: { szöveg: { behavior: "scroll", cats: ["súgás"], policy: { instructions: "box.md" } } },
        },
      ]),
    );
    expect(out).toContain("Fájlból jövő szabály.");
  });

  it("does not throw on a config with no wall section at all", () => {
    expect(() => renderCopilotPrompt({ projectRoot: root, copilot: { alerts: DEFAULT_ALERTS } } as CopilotConfig)).not.toThrow();
  });
});
