import { afterEach, describe, expect, it } from "vitest";

const ORIGINAL = process.env.CLAUDE_CONFIG_DIR;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = ORIGINAL;
  // Fresh module state per test comes from the `?seam=N` import query, not a cache reset.
});

describe("paths", () => {
  it("honors CLAUDE_CONFIG_DIR for the Claude home", async () => {
    process.env.CLAUDE_CONFIG_DIR = "/tmp/mirante-test-home";
    const paths = await import("./paths.js?seam=1");
    expect(paths.CLAUDE_HOME).toBe("/tmp/mirante-test-home");
    expect(paths.CLAUDE_TASKS_DIR).toBe("/tmp/mirante-test-home/tasks");
    expect(paths.claudeTasksDirFor("abc")).toBe("/tmp/mirante-test-home/tasks/abc");
    expect(paths.MIRANTE_LIVE_DIR).toBe("/tmp/mirante-test-home/mirante/live");
  });
});
