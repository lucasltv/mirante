import { describe, expect, it } from "vitest";
import { resolveSummary } from "./summary.js";
import { DEFAULT_CONFIG, type MiranteConfig } from "../core/config.js";
import type { TaskProgress, SessionSummary } from "../core/types.js";

const progress: TaskProgress = {
  total: 3, completed: 1, inProgress: 1, pending: 1, ratio: 1 / 3, currentActivity: "Build widget",
};

function cfg(over: Partial<MiranteConfig["summary"]>): MiranteConfig {
  return { ...DEFAULT_CONFIG, summary: { ...DEFAULT_CONFIG.summary, ...over } };
}

describe("resolveSummary", () => {
  it("prefers the native recap when present", async () => {
    const deps = {
      getRecap: async (): Promise<SessionSummary | null> => ({ text: "Native recap", source: "recap", ts: "t" }),
      getStored: async (): Promise<SessionSummary | null> => null,
    };
    const s = await resolveSummary("s1", progress, cfg({ source: "auto" }), deps);
    expect(s.source).toBe("recap");
    expect(s.text).toBe("Native recap");
  });

  it("falls back to the task activity when no recap and haiku disabled", async () => {
    const deps = {
      getRecap: async (): Promise<SessionSummary | null> => null,
      getStored: async (): Promise<SessionSummary | null> => null,
    };
    const s = await resolveSummary("s1", progress, cfg({ source: "auto" }), deps);
    expect(s.source).toBe("task");
    expect(s.text).toBe("Build widget");
  });

  it("uses a stored haiku summary when source is haiku and one exists", async () => {
    const deps = {
      getRecap: async (): Promise<SessionSummary | null> => null,
      getStored: async (): Promise<SessionSummary | null> => ({ text: "Haiku says", source: "haiku", ts: "t" }),
    };
    const s = await resolveSummary("s1", progress, cfg({ source: "haiku", haiku: { ...DEFAULT_CONFIG.summary.haiku, enabled: true } }), deps);
    expect(s.source).toBe("haiku");
  });

  it("source=native never returns a haiku summary even if stored", async () => {
    const deps = {
      getRecap: async (): Promise<SessionSummary | null> => null,
      getStored: async (): Promise<SessionSummary | null> => ({ text: "Haiku says", source: "haiku", ts: "t" }),
    };
    const s = await resolveSummary("s1", progress, cfg({ source: "native" }), deps);
    expect(s.source).toBe("task");
  });

  it("returns a none-source empty summary when nothing is available", async () => {
    const deps = {
      getRecap: async (): Promise<SessionSummary | null> => null,
      getStored: async (): Promise<SessionSummary | null> => null,
    };
    const bare: TaskProgress = { total: 0, completed: 0, inProgress: 0, pending: 0, ratio: null };
    const s = await resolveSummary("s1", bare, cfg({ source: "auto" }), deps);
    expect(s.source).toBe("none");
    expect(s.text).toBe("");
  });
});
