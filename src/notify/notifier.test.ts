import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG, type MiranteConfig } from "../core/config.js";
import type { NotifyDeps, NotifyInput } from "./notifier.js";
import { notify } from "./notifier.js";

function cfg(overrides: (c: MiranteConfig) => void = () => {}): MiranteConfig {
  const c = structuredClone(DEFAULT_CONFIG);
  overrides(c);
  return c;
}

const BASE_INPUT: NotifyInput = {
  event: "Stop",
  project: "mirante",
  message: "",
  focus: { mode: "vscode", target: "mirante" },
};

function fakeDeps(over: Partial<NotifyDeps> = {}): NotifyDeps & { calls: Array<[string, string[]]> } {
  const calls: Array<[string, string[]]> = [];
  return {
    calls,
    resolveTerminalNotifier: over.resolveTerminalNotifier ?? (async () => "/opt/homebrew/bin/terminal-notifier"),
    run: over.run ?? (async (command, args) => { calls.push([command, args]); }),
  };
}

describe("notify", () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { delete process.env.CLAUDE_CONFIG_DIR; });

  it("does nothing when the event's rule is disabled", async () => {
    const deps = fakeDeps();
    await notify(BASE_INPUT, cfg((c) => { c.notifications.Stop.enabled = false; }), deps);
    expect(deps.calls).toHaveLength(0);
  });

  it("delivers via terminal-notifier with title, message, sound, and a focus -execute", async () => {
    const deps = fakeDeps();
    await notify(BASE_INPUT, cfg(), deps); // Stop default: enabled, sound "Hero", empty message
    expect(deps.calls).toHaveLength(1);
    const [cmd, args] = deps.calls[0]!;
    expect(cmd).toBe("/opt/homebrew/bin/terminal-notifier");
    expect(args).toContain("-title");
    expect(args).toContain("-message");
    expect(args[args.indexOf("-message") + 1]).toBe("Finished the task"); // empty msg → per-event default
    expect(args[args.indexOf("-sound") + 1]).toBe("Hero");
    const exec = args[args.indexOf("-execute") + 1]!;
    expect(exec).toContain("focus-terminal.sh");
    expect(exec).toContain("vscode");
  });

  it("omits -execute when clickToFocus is disabled", async () => {
    const deps = fakeDeps();
    await notify(BASE_INPUT, cfg((c) => { c.features.clickToFocus = false; }), deps);
    const [, args] = deps.calls[0]!;
    expect(args).not.toContain("-execute");
  });

  it("falls back to osascript when terminal-notifier is absent", async () => {
    const deps = fakeDeps({ resolveTerminalNotifier: async () => null });
    await notify(BASE_INPUT, cfg(), deps);
    const [cmd, args] = deps.calls[0]!;
    expect(cmd).toBe("osascript");
    expect(args[0]).toBe("-e");
    expect(args[1]).toContain("display notification");
    expect(args[1]).toContain('sound name "Hero"');
  });

  it("falls back to osascript when terminal-notifier throws", async () => {
    let first = true;
    const deps = fakeDeps({
      run: async (command, cmdArgs) => {
        if (first) { first = false; if (command.includes("terminal-notifier")) throw new Error("boom"); }
        (deps.calls as Array<[string, string[]]>).push([command, cmdArgs]);
      },
    });
    await notify(BASE_INPUT, cfg(), deps);
    expect(deps.calls.at(-1)![0]).toBe("osascript");
  });

  it("substitutes {project} and {message} in custom templates", async () => {
    const deps = fakeDeps();
    const input: NotifyInput = { ...BASE_INPUT, event: "Notification", message: "needs permission" };
    await notify(
      input,
      cfg((c) => {
        c.notifications.Notification.titleTemplate = "[{project}]";
        c.notifications.Notification.messageTemplate = "» {message}";
      }),
      deps,
    );
    const [, args] = deps.calls[0]!;
    expect(args[args.indexOf("-title") + 1]).toBe("[mirante]");
    expect(args[args.indexOf("-message") + 1]).toBe("» needs permission");
  });

  it("never throws even if the fallback delivery fails", async () => {
    const deps = fakeDeps({ resolveTerminalNotifier: async () => null, run: async () => { throw new Error("nope"); } });
    await expect(notify(BASE_INPUT, cfg(), deps)).resolves.toBeUndefined();
  });

  it("survives a rejecting resolveTerminalNotifier by falling back to osascript", async () => {
    const deps = fakeDeps({ resolveTerminalNotifier: async () => { throw new Error("resolver boom"); } });
    await expect(notify(BASE_INPUT, cfg(), deps)).resolves.toBeUndefined();
    expect(deps.calls.at(-1)![0]).toBe("osascript");
  });
});
