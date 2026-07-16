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
});
