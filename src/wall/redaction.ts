/**
 * Public-zone redaction — the ENGINE (public-redaction capability).
 *
 * The mechanism lives here; the *taxonomy* (which patterns mark something
 * sensitive) is config, in `wall.redaction`. This module never hard-codes a
 * project's names — that would leak one project into every other.
 *
 * Why this exists, and why the shape it has: an earlier field-list scrubber was
 * built, then four independent adversarial verifiers reproduced leaks through it —
 * free-form payload keys the list never enumerated, tokens inside URLs, private
 * graph history replayed to a later public join, and a `(a+)+$` pattern that stalled
 * the wall for 9 seconds. Each of those is a design constraint here:
 *
 *  - **Recursive, not a field list (D1).** The `DisplayEvent` payload is open
 *    (`GraphNode`/`ChartDatum` carry `[k: string]: unknown`), so `redactValue`
 *    walks the whole tree and scrubs every *string leaf* at any depth under any key.
 *    A list can never be complete; a walk is closed to future keys too.
 *  - **URL → withhold, never scrub (D2).** A token in `image.src`/`webpage.url`
 *    cannot be removed while leaving the URL usable, so a match there withholds the
 *    WHOLE event from the public zone rather than emitting a mangled link.
 *  - **Fail-closed (D5).** Any failure — a leaf too long to bound, an unexpected
 *    shape, a pattern throwing — withholds the event from public. This is the one
 *    place the wall departs from its usual "drop it and carry on": here carrying on
 *    IS the leak.
 *  - **Bounded evaluation (D6).** Patterns run on the server's single thread, and come
 *    only from config. Two structural limits at compile time — no repeated group (kills
 *    the exponential class) and ≤2 unbounded quantifiers (caps polynomial backtracking
 *    at quadratic) — plus a per-leaf length cap that bounds that quadratic, so one event
 *    can never stall every connected wall. See `isCatastrophic` / `unboundedQuantifierCount`.
 *
 * It is a shape-matcher, not a classifier and not a security boundary. `zone:
 * "private"` remains the only reliable way to keep something off the public wall.
 */

import { reachesPrivate, reachesPublic, type DisplayEvent, type RedactionConfig } from "./types.js";

/**
 * A pattern compiled into the two forms a redaction needs: a stateless `test`
 * (non-global — `.test()` on a global regex advances `lastIndex` and skips matches)
 * and a global `re` for `String.replace`.
 */
interface CompiledPattern {
  test: RegExp;
  re: RegExp;
}

/** The compiled taxonomy the server holds for the life of a wall. */
export interface CompiledRedactor {
  readonly patternCount: number;
  readonly replacement: string;
  readonly maxInputLength: number;
  /** True if any pattern matches `s`. */
  matches(s: string): boolean;
  /** Replace every matched span in `s` with the replacement marker. */
  scrub(s: string): string;
}

/**
 * Reject any pattern containing a repeated group — a `)` that closes a group and is
 * immediately followed by `*`, `+`, or `{…}`.
 *
 * This is deliberately conservative, not a "detect the dangerous ones" heuristic. Two
 * adversarial rounds broke pattern-shaped detectors: first the alternation-overlap
 * class (`(a|a)+`), then a NESTED quantified group (`(([a-z])+)+$`, measured at 78s)
 * that any single-level `[^()]` scan misses. The lesson: you cannot reliably tell a
 * safe repeated group from a catastrophic one with a regex. So instead of trying,
 * reject them ALL — exponential backtracking in a JS regex structurally REQUIRES a
 * repeated group (a quantifier nested inside another quantifier's scope), so
 * forbidding repeated groups makes the exponential class impossible. Polynomial blowup
 * without a group (`a*a*…`) stays possible but is bounded by the per-leaf length cap.
 *
 * The cost is a false positive on a fixed-body repeat like `(ab)+` (linear, but
 * rejected). That is acceptable: redaction taxonomies match tokens and markers, not
 * repeated groups, and the shipped defaults use none — a dropped pattern warns loudly
 * and the operator rewrites. In the highest-stakes code in the project, a provable
 * bound beats a precise one that the adversary keeps walking around.
 *
 * The scan is escape- and character-class-aware so a literal `\)` or a `)` inside
 * `[...]` is not mistaken for a group close.
 */
