## 1. Pure tokenizer

- [x] 1.1 Create `src/wall/public/text-format.mjs` (the design said `src/wall/text-format.ts`, but the client must import it in the browser — the project's established home for pure client logic that is also unit-tested is a `.mjs` under `public/`, exactly like `wall-core.mjs`) with a closed node union — blocks (paragraph, code block, bullet list, numbered list, table) and inlines (text, bold, italic, inline code). No node type may represent pass-through markup (D3).
- [x] 1.2 Implement `parseWallText(s): Block[]` covering exactly the closed vocabulary; every other character sequence becomes literal text.
- [x] 1.3 Handle the malformed cases explicitly: unterminated fence, truncated table, unclosed emphasis, a table whose header/separator/rows disagree — each degrades to literal text for the affected region while the rest of the line still parses.

## 2. Tokenizer tests

- [x] 2.1 `src/wall/text-format.test.ts`: one test per supported construct, asserting the node tree.
- [x] 2.2 Unsupported markup (link, image, raw HTML tag) stays literal — assert it appears in a text node verbatim.
- [x] 2.3 Every malformed case from 1.3 degrades without throwing and without losing the surrounding content.
- [x] 2.4 Assert the node union contains no raw/HTML variant — the structural guarantee behind D3.

## 3. DOM builder + styles

- [x] 3.1 Build elements from the node tree with `createElement` + `textContent` only; wire it into `renderText` (`wall.js:347-349`) in place of the single `textContent` assignment.
- [x] 3.2 Render a table as a real `<table>`; give the wall line's content `overflow-x: auto` so a wide table is contained and never reshapes the layout (D4).
- [x] 3.3 Compact styles in `wall.css` sized for 1920×1080: tight list margins, compact table cells, code block with one padding step — dark/light both (D7).
- [x] 3.4 Add the guard test that greps the wall client for `innerHTML` assignments fed by event content, allowlisting the two existing engine-controlled uses (`wall.js:135` pending chrome, `:518` chart SVG) with a comment naming why each is legitimate (D3).

## 4. Mirror policy config

- [x] 4.1 Extend `MirrorConfig` (`src/config.ts:121-131`) with `minLength` (default 40), `maxLength` (default 600), `fillerPhrases` (HU+EN defaults), `codeBlocks: "keep" | "strip" | "collapse"` (default `keep`).
- [x] 4.2 Resolve `fillerPhrases` like `detect.*`: drop a malformed entry with a warning, keep the rest; an explicitly empty list means "length floor only", an absent/malformed key falls back to defaults (D5).
- [x] 4.3 Use Unicode word classes (`\p{L}\p{N}`) for phrase matching, never `\b` — per the project-wide rule.
- [x] 4.4 Tests in `src/config.test.ts`: defaults resolve; empty list is honoured as "no phrases"; a malformed entry is dropped and warns; the remaining entries still apply.

## 5. Hook reads the policy

- [x] 5.1 Add the CLI command that prints the resolved mirror policy as JSON (D6).
- [x] 5.2 Rewrite `hooks/wall-mirror.sh` to apply `minLength`, `maxLength`, `fillerPhrases` and `codeBlocks`, replacing the hardcoded 40/600 and the unconditional awk code-block strip. **Deviation from the task's letter, in service of its intent:** the hook calls `mirror-policy --apply` rather than applying the JSON with `jq`. `fillerPhrases` are Unicode-anchored whole-message regexes, and expressing those in bash would put a second implementation of the policy in the shell — the exact thing this change removes ("the shell script stops being the place where judgement lives"). `mirror-policy` without `--apply` still prints the resolved JSON, per 5.1.
- [x] 5.3 Fall back to the current built-in constants if the policy lookup fails or returns nothing, and mirror anyway — nothing is disclosed by filtering with defaults (D6).
- [x] 5.4 Keep the dedup stamp behavior byte-identical; it is not part of the policy.

## 6. Verify

- [x] 6.1 `npm run build` clean under `tsc` strict; `npm test` green.
- [x] 6.2 Run the wall and emit a real Claude Code message (table + bullet list + fenced code) through `wall-emit`; confirm table, list, and code render as structure and stay inside the box.
- [x] 6.3 Emit a payload containing an HTML fragment and confirm it appears as literal characters with no element created from it.
- [x] 6.4 Emit a public-zone line matching a redaction pattern and confirm redaction still applies before formatting — the marking is visible in the formatted output.
- [x] 6.5 With mirroring enabled, confirm a filler phrase over the length floor is suppressed and a code-bearing message reaches the wall intact.
- [x] 6.6 Check the wall at 1920×1080 (not the dev monitor) and confirm the compact rendering is readable at distance.
