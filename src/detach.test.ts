import { describe, expect, it } from "vitest";

import { childArgs, maybeDetach } from "./detach.js";

describe("--detach", () => {
  it("re-launches the same command without the flag", () => {
    expect(childArgs("capture", ["--max-minutes", "240", "--detach"])).toEqual(["capture", "--max-minutes", "240"]);
  });

  it("does nothing without the flag, or for a command that is not long-running", async () => {
    expect(await maybeDetach("capture", ["--max-minutes", "5"], "/tmp/none")).toBe(false);
    expect(await maybeDetach("status", ["--detach"], "/tmp/none")).toBe(false);
    expect(await maybeDetach(undefined, [], "/tmp/none")).toBe(false);
  });
});
