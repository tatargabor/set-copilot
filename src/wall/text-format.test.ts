import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { NODE_TYPES, parseInline, parseWallText } from "./public/text-format.mjs";

/** Flatten a tree back to the characters it would display — the "nothing was lost" check. */
function textOf(nodes: unknown): string {
  if (Array.isArray(nodes)) return nodes.map(textOf).join("");
  const n = nodes as Record<string, unknown>;
  if (!n || typeof n !== "object") return "";
  switch (n.type) {
    case "text": case "code": case "codeblock": return String(n.value);
    case "bold": case "italic": case "paragraph": return textOf(n.children);
    case "bullets": case "numbers": return textOf(n.items);
    case "table": return textOf(n.header) + textOf(n.rows);
    default: return "";
  }
}

describe("inline vocabulary", () => {
  it("parses bold", () => {
    expect(parseInline("a **b** c")).toEqual([
      { type: "text", value: "a " },
      { type: "bold", children: [{ type: "text", value: "b" }] },
      { type: "text", value: " c" },
    ]);
  });

  it("parses italic", () => {
    expect(parseInline("*b*")).toEqual([{ type: "italic", children: [{ type: "text", value: "b" }] }]);
  });

  it("parses inline code, and code binds tighter than emphasis", () => {
    expect(parseInline("`a **b**`")).toEqual([{ type: "code", value: "a **b**" }]);
  });

  it("nests emphasis", () => {
    expect(parseInline("**a *b* c**")).toEqual([
      { type: "bold", children: [
        { type: "text", value: "a " },
        { type: "italic", children: [{ type: "text", value: "b" }] },
        { type: "text", value: " c" },
      ] },
    ]);
  });

  it("degrades a run of delimiters to literal rather than guessing", () => {
    // `**a *b***` is genuinely ambiguous (CommonMark resolves it with a rule this closed
    // vocabulary deliberately does not carry). Losing no characters is the requirement;
    // picking the "right" nesting is not.
    expect(textOf(parseInline("**a *b***"))).toBe("a *b*");
  });

  it("leaves snake_case alone — underscores are never italic", () => {
    expect(parseInline("run_in_background")).toEqual([{ type: "text", value: "run_in_background" }]);
  });
});

describe("block vocabulary", () => {
  it("parses a paragraph", () => {
    expect(parseWallText("hello there")).toEqual([
      { type: "paragraph", children: [{ type: "text", value: "hello there" }] },
    ]);
  });

  it("parses a fenced code block with its language", () => {
    const out = parseWallText("before\n```ts\nconst a = 1;\nconst b = 2;\n```\nafter");
    expect(out).toHaveLength(3);
    expect(out[1]).toEqual({ type: "codeblock", lang: "ts", value: "const a = 1;\nconst b = 2;" });
    expect(out[2]).toEqual({ type: "paragraph", children: [{ type: "text", value: "after" }] });
  });

  it("parses a bullet list as ONE block, not one block per item", () => {
    const out = parseWallText("- alfa\n- **beta**\n- gamma");
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("bullets");
    expect((out[0] as { items: unknown[] }).items).toHaveLength(3);
  });

  it("parses a numbered list", () => {
    const out = parseWallText("1. első\n2. második");
    expect(out[0].type).toBe("numbers");
    expect((out[0] as { items: unknown[] }).items).toHaveLength(2);
  });

  it("parses a table with alignment", () => {
    const out = parseWallText("| a | b | c |\n| :-- | :-: | --: |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |");
    expect(out).toHaveLength(1);
    const t = out[0] as { type: string; header: unknown[]; rows: unknown[][]; align: string[] };
    expect(t.type).toBe("table");
    expect(t.header).toHaveLength(3);
    expect(t.rows).toHaveLength(2);
    expect(t.align).toEqual(["left", "center", "right"]);
  });

  it("pads a ragged row to the header width rather than rejecting the table", () => {
    const out = parseWallText("| a | b |\n| --- | --- |\n| 1 |");
    const t = out[0] as { type: string; header: unknown[]; rows: unknown[][]; align: string[] };
    expect(t.rows[0]).toHaveLength(2);
  });

  it("keeps a table, a list and prose in one line as separate blocks", () => {
    const out = parseWallText("intro\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n- x\n- y\n\nend");
    expect(out.map((b: { type: string }) => b.type)).toEqual(["paragraph", "table", "bullets", "paragraph"]);
  });
});

describe("unsupported markup stays literal", () => {
  it.each([
    ["a link", "see [the docs](https://example.com) now"],
    ["an image", "![alt](img.png)"],
    ["a raw HTML tag", "<b>bold?</b> and <script>x()</script>"],
    ["a heading", "# not a heading"],
    ["a blockquote", "> not a quote"],
    ["an underscore emphasis", "_not italic_"],
  ])("%s appears verbatim", (_label, input) => {
    const out = parseWallText(input);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("paragraph");
    expect(textOf(out[0])).toBe(input);
  });
});

