import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { renderAlerts, renderCopilotPrompt, renderDrawingContract } from "./copilot-prompt.js";
import { compileRedactor } from "./wall/redaction.js";
import {
  DEFAULT_ALERTS,
  DEFAULT_CATEGORIES,
  DEFAULT_DRAWING_CONVENTIONS,
  DEFAULT_REDACTION,
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
describe("spoken commands — the fast lane", () => {
  const withLane = (over = {}) => renderCopilotPrompt(cfg({
    alerts: DEFAULT_ALERTS,
    fastLane: { enabled: true, start: ["copilot"], end: ["csináld"], maxSpanMs: 45_000, maxChars: 600, ...over },
  } as never));

  it("teaches the command event, that it is an instruction, and that it outranks the turn order", () => {
    const out = withLane();
    expect(out).toContain('{"type":"command"');
    expect(out).toMatch(/instruction, not a topic/);
    expect(out).toMatch(/ahead of everything in the turn order/);
  });

  it("names the project's own markers rather than the shipped ones", () => {
    const out = withLane({ start: ["figyelj"], end: ["mehet"] });
    expect(out).toMatch(/FIGYELJ … MEHET/);
    expect(out).toContain("Opening words: figyelj");
    expect(out).not.toContain("csináld");
  });

  it("warns that the raw line still carries the words, so one command is not done twice", () => {
    expect(withLane()).toMatch(/Act on the event, not on the line/);
  });

  it("forbids acting on a partial instruction, and says why", () => {
    const out = withLane();
    expect(out).toContain('{"type":"command-abandoned"');
    expect(out).toMatch(/Do not execute a partial instruction/);
    expect(out).toMatch(/believes they were understood/);
  });

  it("renders nothing when the lane is disabled — no phantom vocabulary", () => {
    expect(withLane({ enabled: false })).not.toContain("## Spoken commands");
  });

  it("says nothing about it when the config carries no lane at all", () => {
    expect(renderCopilotPrompt(cfg({ alerts: DEFAULT_ALERTS }))).not.toContain("## Spoken commands");
  });
});

describe("turn order — the latency lever", () => {
  // Measured 2026-08-23: 39.4 s to a reaction, of which 14.5 s was waiting for the next
  // poll and 24.9 s the model turn — one batched emit per cycle, composed all at once,
  // so the alert paid for the narration's deliberation.
  it("puts the reaction ahead of narration, batches the rest, and re-polls without a round trip", () => {
    const out = renderCopilotPrompt(cfg({ alerts: DEFAULT_ALERTS }));
    expect(out).toContain("## Turn order — the reaction goes out first");
    expect(out).toMatch(/First tool call.*reaction alone/);
    expect(out).toMatch(/ONE further `wall-emit`/);
    expect(out).toMatch(/chain it onto the same command/);
    // It reorders; it never licenses dropping anything.
    expect(out).toMatch(/never a licence to drop content/);
  });
});

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

  it("teaches the [belső] marking convention, and it matches the shipped redaction default (D8 / 7.2)", () => {
    const out = renderDrawingContract(cats, []).join("\n");
    // The producer must actually be told the convention the default pattern relies on
    // (before this change it was a phantom convention nobody taught).
    expect(out).toContain("[belső]");
    expect(out).toContain('zone:"private"');

    // And the taught convention must really be redacted by the shipped default — a
    // marked span is scrubbed, so what the producer is told is what the engine does.
    const r = compileRedactor(DEFAULT_REDACTION, () => {});
    expect(r.scrub("public [belső] secret tail")).toBe("public […]");
    expect(r.scrub("nothing marked here")).toBe("nothing marked here");
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

  // The contract described staging and said only a promotion lifts a visual public, then
  // documented every payload shape EXCEPT that one. Across four measured real-time runs
  // every prediction expired unpromoted. These assertions are what the fix consists of.
  it("teaches the promotion command, the id requirement, and when to promote", () => {
    const out = renderCopilotPrompt(
      wallCfg({ drawing: { enabled: true, conventions: DEFAULT_DRAWING_CONVENTIONS } }),
    );

    // AC-1: the command's shape, not merely its name.
    expect(out).toContain('"kind":"promote"');
    expect(out).toMatch(/\{"kind":"promote","category":"[^"]*","visual":"[^"]*","zone":"public"\}/);

    // AC-2: a staged visual must be identifiable, because the promotion names it.
    expect(out).toMatch(/staged prediction MUST carry a `visual` id/);

    // AC-3: the trigger is the conversation arriving, and expiry is a correct ending.
    expect(out).toMatch(/actually arrives/);
    expect(out).toMatch(/expires unused is a \*correct\* outcome/);

    // The producer asks rather than remembers.
    expect(out).toContain("wall-staged");
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

  it("renders the predictive mandate from the staging box policy, and nothing when absent", () => {
    // The predictive mandate is box policy (predictive-staging D5): renderBoxPolicies
    // surfaces it in the box's section, so it needs no dedicated renderer.
    const withMandate = renderCopilotPrompt(
      wallCfg([
        {
          name: "én", route: "/", zones: ["private"], layout: "third-two-thirds",
          boxes: { szöveg: { behavior: "latest", cats: ["előrejelzés"], policy: { instructions: "Rajzold ELŐRE a valószínű következő vizuált, staged." } } },
        },
      ]),
    );
    expect(withMandate).toContain("Rajzold ELŐRE");

    // A box that declares no predictive mandate shows none — the mandate is config, not
    // baked into the engine.
    const withoutMandate = renderCopilotPrompt(
      wallCfg([
        {
          name: "én", route: "/", zones: ["private"], layout: "third-two-thirds",
          boxes: { szöveg: { behavior: "scroll", cats: ["előrejelzés"] } },
        },
      ]),
    );
    expect(withoutMandate).not.toContain("Rajzold ELŐRE");
    expect(withoutMandate).not.toContain("## Per-box policy");
  });

});

describe("narration mandate (live-narration)", () => {
  // A minimal copilot with drawing off and no wall, so renderCopilotPrompt is exactly
  // renderAlerts + (optionally) the narration section — letting us prove byte-identity.
  const base = (narration: CopilotConfig["copilot"]["narration"]): CopilotConfig =>
    cfg({
      alerts: DEFAULT_ALERTS,
      engagement: "reactive",
      maxLines: 3,
      allowWebResearch: false,
      acknowledge: true,
      drawing: { enabled: false, conventions: [] },
      names: [],
      narration,
    } as CopilotConfig["copilot"]);

  it("renders the mandate + verbosity when enabled", () => {
    const out = renderCopilotPrompt(base({ enabled: true, verbosity: "normal", maxLines: 1 }));
    expect(out).toContain("## Narration");
    expect(out).toContain("Verbosity — normal");
    expect(out).toContain("At most **1** line(s) per emission.");
    // NO-FILLER is stated explicitly — the change's most fragile point.
    expect(out).toContain("NO FILLER");
    expect(out).toContain('zone:"private"');
  });

  it("renders a louder verbosity verbatim", () => {
    const out = renderCopilotPrompt(base({ enabled: true, verbosity: "rich", maxLines: 3 }));
    expect(out).toContain("Verbosity — rich");
    expect(out).toContain("At most **3** line(s) per emission.");
  });

  it("disabled → no mandate, and the reactive policy is byte-for-byte unchanged", () => {
    const off = renderCopilotPrompt(base({ enabled: false, verbosity: "normal", maxLines: 1 }));
    const on = renderCopilotPrompt(base({ enabled: true, verbosity: "normal", maxLines: 1 }));
    expect(off).not.toContain("## Narration");
    // The reactive alert/engagement/feedback text is exactly renderAlerts — narration
    // never perturbs it — and the enabled output only *appends* the mandate to it.
    expect(off).toBe(renderAlerts(DEFAULT_ALERTS, base({ enabled: false, verbosity: "normal", maxLines: 1 }).copilot));
    expect(on.startsWith(off)).toBe(true);
  });
});
