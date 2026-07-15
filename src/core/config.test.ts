import { afterEach, describe, expect, it, vi } from "vitest";
import { makeFixture } from "../../test/fixtures.js";

describe("config", () => {
  let fx: ReturnType<typeof makeFixture> | undefined;
  afterEach(() => {
    fx?.cleanup();
    fx = undefined;
    delete process.env.CLAUDE_CONFIG_DIR;
    vi.resetModules();
  });

  it("returns defaults when no config file exists", async () => {
    fx = makeFixture();
    process.env.CLAUDE_CONFIG_DIR = fx.home;
    const { loadConfig, DEFAULT_CONFIG } = await import("./config.js?c=1");
    const cfg = await loadConfig();
    expect(cfg).toEqual(DEFAULT_CONFIG);
  });

  it("round-trips saved config", async () => {
    fx = makeFixture();
    process.env.CLAUDE_CONFIG_DIR = fx.home;
    const { loadConfig, saveConfig, DEFAULT_CONFIG } = await import("./config.js?c=2");
    const next = { ...DEFAULT_CONFIG, widget: { host: "swiftbar" as const, refreshSec: 9 } };
    await saveConfig(next);
    const cfg = await loadConfig();
    expect(cfg.widget.refreshSec).toBe(9);
  });

  it("fills missing fields from defaults on partial config", async () => {
    fx = makeFixture();
    process.env.CLAUDE_CONFIG_DIR = fx.home;
    const { writeFile, mkdir } = await import("node:fs/promises");
    const { join } = await import("node:path");
    await mkdir(join(fx.home, "mirante"), { recursive: true });
    await writeFile(join(fx.home, "mirante", "config.json"), JSON.stringify({ widget: { refreshSec: 2 } }));
    const { loadConfig } = await import("./config.js?c=3");
    const cfg = await loadConfig();
    expect(cfg.widget.refreshSec).toBe(2);
    expect(cfg.features.taskProgress).toBe(true); // from defaults
  });

  it("preserves nested defaults when a partial patches a deep sub-object", async () => {
    fx = makeFixture();
    process.env.CLAUDE_CONFIG_DIR = fx.home;
    const { writeFile, mkdir } = await import("node:fs/promises");
    const { join } = await import("node:path");
    await mkdir(join(fx.home, "mirante"), { recursive: true });
    await writeFile(
      join(fx.home, "mirante", "config.json"),
      JSON.stringify({ summary: { haiku: { enabled: true } }, notifications: { Stop: { sound: "Pop" } } }),
    );
    const { loadConfig } = await import("./config.js?c=4");
    const cfg = await loadConfig();
    expect(cfg.summary.haiku.enabled).toBe(true);
    expect(cfg.summary.haiku.apiKeyEnv).toBe("ANTHROPIC_API_KEY"); // kept from defaults
    expect(cfg.summary.haiku.model).toBe("claude-haiku-4-5-20251001"); // kept from defaults
    expect(cfg.notifications.Stop.sound).toBe("Pop");
    expect(cfg.notifications.Stop.enabled).toBe(true); // kept from defaults
    expect(cfg.summary.source).toBe("auto"); // untouched sibling kept
  });

  it("falls back to defaults when the config file is schema-invalid", async () => {
    fx = makeFixture();
    process.env.CLAUDE_CONFIG_DIR = fx.home;
    const { writeFile, mkdir } = await import("node:fs/promises");
    const { join } = await import("node:path");
    await mkdir(join(fx.home, "mirante"), { recursive: true });
    await writeFile(
      join(fx.home, "mirante", "config.json"),
      JSON.stringify({ widget: { host: "not-a-real-host", refreshSec: 4 } }),
    );
    const { loadConfig, DEFAULT_CONFIG } = await import("./config.js?c=5");
    expect(await loadConfig()).toEqual(DEFAULT_CONFIG);
  });
});
