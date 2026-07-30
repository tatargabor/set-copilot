/**
 * The chat→wall mirror's content policy — one implementation, called from two places.
 *
 * It used to live inside `cmdMirrorPolicy` in `cli.ts`, reachable only by spawning a process.
 * The follower needs the same judgement per message, and a process spawn per message would
 * put a fork on the very latency path the follower exists to shorten — so the judgement is
 * here, the CLI subcommand is a thin wrapper over it, and there is still exactly one
 * implementation. (That the hook once carried its own copy in awk is why this file's comment
 * says so out loud.)
 *
 * The decision vocabulary is closed and each value is actionable:
 *   `short`  — below the length floor: an acknowledgement, not wall material
 *   `filler` — matched a configured progress/acknowledgement phrase, at any length
 *   `emit`   — wall material, divided into one or more chunks
 * `short` and `filler` are distinct because the operator's fix differs (raise the floor vs.
 * edit the phrase list), and because the mirror log has to say WHICH rule swallowed a message.
 */

import type { MirrorConfig } from "./config.js";
import { isFillerMessage } from "./config.js";
import { chunkBlocks, fenceAlignedBlocks } from "./mirror-format.js";

export type MirrorDecision = "emit" | "short" | "filler";

export interface MirrorVerdict {
  decision: MirrorDecision;
  /** The pieces to emit, in order. Empty unless `decision === "emit"`. */
  chunks: string[];
}

/**
 * Apply a fenced code block's configured handling. `keep` (the default) returns the text
 * untouched: a coding copilot's message is largely code, and the hook used to discard every
 * block unconditionally, which defeated the purpose of mirroring.
 */
export function applyCodeBlocks(text: string, mode: MirrorConfig["codeBlocks"]): string {
  if (mode === "keep") return text;
  const out: string[] = [];
  let block: string[] | null = null;
  let lang = "";
  for (const line of text.split("\n")) {
    const fence = /^\s*```(.*)$/.exec(line);
    if (fence) {
      if (block === null) { block = []; lang = fence[1].trim(); continue; }
      if (mode === "collapse") out.push(`[kód${lang ? `: ${lang}` : ""}, ${block.length} sor]`);
      block = null;
      continue;
    }
    if (block) block.push(line);
    else out.push(line);
  }
  // An unterminated fence: its content was buffered, so put it back rather than losing it.
  if (block) out.push(...block);
  return out.join("\n");
}

/** Drop leading/trailing blank lines only — never a per-line trim, which would flatten code indentation. */
function trimBlankEdges(text: string): string {
  const lines = text.split("\n");
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines.join("\n");
}

/**
 * Decide what (if anything) a message contributes to the wall, and how it is divided.
 *
 * Order matters and is deliberate:
 *   1. code-block handling — the project's declared choice about existing fences
 *   2. blank-edge trim
 *   3. suppression (length floor, then the phrase policy, which applies INDEPENDENTLY of
 *      length so a long-winded "dolgozom rajta" is suppressed too)
 *   4. fencing of alignment-dependent blocks — only under `keep`: `strip`/`collapse` are a
 *      project saying it does not want monospace blocks on its wall, and adding a fence
 *      right after removing them would override that choice
 *   5. chunking on block boundaries
 */
export function applyMirrorPolicy(raw: string, p: MirrorConfig): MirrorVerdict {
  const text = trimBlankEdges(applyCodeBlocks(raw, p.codeBlocks));

  if (text.length < p.minLength) return { decision: "short", chunks: [] };
  if (isFillerMessage(text, p.fillerPhrases)) return { decision: "filler", chunks: [] };

  const fenced = p.codeBlocks === "keep" ? fenceAlignedBlocks(text) : text;
  return { decision: "emit", chunks: chunkBlocks(fenced, p.maxLength) };
}
