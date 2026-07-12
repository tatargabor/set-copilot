/**
 * Source resolution for the markdown adapter.
 *
 * `knowledge.sources` entries are whatever the project's docs actually look like:
 * a directory ("docs/knowledge"), a single file ("ARCHITECTURE.md"), or a glob
 * ("docs/**\/*.md", "notes/2026-*.md"). No layout is assumed and no dependency is
 * added — the glob support here is deliberately small: `**`, `*`, `?`.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";

const MAGIC = /[*?]/;

/** Turn a glob into a regex anchored at the (already-resolved) root. */
export function globToRegExp(pattern: string): RegExp {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        // `**/` spans directories (including zero of them); a bare `**` spans the rest
        i++;
        if (pattern[i + 1] === "/") {
          i++;
          out += "(?:.*/)?";
        } else {
          out += ".*";
        }
      } else {
        out += "[^/]*";
      }
    } else if (c === "?") {
      out += "[^/]";
    } else {
      out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${out}$`);
}

function walk(dir: string, out: string[], ext: string): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // unreadable dir — skip rather than kill the digest
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out, ext);
    else if (entry.name.endsWith(ext)) out.push(full);
  }
}

/** The longest leading path segment run of a glob that contains no magic chars. */
function staticPrefix(pattern: string): string {
  const segments = pattern.split("/");
  const stat: string[] = [];
  for (const s of segments) {
    if (MAGIC.test(s)) break;
    stat.push(s);
  }
  return stat.join("/");
}

/**
 * Resolve `sources` to a deduped, sorted list of absolute file paths.
 * A pattern that matches nothing is silently skipped — the digest is best-effort.
 */
export function resolveSources(projectRoot: string, sources: string[], ext = ".md"): string[] {
  const found = new Set<string>();

  for (const src of sources) {
    const normalized = src.split(sep).join("/");

    if (!MAGIC.test(normalized)) {
      const abs = resolve(projectRoot, normalized);
      if (!existsSync(abs)) continue;
      if (statSync(abs).isDirectory()) {
        const hits: string[] = [];
        walk(abs, hits, ext);
        hits.forEach((h) => found.add(h));
      } else if (abs.endsWith(ext)) {
        found.add(abs);
      }
      continue;
    }

    // Glob: walk the static prefix, then filter by the pattern.
    const base = resolve(projectRoot, staticPrefix(normalized));
    if (!existsSync(base)) continue;
    const re = globToRegExp(resolve(projectRoot, normalized).split(sep).join("/"));
    const candidates: string[] = [];
    if (statSync(base).isDirectory()) walk(base, candidates, ext);
    else candidates.push(base);
    for (const c of candidates) {
      if (re.test(c.split(sep).join("/"))) found.add(c);
    }
  }

  return [...found].sort();
}
