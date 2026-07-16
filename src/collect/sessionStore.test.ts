import { afterEach, describe, expect, it, vi } from "vitest";
import { makeFixture } from "../../test/fixtures.js";
import { estimateCost, priceFor } from "../core/pricing.js";

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

describe("readUsage", () => {
  let fx: ReturnType<typeof makeFixture> | undefined;
  afterEach(() => { fx?.cleanup(); fx = undefined; delete process.env.CLAUDE_CONFIG_DIR; vi.resetModules(); });

  it("sums usage across assistant lines and prices by model", async () => {
    fx = makeFixture();
    process.env.CLAUDE_CONFIG_DIR = fx.home;
    fx.addTranscript("proj", "s1", [
      { type: "user", message: { role: "user" } },
      { type: "assistant", message: { model: "claude-sonnet-5", usage: { input_tokens: 500_000, output_tokens: 200_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
      { type: "assistant", message: { model: "claude-sonnet-5", usage: { input_tokens: 500_000, output_tokens: 800_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
    ]);
    const { readUsage } = await import("./sessionStore.js?u=1");
    const u = await readUsage("s1");
    expect(u.inputTokens).toBe(1_000_000);
    expect(u.outputTokens).toBe(1_000_000);
    expect(u.estimatedCostUsd).toBeCloseTo(
      estimateCost({ inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 0, cacheCreationTokens: 0 }, priceFor("claude-sonnet-5")) as number,
      5,
    );
  });

  it("returns zeros when the transcript is missing", async () => {
    fx = makeFixture();
    process.env.CLAUDE_CONFIG_DIR = fx.home;
    const { readUsage } = await import("./sessionStore.js?u=2");
    const u = await readUsage("nope");
    expect(u.inputTokens).toBe(0);
    expect(u.estimatedCostUsd).toBeNull();
  });
});

describe("readNativeRecap", () => {
  let fx: ReturnType<typeof makeFixture> | undefined;
  afterEach(() => { fx?.cleanup(); fx = undefined; delete process.env.CLAUDE_CONFIG_DIR; vi.resetModules(); });

  it("returns the latest away_summary content", async () => {
    fx = makeFixture();
    process.env.CLAUDE_CONFIG_DIR = fx.home;
    fx.addTranscript("proj", "s1", [
      { type: "system", subtype: "away_summary", content: "First recap", timestamp: "2026-07-15T10:00:00Z" },
      { type: "assistant", message: { model: "claude-sonnet-5", usage: {} } },
      { type: "system", subtype: "away_summary", content: "Latest recap", timestamp: "2026-07-15T11:00:00Z" },
    ]);
    const { readNativeRecap } = await import("./sessionStore.js?r=1");
    const recap = await readNativeRecap("s1");
    expect(recap?.text).toBe("Latest recap");
    expect(recap?.source).toBe("recap");
    expect(recap?.ts).toBe("2026-07-15T11:00:00Z");
  });

  it("returns null when there is no recap line", async () => {
    fx = makeFixture();
    process.env.CLAUDE_CONFIG_DIR = fx.home;
    fx.addTranscript("proj", "s2", [{ type: "user", message: {} }]);
    const { readNativeRecap } = await import("./sessionStore.js?r=2");
    expect(await readNativeRecap("s2")).toBeNull();
  });
});

describe("readSessionModel", () => {
  let fx: ReturnType<typeof makeFixture> | undefined;
  afterEach(() => { fx?.cleanup(); fx = undefined; delete process.env.CLAUDE_CONFIG_DIR; vi.resetModules(); });

  it("returns the model of the latest assistant line", async () => {
    fx = makeFixture();
    process.env.CLAUDE_CONFIG_DIR = fx.home;
    fx.addTranscript("proj", "s1", [
      { type: "assistant", message: { model: "claude-sonnet-5", usage: {} } },
      { type: "user", message: {} },
      { type: "assistant", message: { model: "claude-opus-4-8", usage: {} } },
    ]);
    const { readSessionModel } = await import("./sessionStore.js?m=1");
    expect(await readSessionModel("s1")).toBe("claude-opus-4-8");
  });

  it("returns undefined when there is no transcript", async () => {
    fx = makeFixture();
    process.env.CLAUDE_CONFIG_DIR = fx.home;
    const { readSessionModel } = await import("./sessionStore.js?m=2");
    expect(await readSessionModel("none")).toBeUndefined();
  });
});