export function isCatastrophic(src: string): boolean {
  let escaped = false;
  let inClass = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (escaped) { escaped = false; continue; }
    if (c === "\\") { escaped = true; continue; }
    if (inClass) { if (c === "]") inClass = false; continue; }
    if (c === "[") { inClass = true; continue; }
    if (c === ")") {
      const next = src[i + 1];
      // `*` `+` `{` = repeated group (unbounded or bounded-but-ambiguous) → reject.
      // `)?` (optional group) and a bare `)` are bounded and safe → allowed.
      if (next === "*" || next === "+" || next === "{") return true;
    }
  }
  return false;
}

/**
 * The most unbounded quantifiers a pattern may carry (see `unboundedQuantifierCount`).
 *
 * Group rejection above kills the EXPONENTIAL ReDoS class; this bounds the POLYNOMIAL
 * one. Sequential overlapping quantifiers backtrack as `C(n-1, k-1)` where `k` is the
 * quantifier count — attacker-tunable degree, so `\d+\d+…\d+$` stalls for a minute on
 * a 40-char input regardless of the length cap (an adversarial pass measured 69s). At
 * `k ≤ 2` that formula collapses to `n-1` — strictly LINEAR in input length — so the
 * per-leaf length cap genuinely bounds the work. This is the provable half of the
 * bound: no more guessing which patterns are dangerous, just a hard structural limit.
 *
 * The shipped default carries exactly two (`[^\]]*` and `[^\n]*`, non-overlapping), so
 * it passes; a redaction taxonomy almost never needs more. An operator who trips the
 * cap gets a load-time warning to simplify.
 */
export const MAX_UNBOUNDED_QUANTIFIERS = 2;

/** Count `+`, `*`, and open-ended `{n,}` quantifiers, ignoring escapes and character classes. */
export function unboundedQuantifierCount(src: string): number {
  let escaped = false;
  let inClass = false;
  let count = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (escaped) { escaped = false; continue; }
    if (c === "\\") { escaped = true; continue; }
    if (inClass) { if (c === "]") inClass = false; continue; }
    if (c === "[") { inClass = true; continue; }
    if (c === "+" || c === "*") { count++; continue; }
    if (c === "{" && /^\{\d+,\}/.test(src.slice(i))) count++; // {n,} unbounded; {n} / {n,m} bounded
  }
  return count;
}

/**
 * Compile the redaction taxonomy. Each pattern is validated independently: a
 * malformed regex or a catastrophic-backtracking construct is dropped with a
 * conspicuous warning and the rest still load (public-redaction: "An invalid config
 * pattern warns, it does not crash"). Compiled with `gu` so `\p{…}` works and the
 * match is Unicode-correct.
 */
export function compileRedactor(
  cfg: RedactionConfig,
  warn: (msg: string) => void = console.warn,
): CompiledRedactor {
  const patterns: CompiledPattern[] = [];
  for (const src of cfg.patterns ?? []) {
    if (typeof src !== "string" || !src) continue;
    if (isCatastrophic(src)) {
      warn(`[set-copilot] wall: DROPPING redaction pattern with a repeated group (ReDoS risk — rewrite without a quantified group): ${JSON.stringify(src)}`);
      continue;
    }
    if (unboundedQuantifierCount(src) > MAX_UNBOUNDED_QUANTIFIERS) {
      warn(`[set-copilot] wall: DROPPING redaction pattern with more than ${MAX_UNBOUNDED_QUANTIFIERS} unbounded quantifiers (ReDoS risk — split it or use bounded {n,m}): ${JSON.stringify(src)}`);
      continue;
    }
    try {
      patterns.push({ test: new RegExp(src, "u"), re: new RegExp(src, "gu") });
    } catch (e) {
      warn(`[set-copilot] wall: DROPPING invalid redaction pattern ${JSON.stringify(src)} — ${(e as Error).message}`);
    }
  }
  const replacement = typeof cfg.replacement === "string" ? cfg.replacement : "[…]";
  // Neutralize `String.replace` special patterns in the replacement: `$&`, `$1`,
  // `` $` ``, `$'` would otherwise re-inject the matched (secret) text a config
  // author almost certainly did not mean to re-publish. `$` → `$$` renders one
  // literal `$`, so the marker string is emitted verbatim.
  const safeReplacement = replacement.replace(/\$/g, "$$$$");
  const maxInputLength = cfg.maxInputLength > 0 ? cfg.maxInputLength : 10_000;

  return {
    patternCount: patterns.length,
    replacement,
    maxInputLength,
    matches(s: string): boolean {
      if (s.length > maxInputLength) throw new RedactionBoundError(s.length, maxInputLength);
      return patterns.some((p) => p.test.test(s));
    },
    scrub(s: string): string {
      if (s.length > maxInputLength) throw new RedactionBoundError(s.length, maxInputLength);
      let out = s;
      for (const p of patterns) out = out.replace(p.re, safeReplacement);
      return out;
    },
  };
}

