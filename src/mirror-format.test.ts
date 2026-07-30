/**
 * The mirror's formatting rules — block boundaries, fencing, chunking, and the policy verdict.
 *
 * Each test is named for the property being fenced, not the function called. Two of them
 * encode measured field failures: a 2143-character nine-item report that reached the wall as
 * 641 characters (one item of nine), and an ASCII table that reached it unfenced and rendered
 * in a proportional font, unreadable.
 */

import { describe, expect, it } from "vitest";

import { DEFAULTS } from "./config.js";
import { CUT_MARKER, chunkBlocks, fenceAlignedBlocks, hasAlignedColumns, splitBlocks } from "./mirror-format.js";
import { applyMirrorPolicy } from "./mirror-policy.js";

const policy = { ...DEFAULTS.copilot.mirror };

describe("splitBlocks preserves every line", () => {
  it("round-trips the input byte for byte", () => {
    const text = "## Head\n\npara one\nstill one\n\n- a\n- b\n\n| x | y |\n|---|---|\n| 1 | 2 |\n\n```js\ncode\n```\n";
    const blocks = splitBlocks(text);
    expect(blocks.flatMap((b) => b.lines).join("\n")).toBe(text);
  });

  it("recognizes each block kind", () => {
    const blocks = splitBlocks("# H\n\npara\n\n- a\n- b\n\n| x | y |\n|---|---|\n| 1 | 2 |\n\n```\nc\n```");
    expect(blocks.map((b) => b.kind).filter((k) => k !== "blank"))
      .toEqual(["heading", "paragraph", "list", "table", "fence"]);
  });

  it("treats an unterminated fence as paragraph lines, like the wall does", () => {
    // A fence that swallowed the rest of the message would hide everything after it.
    const blocks = splitBlocks("```\nnever closed\nmore text");
    expect(blocks.every((b) => b.kind === "paragraph")).toBe(true);
  });
});

describe("chunking divides, it does not delete the end of a message", () => {
  it("returns one byte-identical chunk when the message fits", () => {
    const text = "## Head\n\nsome body text that is well within any budget";
    expect(chunkBlocks(text, 600)).toEqual([text]);
  });

  it("keeps all nine items of the message the field lost", () => {
    // Measured 2026-07-29: 2143 chars in, 641 out, item one of nine. Never again.
    const items = Array.from({ length: 9 }, (_, i) =>
      `**${i + 1}. Tétel ${i + 1}**\n${"részletes indoklás ".repeat(12)}`);
    const text = `## Fejlesztési igények\n\n${items.join("\n\n")}`;
    const chunks = chunkBlocks(text, 600);
    expect(chunks.length).toBeGreaterThan(1);
    for (let i = 1; i <= 9; i++) expect(chunks.join("\n")).toContain(`${i}. Tétel ${i}`);
  });

  it("never puts a boundary inside a table", () => {
    const table = `| a | b |\n|---|---|\n${"| 1 | 2 |\n".repeat(20)}`.trimEnd();
    const chunks = chunkBlocks(`${"filler text. ".repeat(40)}\n\n${table}`, 300);
    // The separator row proves the table head; a chunk holding rows without it was cut through.
    for (const c of chunks) {
      if (c.includes("| 1 | 2 |")) expect(c).toContain("|---|---|");
    }
  });

  it("never emits an unterminated fence", () => {
    const fence = "```\n" + "aligned  column  here\n".repeat(60) + "```";
    for (const c of chunkBlocks(fence, 300)) {
      expect((c.match(/```/g) ?? []).length % 2).toBe(0);
    }
  });

  it("marks an oversized single block as cut and closes its fence", () => {
    const chunks = chunkBlocks("```\n" + "x".repeat(2000) + "\n```", 300);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toContain(CUT_MARKER);
    expect(chunks[0].endsWith("```")).toBe(true);
  });

  it("keeps chunk order stable", () => {
    const text = Array.from({ length: 12 }, (_, i) => `blokk ${i} ${"szöveg ".repeat(20)}`).join("\n\n");
    const chunks = chunkBlocks(text, 300);
    const positions = chunks.map((c) => /blokk (\d+)/.exec(c)?.[1]).map(Number);
    expect([...positions]).toEqual([...positions].sort((a, b) => a - b));
  });
});

describe("alignment-dependent content is fenced by the sender", () => {
  it("fences an unfenced box-drawing table", () => {
    const ascii = "┌────┬────┐\n│ a  │ b  │\n└────┴────┘";
    expect(fenceAlignedBlocks(ascii)).toBe(`\`\`\`\n${ascii}\n\`\`\``);
  });

  it("fences column-aligned plain text", () => {
    const cols = "Fázis      Állapot    Megjegyzés\nelső       kész       rendben\nmásodik    fut        vár";
    expect(fenceAlignedBlocks(cols).startsWith("```")).toBe(true);
  });

  it("leaves already-fenced content byte-identical", () => {
    const text = "```\n┌──┐\n│ab│\n└──┘\n```";
    expect(fenceAlignedBlocks(text)).toBe(text);
  });

  it("does not fence prose, a list, or a markdown table", () => {
    for (const text of [
      "Ez egy sima bekezdés, ami több\nsorban folytatódik, de nem tábla\nés nincs benne oszlop.",
      "- egy\n- kettő\n- három",
      "| a | b |\n|---|---|\n| 1 | 2 |",
    ]) {
      expect(fenceAlignedBlocks(text)).toBe(text);
    }
  });

  it("does not fence a two-line coincidence", () => {
    expect(hasAlignedColumns(["a  b", "c  d"])).toBe(false);
  });
});

describe("the policy verdict", () => {
  it("suppresses a short message as short, not as filler", () => {
    expect(applyMirrorPolicy("Rendben.", policy).decision).toBe("short");
  });

  it("suppresses a configured filler phrase independently of length", () => {
    const long = { ...policy, minLength: 1 };
    expect(applyMirrorPolicy("Dolgozom rajta", long).decision).toBe("filler");
  });

  it("emits wall material as one chunk when it fits", () => {
    const text = "Ez egy érdemi mondat, ami bőven hosszabb a küszöbnél, és a falra tartozik.";
    expect(applyMirrorPolicy(text, policy)).toEqual({ decision: "emit", chunks: [text] });
  });

  it("survives a malformed filler regex rather than breaking mirroring", () => {
    const broken = { ...policy, fillerPhrases: ["("], minLength: 1 };
    expect(applyMirrorPolicy("Ez érdemi tartalom.", broken).decision).toBe("emit");
  });

  it("does not fence under a code-block policy that removes blocks", () => {
    const ascii = "┌────┬────┐\n│ a  │ b  │\n└────┴────┘";
    const stripped = applyMirrorPolicy(ascii, { ...policy, codeBlocks: "strip", minLength: 1 });
    expect(stripped.chunks.join("")).not.toContain("```");
  });
});