describe("malformed constructs degrade to literal text", () => {
  it("an unterminated fence does not swallow the rest of the message", () => {
    const input = "before\n```ts\nconst a = 1;\nafter";
    const out = parseWallText(input);
    expect(out.every((b: { type: string }) => b.type !== "codeblock")).toBe(true);
    expect(textOf(out)).toContain("```ts");
    expect(textOf(out)).toContain("after");
  });

  it("a table whose separator disagrees with the header stays literal", () => {
    const input = "| a | b | c |\n| --- | --- |\n| 1 | 2 | 3 |";
    const out = parseWallText(input);
    expect(out.every((b: { type: string }) => b.type !== "table")).toBe(true);
    expect(textOf(out)).toContain("| a | b | c |");
  });

  it("a truncated table (header, no separator) stays literal", () => {
    const out = parseWallText("| a | b |");
    expect(out[0].type).toBe("paragraph");
    expect(textOf(out)).toBe("| a | b |");
  });

  it("an unclosed emphasis is a literal delimiter and the rest still parses", () => {
    const out = parseInline("**unclosed and `code` after");
    expect(out.some((n: { type: string }) => n.type === "code")).toBe(true);
    expect(textOf(out)).toBe("**unclosed and code after");
  });

  it("an unclosed backtick is literal", () => {
    expect(textOf(parseInline("a ` b"))).toBe("a ` b");
  });

  it("empty delimiters are literal, not empty emphasis", () => {
    expect(parseInline("****")).toEqual([{ type: "text", value: "****" }]);
  });

  it("never throws on any of these", () => {
    for (const s of ["", "```", "|", "||", "***", "1.", "- ", "`", "\n\n\n", "|--|"]) {
      expect(() => parseWallText(s)).not.toThrow();
    }
  });
});

describe("the union carries no markup path (D3)", () => {
  /**
   * The safety invariant is STRUCTURAL: the builder cannot pass markup through because
   * there is no node type representing it. If a "raw"/"html" variant is ever added, the
   * builder gains a place to assign markup from event content — do not make this test pass
   * by extending the allowlist.
   */
  it("has no raw or html node type", () => {
    for (const t of NODE_TYPES) expect(t).not.toMatch(/raw|html|markup|unsafe/i);
  });

  it("declares exactly the closed vocabulary", () => {
    expect([...NODE_TYPES].sort()).toEqual([
      "bold", "bullets", "code", "codeblock", "italic", "numbers", "paragraph", "table", "text",
    ]);
  });

  it("emits no node type outside the declared union, for any input", () => {
    const inputs = [
      "**b** *i* `c`", "```js\nx\n```", "- a\n- b", "1. a", "| a | b |\n| - | - |\n| 1 | 2 |",
      "<script>x</script>", "[l](u)", "![i](u)", "***", "|||",
    ];
    const seen = new Set<string>();
    const walk = (n: unknown): void => {
      if (Array.isArray(n)) { n.forEach(walk); return; }
      if (!n || typeof n !== "object") return;
      const node = n as Record<string, unknown>;
      if (typeof node.type === "string") seen.add(node.type);
      for (const v of Object.values(node)) if (typeof v === "object") walk(v);
    };
    for (const s of inputs) walk(parseWallText(s));
    expect([...seen].filter((t) => !NODE_TYPES.includes(t))).toEqual([]);
    expect(seen.size).toBeGreaterThan(5);
  });
});

describe("the wall client builds elements, never markup (D3)", () => {
  /**
   * WEAKENING THIS TEST REOPENS THE MARKUP PATH.
   *
   * Today's safety came from `textContent` doing nothing interesting. Adding a formatter
   * removes that accident, so the "no markup from event content" property has to be
   * checked rather than assumed. Two `innerHTML` uses are legitimate and allowlisted BY
   * LINE CONTENT below — both build engine-controlled chrome with no event-derived string
   * in them. A third one is a bug until proven otherwise; if you add one, prove it carries
   * no event content and add it here with that reasoning, never a blanket skip.
   */
  it("has no innerHTML assignment outside the allowlisted engine-controlled chrome", () => {
    const src = readFileSync(join(process.cwd(), "src", "wall", "public", "wall.js"), "utf-8");
    const offenders = src
      .split("\n")
      .map((line, n) => ({ line: line.trim(), n: n + 1 }))
      .filter(({ line }) => /\.innerHTML\s*(\+)?=/.test(line))
      // The pending-overlay chrome and the hand-built chart SVG: both are template strings
      // of engine constants, with every event-derived value assigned via textContent after.
      .filter(({ line }) => !line.includes("pending") && !line.includes("renderBarChartSVG"));
    expect(offenders).toEqual([]);
  });
});
