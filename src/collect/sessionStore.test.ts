import { afterEach, describe, expect, it, vi } from "vitest";
import { makeFixture } from "../../test/fixtures.js";

describe("readTaskProgress", () => {
  let fx: ReturnType<typeof makeFixture> | undefined;
  afterEach(() => {
    fx?.cleanup();
    fx = undefined;
    delete process.env.CLAUDE_CONFIG_DIR;
    vi.resetModules();
  });

  it("counts statuses and computes ratio + current activity", async () => {
    fx = makeFixture();
    process.env.CLAUDE_CONFIG_DIR = fx.home;
    fx.addTasks("s1", [
      { id: "1", subject: "Explore", status: "completed" },
      { id: "2", subject: "Build widget", status: "in_progress", activeForm: "Building widget" },
      { id: "3", subject: "Ship", status: "pending" },
    ]);
    const { readTaskProgress } = await import("./sessionStore.js?t=1");
    const p = await readTaskProgress("s1");
    expect(p.total).toBe(3);
    expect(p.completed).toBe(1);
    expect(p.inProgress).toBe(1);
    expect(p.pending).toBe(1);
    expect(p.ratio).toBeCloseTo(1 / 3, 5);
    expect(p.currentActivity).toBe("Build widget");
  });

  it("returns a neutral empty progress when no task dir exists", async () => {
    fx = makeFixture();
    process.env.CLAUDE_CONFIG_DIR = fx.home;
    const { readTaskProgress } = await import("./sessionStore.js?t=2");
    const p = await readTaskProgress("missing");
    expect(p.total).toBe(0);
    expect(p.ratio).toBeNull();
  });

  it("skips malformed and non-object task files without throwing", async () => {
    fx = makeFixture();
    process.env.CLAUDE_CONFIG_DIR = fx.home;
    fx.addTasks("s1", [{ id: "1", subject: "Real", status: "completed" }]);
    const { writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const dir = join(fx.home, "tasks", "s1");
    writeFileSync(join(dir, "2.json"), "null"); // valid JSON, non-object → must be skipped, not thrown
    writeFileSync(join(dir, "3.json"), "{ not json"); // unparseable → skipped
    const { readTaskProgress } = await import("./sessionStore.js?t=3");
    const p = await readTaskProgress("s1");
    expect(p.total).toBe(1);
    expect(p.completed).toBe(1);
  });
});
