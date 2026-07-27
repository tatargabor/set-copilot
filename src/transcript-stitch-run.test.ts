import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { artifactPaths, parseSpeakerMap, resolveInputs } from "./transcript-stitch-run.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sc-stitch-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const touch = (name: string): string => {
  const p = join(dir, name);
  writeFileSync(p, "");
  return p;
};

describe("resolveInputs", () => {
  it("scans a directory for capture output only", () => {
    touch("transcript-2026-07-27T06-00-00Z.jsonl");
    touch("transcript-2026-07-27T07-00-00Z.jsonl");
    touch("dictation-2026-07-01T09-00-00Z.jsonl");
    // A runtime dir also holds these — neither is a transcript.
    touch("wall-events.jsonl");
    touch("keyword-index.json");
    expect(resolveInputs(dir).map((p) => basename(p))).toEqual([
      "dictation-2026-07-01T09-00-00Z.jsonl",
      "transcript-2026-07-27T06-00-00Z.jsonl",
      "transcript-2026-07-27T07-00-00Z.jsonl",
    ]);
  });

  it("never re-ingests its own structured output", () => {
    touch("transcript-a.jsonl");
    touch("transcript-a-stitched.jsonl");
    expect(resolveInputs(dir).map((p) => basename(p))).toEqual(["transcript-a.jsonl"]);
    // Also excluded when a glob would otherwise sweep it in.
    expect(resolveInputs(join(dir, "*.jsonl")).map((p) => basename(p))).toEqual(["transcript-a.jsonl"]);
  });

  it("takes a glob at its word, beyond the directory-scan convention", () => {
    touch("meeting-raw-01.jsonl");
    touch("transcript-b.jsonl");
    // The directory scan skips a non-capture name...
    expect(resolveInputs(dir).map((p) => basename(p))).toEqual(["transcript-b.jsonl"]);
    // ...but an explicit glob matches it.
    expect(resolveInputs(join(dir, "meeting-*.jsonl")).map((p) => basename(p))).toEqual([
      "meeting-raw-01.jsonl",
    ]);
  });

  it("uses an explicit file as given, whatever it is called", () => {
    const p = touch("whatever.jsonl");
    expect(resolveInputs(p)).toEqual([p]);
  });

  it("returns nothing for a missing path instead of throwing", () => {
    expect(resolveInputs(join(dir, "nope.jsonl"))).toEqual([]);
    expect(resolveInputs(join(dir, "nodir", "*.jsonl"))).toEqual([]);
  });

  it("sorts by name, which for the archive stamp is chronological", () => {
    touch("transcript-2026-07-27T09-00-00Z.jsonl");
    touch("transcript-2026-07-27T08-00-00Z.jsonl");
    expect(resolveInputs(dir).map((p) => basename(p))).toEqual([
      "transcript-2026-07-27T08-00-00Z.jsonl",
      "transcript-2026-07-27T09-00-00Z.jsonl",
    ]);
  });
});

describe("artifactPaths", () => {
  it("writes beside the input by default", () => {
    expect(artifactPaths("/x/transcript-1.jsonl")).toEqual({
      markdown: "/x/transcript-1.md",
      structured: "/x/transcript-1-stitched.jsonl",
    });
  });

  it("keeps the sidecar next to an explicit --out", () => {
    expect(artifactPaths("/x/transcript-1.jsonl", "/y/notes.md")).toEqual({
      markdown: "/y/notes.md",
      structured: "/y/notes-stitched.jsonl",
    });
  });
});

describe("parseSpeakerMap", () => {
  it("parses pairs and skips malformed entries rather than failing", () => {
    expect(parseSpeakerMap("mic=Gábor,system=Robi,,junk,=x,y=")).toEqual({
      mic: "Gábor",
      system: "Robi",
    });
  });
});
