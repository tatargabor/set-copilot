import { readFileSync, existsSync } from "node:fs";

import type { KeywordPattern } from "./types.js";

// Word boundaries over any script: \b would treat "á" as a boundary and break
// accented languages. A stem matches from a word start but not to a word end, so
// it still hits inside agglutinated/inflected forms ("szállítólev" inside
// "szállítólevelet", "invoic" inside "invoicing").
const WORD_START = "(?<=^|[^\\p{L}\\p{N}])";
const WORD_END = "(?=$|[^\\p{L}\\p{N}])";

export interface CompiledPattern {
  topic: string;
  re: RegExp;
}

export interface MatcherOptions {
  /**
   * If set (e.g. "DEC"), the matcher also recognises decision references like
   * "DEC-003", "dec 3", "DEC.12" and normalises them to "<PREFIX>-003".
   * New decisions then need no index rebuild.
   */
  decisionIdPrefix?: string;
}

export function compilePatterns(patterns: KeywordPattern[]): CompiledPattern[] {
  return patterns
    .filter((p) => p?.topic && Array.isArray(p.stems) && p.stems.length > 0)
    .map((p) => ({
      topic: p.topic,
      re: new RegExp(WORD_START + "(?:" + p.stems.join("|") + ")", "iu"),
    }));
}

/**
 * Build a `(text) => string[]` topic matcher from compiled patterns.
 * Returns canonical labels, deduped, in index order, decision ids last.
 */
export function buildMatcher(
  patterns: KeywordPattern[],
  opts: MatcherOptions = {},
): (text: string) => string[] {
  const compiled = compilePatterns(patterns);
  const decRe = opts.decisionIdPrefix
    ? new RegExp(
        `${WORD_START}${escapeRegex(opts.decisionIdPrefix)}[-. ]?(\\d{1,3})(?=[^0-9]|$)`,
        "giu",
      )
    : null;

  return (text: string): string[] => {
    if (!text) return [];
    const lower = text.toLowerCase();
    const topics: string[] = [];
    for (const p of compiled) {
      if (p.re.test(lower)) topics.push(p.topic);
    }
    if (decRe) {
      decRe.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = decRe.exec(lower)) !== null) {
        const id = `${opts.decisionIdPrefix}-` + m[1]!.padStart(3, "0");
        if (!topics.includes(id)) topics.push(id);
      }
    }
    return topics;
  };
}

/** Load a compiled keyword-index.json (array of KeywordPattern), or [] if absent/invalid */
export function loadKeywordIndex(path: string): KeywordPattern[] {
  if (!existsSync(path)) return [];
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (p): p is KeywordPattern =>
        typeof p?.topic === "string" &&
        Array.isArray(p?.stems) &&
        p.stems.every((s: unknown) => typeof s === "string"),
    );
  } catch {
    return [];
  }
}

/** Company-form suffixes stripped from entity names before stem generation */
const COMPANY_SUFFIX_RE =
  /\s+(kft\.?|bt\.?|zrt\.?|nyrt\.?|kkt\.?|e\.?v\.?|gmbh|ltd\.?|inc\.?|s\.?r\.?o\.?)\s*$/i;

/** Build a match stem from a raw entity/partner name (regex-escaped, space-tolerant) */
export function stemFromName(name: string): string | null {
  let core = name.trim().replace(COMPANY_SUFFIX_RE, "").trim();
  if (core.length < 3) core = name.trim(); // don't over-strip very short names
  if (core.length < 3) return null;
  const escaped = core
    .toLowerCase()
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "[- ]?");
  // Short names: require a word end too, to avoid substring false positives
  return core.length <= 4 ? escaped + WORD_END : escaped;
}

/** Canonical topic label for an entity name (suffix stripped) */
export function topicFromName(name: string): string {
  return name.trim().replace(COMPANY_SUFFIX_RE, "").trim() || name.trim();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
