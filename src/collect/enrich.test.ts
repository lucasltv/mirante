import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeFixture } from "../../test/fixtures.js";
import { DEFAULT_CONFIG, type MiranteConfig } from "../core/config.js";

function cfg(over: Partial<MiranteConfig>): MiranteConfig {
  return { ...DEFAULT_CONFIG, ...over };
}

describe("buildSessionViews", () => {
  let fx: ReturnType<typeof makeFixture> | undefined;
  // Reset before each test too: the static `config.js` import above pulls in
  // `paths.js` at collection time (binding CLAUDE_HOME to the real ~/.claude
  // before any test sets CLAUDE_CONFIG_DIR). Resetting here forces `paths.js`
  // to re-evaluate against the fixture on the first test's dynamic import.
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { fx?.cleanup(); fx = undefined; delete process.env.CLAUDE_CONFIG_DIR; vi.resetModules(); });

  it("merges live + progress + usage + summary into a view", async () => {
    fx = makeFixture();
    process.env.CLAUDE_CONFIG_DIR = fx.home;
    fx.addLiveRecord("s1", { sessionId: "s1", state: "working", cwd: "/Users/x/Code/mirante", model: "claude-sonnet-5", ts: new Date().toISOString() });
    fx.addTasks("s1", [
      { id: "1", subject: "Explore", status: "completed" },
      { id: "2", subject: "Build widget", status: "in_progress" },
    ]);
    fx.addTranscript("proj", "s1", [
      { type: "assistant", message: { model: "claude-sonnet-5", usage: { input_tokens: 1000, output_tokens: 500 } } },
    ]);
    const { buildSessionViews } = await import("./enrich.js?e=1");
    const views = await buildSessionViews(cfg({}));
    expect(views).toHaveLength(1);
    const v = views[0]!;
    expect(v.sessionId).toBe("s1");
    expect(v.project).toBe("mirante"); // basename of cwd
    expect(v.progress.ratio).toBeCloseTo(0.5, 5);
    expect(v.summary.source).toBe("task");
    expect(v.summary.text).toBe("Build widget");
    expect(v.usage.inputTokens).toBe(1000);
    expect(v.model).toBe("claude-sonnet-5"); // from live record
  });

  it("populates model from the transcript when the live record has none", async () => {
    fx = makeFixture();
    process.env.CLAUDE_CONFIG_DIR = fx.home;
    fx.addLiveRecord("s1", { sessionId: "s1", state: "working", cwd: "/Users/x/Code/mirante", ts: new Date().toISOString() });
    fx.addTranscript("proj", "s1", [
      { type: "assistant", message: { model: "claude-opus-4-8", usage: { input_tokens: 10, output_tokens: 5 } } },
    ]);
    const { buildSessionViews } = await import("./enrich.js?e=model");
    const views = await buildSessionViews(cfg({}));
    expect(views[0]!.model).toBe("claude-opus-4-8"); // fell back to transcript
  });

  it("excludes projects listed in filters.excludeProjects", async () => {
    fx = makeFixture();
    process.env.CLAUDE_CONFIG_DIR = fx.home;
    fx.addLiveRecord("s1", { sessionId: "s1", state: "working", cwd: "/Users/x/Code/secret", ts: new Date().toISOString() });
    const { buildSessionViews } = await import("./enrich.js?e=2");
    const views = await buildSessionViews(cfg({ filters: { includeProjects: [], excludeProjects: ["secret"] } }));
    expect(views).toHaveLength(0);
  });

  it("marks a session stale when its last event is older than the TTL", async () => {
    fx = makeFixture();
    process.env.CLAUDE_CONFIG_DIR = fx.home;
    const old = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1h ago
    fx.addLiveRecord("s1", { sessionId: "s1", state: "working", cwd: "/Users/x/Code/mirante", ts: old });
    const { buildSessionViews } = await import("./enrich.js?e=3");
    const views = await buildSessionViews(cfg({}));
    expect(views[0]!.state).toBe("stale");
    expect(views[0]!.alive).toBe(false);
  });
});
