import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeFixture } from "../../test/fixtures.js";

describe("runDoctor", () => {
  let fx: ReturnType<typeof makeFixture> | undefined;
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { fx?.cleanup(); fx = undefined; delete process.env.CLAUDE_CONFIG_DIR; vi.resetModules(); });

  it("reports hooks-not-wired when settings has no mirante hooks", async () => {
    fx = makeFixture();
    process.env.CLAUDE_CONFIG_DIR = fx.home;
    const { runDoctor } = await import("./doctor.js?d=1");
    const report = await runDoctor();
    const wiring = report.checks.find((c) => c.id === "hooks-wired");
    expect(wiring?.ok).toBe(false);
  });

  it("reports settings-not-readable when settings.json is corrupt", async () => {
    fx = makeFixture();
    process.env.CLAUDE_CONFIG_DIR = fx.home;
    const { writeFile, mkdir } = await import("node:fs/promises");
    const { join } = await import("node:path");
    await mkdir(fx.home, { recursive: true });
    await writeFile(join(fx.home, "settings.json"), "{ broken json");
    const { runDoctor } = await import("./doctor.js?d=3");
    const report = await runDoctor();
    expect(report.checks.find((c) => c.id === "settings-readable")?.ok).toBe(false);
    expect(report.ok).toBe(false);
  });

  it("reports hooks-wired and script-present after a merge + copy", async () => {
    fx = makeFixture();
    process.env.CLAUDE_CONFIG_DIR = fx.home;
    const { writeFile, mkdir } = await import("node:fs/promises");
    const { join } = await import("node:path");
    await mkdir(join(fx.home, "hooks"), { recursive: true });
    await writeFile(join(fx.home, "hooks", "mirante-hook.sh"), "#!/usr/bin/env bash\nexit 0\n");
    await writeFile(
      join(fx.home, "settings.json"),
      JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: `"${join(fx.home, "hooks", "mirante-hook.sh")}" Stop` }] }] } }),
    );
    const { runDoctor } = await import("./doctor.js?d=2");
    const report = await runDoctor();
    expect(report.checks.find((c) => c.id === "hooks-wired")?.ok).toBe(true);
    expect(report.checks.find((c) => c.id === "hook-script-present")?.ok).toBe(true);
  });

  it("reports focus-script-present after the helper is copied, and a terminal-notifier check", async () => {
    fx = makeFixture();
    process.env.CLAUDE_CONFIG_DIR = fx.home;
    const { writeFile, mkdir } = await import("node:fs/promises");
    const { join } = await import("node:path");
    await mkdir(join(fx.home, "hooks"), { recursive: true });
    await writeFile(join(fx.home, "hooks", "focus-terminal.sh"), "#!/usr/bin/env bash\nexit 0\n");
    const { runDoctor } = await import("./doctor.js?d=notify");
    const report = await runDoctor();
    expect(report.checks.find((c) => c.id === "focus-script-present")?.ok).toBe(true);
    // informational: present or not, the check exists and never flips overall ok on its own
    expect(report.checks.some((c) => c.id === "terminal-notifier")).toBe(true);
  });
});
