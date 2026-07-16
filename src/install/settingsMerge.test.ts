import { describe, expect, it } from "vitest";
import { mergeMiranteHooks, hasMiranteHooks } from "./settingsMerge.js";

const HOOK = "/Users/x/.claude/hooks/mirante-hook.sh";
const EVENTS = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Notification", "Stop", "SessionEnd"];

describe("mergeMiranteHooks", () => {
  it("adds a mirante hook group for every event on an empty settings object", () => {
    const out = mergeMiranteHooks({}, HOOK);
    const hooks = out.hooks as Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    for (const event of EVENTS) {
      const groups = hooks[event];
      expect(Array.isArray(groups)).toBe(true);
      const cmds = groups!.flatMap((g) => g.hooks.map((h) => h.command));
      expect(cmds).toContain(`"${HOOK}" ${event}`);
    }
    expect(hasMiranteHooks(out)).toBe(true);
  });

  it("preserves existing non-mirante hooks and other settings keys", () => {
    const existing = {
      model: "opus",
      permissions: { allow: ["Read(/x)"] },
      hooks: {
        SessionStart: [{ hooks: [{ type: "command", command: "\"/x/context-mode.mjs\"" }] }],
        Notification: [{ hooks: [{ type: "command", command: "\"/x/notify-focus.sh\" Notification" }] }],
      },
    };
    const out = mergeMiranteHooks(existing, HOOK) as typeof existing;
    // untouched keys
    expect(out.model).toBe("opus");
    expect(out.permissions.allow).toEqual(["Read(/x)"]);
    // context-mode still present on SessionStart, plus mirante appended
    const ss = out.hooks.SessionStart.flatMap((g) => g.hooks.map((h) => h.command));
    expect(ss).toContain("\"/x/context-mode.mjs\"");
    expect(ss).toContain(`"${HOOK}" SessionStart`);
    // notify-focus still present on Notification, plus mirante appended
    const notif = out.hooks.Notification.flatMap((g) => g.hooks.map((h) => h.command));
    expect(notif).toContain("\"/x/notify-focus.sh\" Notification");
    expect(notif).toContain(`"${HOOK}" Notification`);
  });

  it("is idempotent: a second merge adds nothing", () => {
    const once = mergeMiranteHooks({}, HOOK);
    const twice = mergeMiranteHooks(once, HOOK);
    expect(twice).toEqual(once);
  });

  it("does not mutate the input", () => {
    const input = { hooks: { Stop: [{ hooks: [{ type: "command", command: "x" }] }] } };
    const snapshot = JSON.parse(JSON.stringify(input));
    mergeMiranteHooks(input, HOOK);
    expect(input).toEqual(snapshot);
  });
});
