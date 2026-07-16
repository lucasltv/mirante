import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeFixture } from "../../test/fixtures.js";

describe("install / uninstall", () => {
  let fx: ReturnType<typeof makeFixture> | undefined;
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { fx?.cleanup(); fx = undefined; delete process.env.CLAUDE_CONFIG_DIR; vi.resetModules(); });

  async function writeSettings(home: string, obj: object) {
    const { writeFile, mkdir } = await import("node:fs/promises");
    const { join } = await import("node:path");
    await mkdir(home, { recursive: true });
    await writeFile(join(home, "settings.json"), JSON.stringify(obj, null, 2));
  }

  /** A temp hook source (with placeholders) plus a focus-helper source. */
  async function makeHookSource(): Promise<{ hook: string; focus: string }> {
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "mirante-hooksrc-"));
    const hook = join(dir, "mirante-hook.sh");
    writeFileSync(hook, "#!/usr/bin/env bash\nexit 0\n");
    const focus = join(dir, "focus-terminal.sh");
    writeFileSync(focus, "#!/usr/bin/env bash\nexit 0\n");
    return { hook, focus };
  }

  it("backs up, merges hooks, and copies the hook script", async () => {
    fx = makeFixture();
    process.env.CLAUDE_CONFIG_DIR = fx.home;
    await writeSettings(fx.home, {
      hooks: { Notification: [{ hooks: [{ type: "command", command: "\"/x/notify-focus.sh\" Notification" }] }] },
    });
    const src = await makeHookSource();

    const { install } = await import("./installer.js?i=1");
    const result = await install(src.hook, { focusSource: src.focus });

    const { readFile, access, stat } = await import("node:fs/promises");
    const { join } = await import("node:path");
    // backup exists
    await expect(access(result.backupPath as string)).resolves.toBeUndefined();
    // settings now has mirante hooks + preserved notify-focus
    const settings = JSON.parse(await readFile(join(fx.home, "settings.json"), "utf8"));
    const notif = settings.hooks.Notification.flatMap((g: { hooks: { command: string }[] }) => g.hooks.map((h) => h.command));
    expect(notif).toContain("\"/x/notify-focus.sh\" Notification");
    expect(notif.some((c: string) => c.includes("mirante-hook.sh"))).toBe(true);
    // hook script copied and executable
    const st = await stat(join(fx.home, "hooks", "mirante-hook.sh"));
    expect(st.mode & 0o111).not.toBe(0); // has an execute bit
  });

  it("is idempotent: a second install does not double the hooks", async () => {
    fx = makeFixture();
    process.env.CLAUDE_CONFIG_DIR = fx.home;
    await writeSettings(fx.home, {});
    const src = await makeHookSource();
    const { install } = await import("./installer.js?i=2");
    await install(src.hook, { focusSource: src.focus });
    await install(src.hook, { focusSource: src.focus });
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const settings = JSON.parse(await readFile(join(fx.home, "settings.json"), "utf8"));
    const stopCmds = settings.hooks.Stop.flatMap((g: { hooks: { command: string }[] }) => g.hooks.map((h) => h.command));
    expect(stopCmds.filter((c: string) => c.includes("mirante-hook.sh")).length).toBe(1);
  });

  it("uninstall removes mirante hooks but leaves others", async () => {
    fx = makeFixture();
    process.env.CLAUDE_CONFIG_DIR = fx.home;
    await writeSettings(fx.home, {
      hooks: { SessionStart: [{ hooks: [{ type: "command", command: "\"/x/context-mode.mjs\"" }] }] },
    });
    const src = await makeHookSource();
    const { install, uninstall } = await import("./installer.js?i=3");
    await install(src.hook, { focusSource: src.focus });
    await uninstall();
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const settings = JSON.parse(await readFile(join(fx.home, "settings.json"), "utf8"));
    const ss = settings.hooks.SessionStart.flatMap((g: { hooks: { command: string }[] }) => g.hooks.map((h) => h.command));
    expect(ss).toContain("\"/x/context-mode.mjs\"");
    expect(ss.some((c: string) => c.includes("mirante-hook.sh"))).toBe(false);
  });

  it("refuses to clobber a corrupt settings.json (backs it up, leaves it intact)", async () => {
    fx = makeFixture();
    process.env.CLAUDE_CONFIG_DIR = fx.home;
    const corrupt = "{ this is : not json ";
    await writeSettings(fx.home, {}); // create the dir
    const { writeFile, readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    await writeFile(join(fx.home, "settings.json"), corrupt);
    const src = await makeHookSource();

    const { install } = await import("./installer.js?i=5");
    await expect(install(src.hook, { focusSource: src.focus })).rejects.toThrow(/not valid JSON/);
    // original file left byte-for-byte intact — no silent overwrite
    expect(await readFile(join(fx.home, "settings.json"), "utf8")).toBe(corrupt);
    // a backup of the corrupt file was written
    const { readdir } = await import("node:fs/promises");
    const baks = (await readdir(fx.home)).filter((f) => f.includes(".mirante-") && f.endsWith(".bak"));
    expect(baks.length).toBeGreaterThan(0);
  });

  it("uninstall is a no-op when no settings.json exists", async () => {
    fx = makeFixture();
    process.env.CLAUDE_CONFIG_DIR = fx.home;
    const { uninstall } = await import("./installer.js?i=6");
    const result = await uninstall();
    expect(result.backupPath).toBeNull();
  });

  it("install works when no settings.json exists yet", async () => {
    fx = makeFixture();
    process.env.CLAUDE_CONFIG_DIR = fx.home;
    const src = await makeHookSource();
    const { install } = await import("./installer.js?i=4");
    const result = await install(src.hook, { focusSource: src.focus });
    expect(result.backupPath).toBeNull(); // nothing to back up
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const settings = JSON.parse(await readFile(join(fx.home, "settings.json"), "utf8"));
    expect(settings.hooks.SessionStart.length).toBeGreaterThan(0);
  });

  it("templates node + runner paths into the copied hook and copies focus-terminal.sh", async () => {
    fx = makeFixture();
    process.env.CLAUDE_CONFIG_DIR = fx.home;
    await writeSettings(fx.home, {});
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "mirante-notifysrc-"));
    const hookSource = join(dir, "mirante-hook.sh");
    writeFileSync(
      hookSource,
      '#!/usr/bin/env bash\nMIRANTE_NODE="@@MIRANTE_NODE@@"\nMIRANTE_NOTIFY_RUNNER="@@MIRANTE_NOTIFY_RUNNER@@"\nexit 0\n',
    );
    const focusSource = join(dir, "focus-terminal.sh");
    writeFileSync(focusSource, "#!/usr/bin/env bash\nexit 0\n");
    const runner = join(dir, "run.js");
    writeFileSync(runner, "// runner\n");

    const { install } = await import("./installer.js?i=notify1");
    await install(hookSource, { notifyRunner: runner, focusSource, nodeBin: "/opt/homebrew/bin/node" });

    const { readFile, stat } = await import("node:fs/promises");
    const installedHook = await readFile(join(fx.home, "hooks", "mirante-hook.sh"), "utf8");
    expect(installedHook).toContain('MIRANTE_NODE="/opt/homebrew/bin/node"');
    expect(installedHook).toContain(`MIRANTE_NOTIFY_RUNNER="${runner}"`);
    expect(installedHook).not.toContain("@@");
    const focusStat = await stat(join(fx.home, "hooks", "focus-terminal.sh"));
    expect(focusStat.mode & 0o111).not.toBe(0);
  });
});