/** Thrown when a leaf exceeds the length cap — caught by `splitForZones` as a fail-closed withhold. */
export class RedactionBoundError extends Error {
  constructor(len: number, max: number) {
    super(`string leaf of length ${len} exceeds redaction cap ${max}`);
    this.name = "RedactionBoundError";
  }
}

/**
 * Deep-copy `value`, scrubbing every string leaf. Numbers, booleans, null pass
 * through untouched (D1: a non-string leaf is not content). `changed` flips if any
 * scrub altered a string. Structure (objects, arrays, keys) is preserved so the
 * renderer still finds its payload.
 */
function redactValue(value: unknown, r: CompiledRedactor, state: { changed: boolean }): unknown {
  if (typeof value === "string") {
    const scrubbed = r.scrub(value);
    if (scrubbed !== value) state.changed = true;
    return scrubbed;
  }
  if (Array.isArray(value)) return value.map((v) => redactValue(v, r, state));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactValue(v, r, state);
    }
    return out;
  }
  return value;
}

/** The URL leaves that are structured values — a match there withholds (D2), never scrubs. */
function urlSourcesMatch(ev: DisplayEvent, r: CompiledRedactor): boolean {
  const src = ev.image?.src;
  const url = ev.webpage?.url;
  return (typeof src === "string" && r.matches(src)) || (typeof url === "string" && r.matches(url));
}

/** The public/private split of one event, computed once at ingest. */
export interface EventVariants {
  /** What the private view gets: the original, carrying a `redaction` marker if the public copy differs. */
  private: DisplayEvent;
  /** What the public wall gets: a scrubbed copy, or `null` when the event is withheld / not public. */
  public: DisplayEvent | null;
  /** True if anything was scrubbed or the event withheld — drives the private-view marker. */
  redacted: boolean;
}

/**
 * Split an event into its private and public variants (public-redaction D5/D7).
 *
 * Fail-closed throughout: an event that reaches the public zone is only delivered
 * there if redaction *completes and confirms* it is clean or was safely scrubbed.
 * Any throw — over-long leaf, unexpected shape, a pattern error — withholds it from
 * public; the private zone may still receive it, marked.
 *
 *  - Not public-bound (`zone: "private"`) → no redaction; private gets the original.
 *  - URL source matches → withhold from public entirely (D2).
 *  - A content string matches → public gets the scrubbed copy; private is marked.
 *  - Nothing matches → public gets the original unchanged.
 */
export function splitForZones(ev: DisplayEvent, r: CompiledRedactor | null): EventVariants {
  // Not public-bound, or no redactor configured: private gets the original, and a
  // public-bound event with no redactor passes through (the caller ships no default
  // redactor only when redaction is off). A `private`-only event never has a public
  // variant.
  if (!reachesPublic(ev.zone)) return { private: ev, public: null, redacted: false };
  if (!r) return { private: ev, public: ev, redacted: false };
  try {
    if (urlSourcesMatch(ev, r)) {
      return { private: mark(ev, "withheld"), public: null, redacted: true };
    }
    const state = { changed: false };
    const scrubbed = redactValue(ev, r, state) as DisplayEvent;
    if (!state.changed) return { private: ev, public: ev, redacted: false };
    // The scrubbed copy is the public one; it must never carry the private-only marker.
    delete (scrubbed as { redaction?: unknown }).redaction;
    return { private: mark(ev, "redacted"), public: scrubbed, redacted: true };
  } catch (e) {
    // Fail-closed: withhold from public, keep the private copy (marked), warn loudly.
    console.warn(`[set-copilot] wall: WITHHOLDING event from public zone — redaction failed: ${(e as Error).message}`);
    return { private: mark(ev, "withheld"), public: null, redacted: true };
  }
}

/** Clone `ev` with a private-view redaction marker (only when it actually reaches private). */
function mark(ev: DisplayEvent, how: "redacted" | "withheld"): DisplayEvent {
  if (!reachesPrivate(ev.zone)) return ev;
  return { ...ev, redaction: how };
}
