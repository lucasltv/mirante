import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeFixture } from "../../test/fixtures.js";
import type { NotifyDeps } from "./notifier.js";

describe("buildInput", () => {
  it("maps argv positionally and coerces unknown modes to 'other'", async () => {
    const { buildInput } = await import("./run.js");
    const input = buildInput(["Stop", "vscode", "mirante", "mirante", "done"]);
    expect(input).toEqual({
      event: "Stop",
      project: "mirante",
      message: "done",
      focus: { mode: "vscode", target: "mirante" },
    });
    const other = buildInput(["Notification", "iterm", "/dev/ttys003", "proj", "hi"]);
    expect(other?.focus.mode).toBe("other");
  });

  it("returns null for an unknown or missing event", async () => {
    const { buildInput } = await import("./run.js");
    expect(buildInput(["PreToolUse", "vscode", "x", "p", "m"])).toBeNull();
    expect(buildInput([])).toBeNull();
  });
});

describe("runNotify", () => {
  let fx: ReturnType<typeof makeFixture> | undefined;
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { fx?.cleanup(); fx = undefined; delete process.env.CLAUDE_CONFIG_DIR; vi.resetModules(); });

  function fakeDeps(): NotifyDeps & { calls: Array<[string, string[]]> } {
    const calls: Array<[string, string[]]> = [];
    return {
      calls,
      resolveTerminalNotifier: async () => "/opt/homebrew/bin/terminal-notifier",
      run: async (command, args) => { calls.push([command, args]); },
    };
  }

  it("loads config (defaults) and dispatches an enabled event", async () => {
    fx = makeFixture();
    process.env.CLAUDE_CONFIG_DIR = fx.home; // no config.json → loadConfig returns defaults
    const deps = fakeDeps();
    const { runNotify } = await import("./run.js");
    await runNotify(["Stop", "vscode", "mirante", "mirante", ""], deps);
    expect(deps.calls).toHaveLength(1);
    expect(deps.calls[0]![0]).toBe("/opt/homebrew/bin/terminal-notifier");
  });

  it("is a silent no-op for a malformed event", async () => {
    fx = makeFixture();
    process.env.CLAUDE_CONFIG_DIR = fx.home;
    const deps = fakeDeps();
    const { runNotify } = await import("./run.js");
    await runNotify(["bogus"], deps);
    expect(deps.calls).toHaveLength(0);
  });
});
