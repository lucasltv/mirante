# Mirante — Plan 1: Foundation & Collector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure-Node foundation of Mirante — config I/O, the read-only collectors over Claude Code's native state (task list, transcript usage, native `/recap`, live hook records), the summary-source resolution chain, and the enricher that merges everything into render-ready `SessionView`s.

**Architecture:** Everything here is pure Node with a filesystem test seam (`CLAUDE_CONFIG_DIR`) so it runs against synthetic fixtures, never the real `~/.claude`. Readers degrade gracefully — a missing/renamed native shape yields an empty/neutral result, never a throw. The enricher runs fresh on demand (later called by the SwiftBar widget), so nothing here is persisted as shared mutable state.

**Tech Stack:** TypeScript (NodeNext ESM), Node ≥ 20 (dev on 24), Vitest for tests, Zod for config validation.

**Scope note:** This is the first of several plans. Later plans (not detailed here) cover: Plan 2 — installer & hook wiring (`settings.json` merge, notify-focus migration, SwiftBar install, `doctor`); Plan 3 — notifications & terminal focus; Plan 4 — SwiftBar widget rendering; Plan 5 — Haiku summarizer (real implementation behind the interface stubbed here); Plan 6 — React/Vite config UI. Each produces working, testable software on its own. This plan must land first because every other plan imports its types and readers.

---

## File structure (this plan)

| File | Responsibility |
|------|----------------|
| `src/core/paths.ts` (modify) | Resolve Claude/Mirante paths, honoring `CLAUDE_CONFIG_DIR` (the test seam). |
| `src/core/types.ts` (exists) | Domain types — already concrete; one signature change for liveness. |
| `src/core/config.ts` (modify) | Zod schema + `loadConfig`/`saveConfig` on top of the existing shape/defaults. |
| `src/core/pricing.ts` (create) | Per-model pricing table + pure `estimateCost()` function. |
| `src/collect/sessionStore.ts` (modify) | Replace `declare` stubs with real readers over native state + `live/`. |
| `src/collect/summary.ts` (modify) | Real `resolveSummary` chain; `runHaikuSummarizer` stays an injected boundary. |
| `src/collect/enrich.ts` (modify) | Real `buildSessionViews` — merge, filter, stale reconciliation. |
| `src/cli/index.ts` (modify) | Add a hidden `status --json` debug command to eyeball real data. |
| `tsconfig.json` (modify) | Exclude `*.test.ts` from the build. |
| `vitest.config.ts` (create) | Vitest config. |
| `test/fixtures.ts` (create) | Helper to build a synthetic `CLAUDE_CONFIG_DIR` in a temp dir. |

---

## Task 0: Bootstrap toolchain and first commit

**Files:**
- Modify: `package.json` (add `zod`)
- Modify: `tsconfig.json` (exclude tests)
- Create: `vitest.config.ts`

- [ ] **Step 1: Add Zod dependency**

Edit `package.json` — add to a new `dependencies` block (keep existing `devDependencies`):

```json
  "dependencies": {
    "zod": "^3.23.0"
  },
```

- [ ] **Step 2: Install dependencies**

Run: `cd /Users/lucas/Code/mirante && npm install`
Expected: `node_modules/` created; `zod`, `typescript`, `vitest` present. No error exit.

- [ ] **Step 3: Exclude tests from the build**

Edit `tsconfig.json` — change the `exclude` array to:

```json
  "exclude": ["src/ui", "node_modules", "dist", "**/*.test.ts", "test"]
```

- [ ] **Step 4: Create Vitest config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 5: Verify build and test wiring**

Run: `npm run typecheck && npx vitest run`
Expected: typecheck passes (no emit); Vitest runs and reports "No test files found" (exit 0). If Vitest exits non-zero on no tests, that is fine to see now — the next task adds the first test.

- [ ] **Step 6: Commit the scaffold + toolchain**

```bash
cd /Users/lucas/Code/mirante
git add -A
git commit -m "chore: scaffold Mirante repo, spec, and toolchain"
```

---

## Task 1: Path resolution with a test seam

**Files:**
- Modify: `src/core/paths.ts`
- Create: `src/core/paths.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/core/paths.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";

const ORIGINAL = process.env.CLAUDE_CONFIG_DIR;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = ORIGINAL;
  vi_resetModules();
});
function vi_resetModules() {
  // paths.ts reads the env at import time; re-import fresh per test.
}

describe("paths", () => {
  it("honors CLAUDE_CONFIG_DIR for the Claude home", async () => {
    process.env.CLAUDE_CONFIG_DIR = "/tmp/mirante-test-home";
    const paths = await import("./paths.js?seam=1");
    expect(paths.CLAUDE_HOME).toBe("/tmp/mirante-test-home");
    expect(paths.CLAUDE_TASKS_DIR).toBe("/tmp/mirante-test-home/tasks");
    expect(paths.claudeTasksDirFor("abc")).toBe("/tmp/mirante-test-home/tasks/abc");
    expect(paths.MIRANTE_LIVE_DIR).toBe("/tmp/mirante-test-home/mirante/live");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/paths.test.ts`
Expected: FAIL — `CLAUDE_HOME` still points at `~/.claude` because paths.ts hardcodes `homedir()`.

- [ ] **Step 3: Make paths honor the env seam**

Replace the top of `src/core/paths.ts` (the `CLAUDE_HOME` constant) with a resolver. Full new file body:

```ts
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Root of the Claude CLI user data directory. Honors `CLAUDE_CONFIG_DIR`
 * (the same override Claude Code itself respects), which also gives tests a
 * clean seam to point at a synthetic fixture directory.
 */
export const CLAUDE_HOME = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");

/** Native Claude Code data (read-only from Mirante's perspective). */
export const CLAUDE_TASKS_DIR = join(CLAUDE_HOME, "tasks");
export const CLAUDE_PROJECTS_DIR = join(CLAUDE_HOME, "projects");
export const CLAUDE_SETTINGS_FILE = join(CLAUDE_HOME, "settings.json");

/** Mirante-owned state, kept under the Claude home so it travels with it. */
export const MIRANTE_HOME = join(CLAUDE_HOME, "mirante");
export const MIRANTE_CONFIG_FILE = join(MIRANTE_HOME, "config.json");
export const MIRANTE_LIVE_DIR = join(MIRANTE_HOME, "live");
export const MIRANTE_SUMMARY_DIR = join(MIRANTE_HOME, "summary");

/** Per-session native task directory: `<claude-home>/tasks/<sessionId>/`. */
export function claudeTasksDirFor(sessionId: string): string {
  return join(CLAUDE_TASKS_DIR, sessionId);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/paths.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/paths.ts src/core/paths.test.ts
git commit -m "feat(core): resolve paths via CLAUDE_CONFIG_DIR seam"
```

---

## Task 2: Fixture helper for synthetic Claude homes

**Files:**
- Create: `test/fixtures.ts`

This helper is used by later tasks. It builds a temp `CLAUDE_CONFIG_DIR` with tasks, a transcript, and live records.

- [ ] **Step 1: Write the fixture helper**

Create `test/fixtures.ts`:

```ts
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface FixtureTask {
  id: string;
  subject: string;
  status: "pending" | "in_progress" | "completed";
  activeForm?: string | null;
}

/** A synthetic Claude home. Call `cleanup()` when done. */
export interface Fixture {
  home: string;
  addTasks(sessionId: string, tasks: FixtureTask[]): void;
  /** Write raw JSONL lines as the transcript for a project/session. */
  addTranscript(project: string, sessionId: string, lines: object[]): void;
  addLiveRecord(sessionId: string, record: object): void;
  cleanup(): void;
}

export function makeFixture(): Fixture {
  const home = mkdtempSync(join(tmpdir(), "mirante-fix-"));
  return {
    home,
    addTasks(sessionId, tasks) {
      const dir = join(home, "tasks", sessionId);
      mkdirSync(dir, { recursive: true });
      for (const t of tasks) {
        writeFileSync(join(dir, `${t.id}.json`), JSON.stringify(t));
      }
    },
    addTranscript(project, sessionId, lines) {
      const dir = join(home, "projects", project);
      mkdirSync(dir, { recursive: true });
      const body = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
      writeFileSync(join(dir, `${sessionId}.jsonl`), body);
    },
    addLiveRecord(sessionId, record) {
      const dir = join(home, "mirante", "live");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${sessionId}.json`), JSON.stringify(record));
    },
    cleanup() {
      rmSync(home, { recursive: true, force: true });
    },
  };
}
```

- [ ] **Step 2: Sanity-typecheck the helper**

Run: `npx tsc --noEmit test/fixtures.ts --module NodeNext --moduleResolution NodeNext --target ES2022 --strict`
Expected: no type errors. (If NodeNext complains about the standalone invocation, this file is also covered by the Vitest transform in later tasks — proceed.)

- [ ] **Step 3: Commit**

```bash
git add test/fixtures.ts
git commit -m "test: add synthetic Claude-home fixture helper"
```

---

## Task 3: Config schema, load, and save

**Files:**
- Modify: `src/core/config.ts`
- Create: `src/core/config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/core/config.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { makeFixture } from "../../test/fixtures.js";

describe("config", () => {
  let fx: ReturnType<typeof makeFixture> | undefined;
  afterEach(() => {
    fx?.cleanup();
    fx = undefined;
    delete process.env.CLAUDE_CONFIG_DIR;
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/config.test.ts`
Expected: FAIL — `loadConfig`/`saveConfig` are not exported.

- [ ] **Step 3: Add the Zod schema and load/save**

Append to `src/core/config.ts` (keep the existing types and `DEFAULT_CONFIG`):

```ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { MIRANTE_CONFIG_FILE } from "./paths.js";

const notificationRuleSchema = z.object({
  enabled: z.boolean(),
  sound: z.string().optional(),
  titleTemplate: z.string().optional(),
  messageTemplate: z.string().optional(),
});

const configSchema = z.object({
  widget: z.object({
    host: z.enum(["swiftbar", "ubersicht"]),
    refreshSec: z.number().int().positive(),
  }),
  features: z.object({
    taskProgress: z.boolean(),
    tokens: z.boolean(),
    cost: z.boolean(),
    clickToFocus: z.boolean(),
  }),
  summary: z.object({
    source: z.enum(["auto", "native", "haiku"]),
    haiku: z.object({
      enabled: z.boolean(),
      apiKeyEnv: z.string(),
      model: z.string(),
    }),
  }),
  notifications: z.object({
    Notification: notificationRuleSchema,
    Stop: notificationRuleSchema,
    SessionEnd: notificationRuleSchema,
  }),
  filters: z.object({
    includeProjects: z.array(z.string()),
    excludeProjects: z.array(z.string()),
  }),
});

/** Deep-merge a partial config over defaults, one level deep per section. */
function mergeDefaults(partial: unknown): MiranteConfig {
  const p = (partial ?? {}) as Record<string, Record<string, unknown>>;
  const d = DEFAULT_CONFIG as unknown as Record<string, Record<string, unknown>>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(d)) {
    const base = d[key];
    if (base && typeof base === "object" && !Array.isArray(base)) {
      out[key] = { ...base, ...(p[key] ?? {}) };
    } else {
      out[key] = key in p ? p[key] : base;
    }
  }
  return out as unknown as MiranteConfig;
}

/** Load config from disk, filling missing fields from defaults. */
export async function loadConfig(): Promise<MiranteConfig> {
  let raw: string;
  try {
    raw = await readFile(MIRANTE_CONFIG_FILE, "utf8");
  } catch {
    return DEFAULT_CONFIG;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_CONFIG;
  }
  return configSchema.parse(mergeDefaults(parsed));
}

/** Validate and persist config to disk. */
export async function saveConfig(config: MiranteConfig): Promise<void> {
  const valid = configSchema.parse(config);
  await mkdir(dirname(MIRANTE_CONFIG_FILE), { recursive: true });
  await writeFile(MIRANTE_CONFIG_FILE, JSON.stringify(valid, null, 2) + "\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/config.test.ts`
Expected: PASS (all 3 cases).

- [ ] **Step 5: Commit**

```bash
git add src/core/config.ts src/core/config.test.ts
git commit -m "feat(core): config load/save with zod validation and defaults merge"
```

---

## Task 4: Pricing and cost estimation

**Files:**
- Create: `src/core/pricing.ts`
- Create: `src/core/pricing.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/core/pricing.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { estimateCost, type RawUsageTotals } from "./pricing.js";

const totals: RawUsageTotals = {
  inputTokens: 1_000_000,
  outputTokens: 1_000_000,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
};

describe("estimateCost", () => {
  it("computes cost from a known pricing row", () => {
    const price = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 };
    // 1M input * $3 + 1M output * $15 = $18
    expect(estimateCost(totals, price)).toBeCloseTo(18, 5);
  });

  it("returns null when the model has no pricing row", () => {
    expect(estimateCost(totals, undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/pricing.test.ts`
Expected: FAIL — module `./pricing.js` not found.

- [ ] **Step 3: Implement pricing**

Create `src/core/pricing.ts`:

```ts
export interface RawUsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

/** USD per 1M tokens. */
export interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/**
 * Per-model pricing (USD per 1M tokens). These are constants that need periodic
 * maintenance; unknown models yield a null cost rather than a wrong one. Verify
 * against current Anthropic pricing before release.
 */
export const PRICING: Record<string, ModelPrice> = {
  "claude-opus-4-8": { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  "claude-sonnet-5": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-haiku-4-5-20251001": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
};

/** Look up a model's price row, or undefined if unknown. */
export function priceFor(model: string | undefined): ModelPrice | undefined {
  if (!model) return undefined;
  return PRICING[model];
}

/** Estimate USD cost from raw token totals and a price row. Null if unknown. */
export function estimateCost(totals: RawUsageTotals, price: ModelPrice | undefined): number | null {
  if (!price) return null;
  const per = (tokens: number, usdPerMillion: number) => (tokens / 1_000_000) * usdPerMillion;
  return (
    per(totals.inputTokens, price.input) +
    per(totals.outputTokens, price.output) +
    per(totals.cacheReadTokens, price.cacheRead) +
    per(totals.cacheCreationTokens, price.cacheWrite)
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/pricing.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add src/core/pricing.ts src/core/pricing.test.ts
git commit -m "feat(core): per-model pricing table and cost estimator"
```

---

## Task 5: Read task progress from the native task list

**Files:**
- Modify: `src/collect/sessionStore.ts`
- Create: `src/collect/sessionStore.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/collect/sessionStore.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { makeFixture } from "../../test/fixtures.js";

describe("readTaskProgress", () => {
  let fx: ReturnType<typeof makeFixture> | undefined;
  afterEach(() => {
    fx?.cleanup();
    fx = undefined;
    delete process.env.CLAUDE_CONFIG_DIR;
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/collect/sessionStore.test.ts`
Expected: FAIL — `sessionStore.ts` currently exports `declare function` signatures with no runtime implementation.

- [ ] **Step 3: Replace the stub file with real readers (progress first)**

Replace the entire contents of `src/collect/sessionStore.ts` with the implementation below. (This task implements `readTaskProgress`; the remaining readers are added as no-throw stubs now and filled in Tasks 6–7 so the module compiles and imports cleanly.)

```ts
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { claudeTasksDirFor, MIRANTE_LIVE_DIR, CLAUDE_PROJECTS_DIR } from "../core/paths.js";
import type { LiveRecord, TaskProgress, Usage, SessionSummary } from "../core/types.js";

/**
 * Readers over Claude Code's native state plus Mirante's own `live/` records.
 * All readers degrade gracefully: internal formats (`tasks/`, the
 * `away_summary` subtype) are undocumented and may change between versions — a
 * missing/renamed shape means "skip this feature", never a throw.
 */

const EMPTY_PROGRESS: TaskProgress = {
  total: 0,
  completed: 0,
  inProgress: 0,
  pending: 0,
  ratio: null,
};

/** Compute task progress from `<claude-home>/tasks/<sessionId>/`. */
export async function readTaskProgress(sessionId: string): Promise<TaskProgress> {
  const dir = claudeTasksDirFor(sessionId);
  let entries: string[];
  try {
    entries = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  } catch {
    return { ...EMPTY_PROGRESS };
  }
  let completed = 0;
  let inProgress = 0;
  let pending = 0;
  let currentActivity: string | undefined;
  for (const file of entries) {
    let task: { status?: string; subject?: string; activeForm?: string | null };
    try {
      task = JSON.parse(await readFile(join(dir, file), "utf8"));
    } catch {
      continue;
    }
    switch (task.status) {
      case "completed":
        completed++;
        break;
      case "in_progress":
        inProgress++;
        currentActivity = task.subject ?? task.activeForm ?? currentActivity;
        break;
      case "pending":
        pending++;
        break;
      default:
        break;
    }
  }
  const total = completed + inProgress + pending;
  return {
    total,
    completed,
    inProgress,
    pending,
    ratio: total > 0 ? completed / total : null,
    ...(currentActivity ? { currentActivity } : {}),
  };
}

/** Aggregate token usage + estimated cost from the session transcript. */
export async function readUsage(_sessionId: string): Promise<Usage> {
  // Implemented in Task 6.
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    estimatedCostUsd: null,
  };
}

/** Latest native recap (`type:"system"`, `subtype:"away_summary"`), or null. */
export async function readNativeRecap(_sessionId: string): Promise<SessionSummary | null> {
  // Implemented in Task 6.
  return null;
}

/** Number of live `claude` processes (0 → all sessions are stale). */
export async function readAliveClaudeCount(): Promise<number> {
  // Implemented in Task 7.
  return 0;
}

/** Read all hook-owned `live/<id>.json` records. */
export async function readLiveRecords(): Promise<LiveRecord[]> {
  // Implemented in Task 7.
  return [];
}

// Referenced by later readers; keep imports used.
void MIRANTE_LIVE_DIR;
void CLAUDE_PROJECTS_DIR;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/collect/sessionStore.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Verify the module still typechecks**

Run: `npm run typecheck`
Expected: no errors. (Note: `src/collect/enrich.ts` and `src/collect/summary.ts` still hold `declare function` stubs from the scaffold — they typecheck fine until replaced in Tasks 8–9.)

- [ ] **Step 6: Commit**

```bash
git add src/collect/sessionStore.ts src/collect/sessionStore.test.ts
git commit -m "feat(collect): read task progress from native task list"
```

---

## Task 6: Read transcript usage and native recap

**Files:**
- Modify: `src/collect/sessionStore.ts`
- Modify: `src/collect/sessionStore.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/collect/sessionStore.test.ts` (add these `describe` blocks; keep the imports and existing tests):

```ts
import { estimateCost, priceFor } from "../core/pricing.js";

describe("readUsage", () => {
  let fx: ReturnType<typeof makeFixture> | undefined;
  afterEach(() => { fx?.cleanup(); fx = undefined; delete process.env.CLAUDE_CONFIG_DIR; });

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
    // 1M input * $3 + 1M output * $15 = $18 for sonnet-5
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
  afterEach(() => { fx?.cleanup(); fx = undefined; delete process.env.CLAUDE_CONFIG_DIR; });

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/collect/sessionStore.test.ts`
Expected: FAIL — `readUsage` returns zeros and `readNativeRecap` returns null (stubs from Task 5).

- [ ] **Step 3: Add a transcript-locator helper and implement both readers**

In `src/collect/sessionStore.ts`, add imports at the top (merge with existing):

```ts
import { estimateCost, priceFor, type RawUsageTotals } from "../core/pricing.js";
```

Add this private helper (place above `readUsage`):

```ts
/** Find the transcript path for a session by scanning project dirs. */
async function findTranscript(sessionId: string): Promise<string | null> {
  let projects: string[];
  try {
    projects = await readdir(CLAUDE_PROJECTS_DIR);
  } catch {
    return null;
  }
  for (const project of projects) {
    const candidate = join(CLAUDE_PROJECTS_DIR, project, `${sessionId}.jsonl`);
    try {
      await readFile(candidate, "utf8");
      return candidate;
    } catch {
      // not in this project dir
    }
  }
  return null;
}

/** Parse a JSONL file into objects, skipping malformed lines. */
async function readJsonl(path: string): Promise<Array<Record<string, unknown>>> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return [];
  }
  const out: Array<Record<string, unknown>> = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // skip malformed line
    }
  }
  return out;
}
```

Replace the placeholder `readUsage` body with:

```ts
/** Aggregate token usage + estimated cost from the session transcript. */
export async function readUsage(sessionId: string): Promise<Usage> {
  const path = await findTranscript(sessionId);
  const empty: Usage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    estimatedCostUsd: null,
  };
  if (!path) return empty;
  const lines = await readJsonl(path);
  const totals: RawUsageTotals = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
  let model: string | undefined;
  for (const line of lines) {
    if (line.type !== "assistant") continue;
    const message = line.message as { model?: string; usage?: Record<string, number> } | undefined;
    if (message?.model) model = message.model;
    const u = message?.usage;
    if (!u) continue;
    totals.inputTokens += u.input_tokens ?? 0;
    totals.outputTokens += u.output_tokens ?? 0;
    totals.cacheReadTokens += u.cache_read_input_tokens ?? 0;
    totals.cacheCreationTokens += u.cache_creation_input_tokens ?? 0;
  }
  return { ...totals, estimatedCostUsd: estimateCost(totals, priceFor(model)) };
}
```

Replace the placeholder `readNativeRecap` body with:

```ts
/** Latest native recap (`type:"system"`, `subtype:"away_summary"`), or null. */
export async function readNativeRecap(sessionId: string): Promise<SessionSummary | null> {
  const path = await findTranscript(sessionId);
  if (!path) return null;
  const lines = await readJsonl(path);
  let latest: SessionSummary | null = null;
  for (const line of lines) {
    if (line.type === "system" && line.subtype === "away_summary" && typeof line.content === "string") {
      latest = {
        text: line.content,
        source: "recap",
        ts: typeof line.timestamp === "string" ? line.timestamp : "",
      };
    }
  }
  return latest;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/collect/sessionStore.test.ts`
Expected: PASS (all cases across Tasks 5 and 6).

- [ ] **Step 5: Commit**

```bash
git add src/collect/sessionStore.ts src/collect/sessionStore.test.ts
git commit -m "feat(collect): read transcript usage/cost and native recap"
```

---

## Task 7: Read live records and alive-process count

**Files:**
- Modify: `src/collect/sessionStore.ts`
- Modify: `src/collect/sessionStore.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/collect/sessionStore.test.ts`:

```ts
describe("readLiveRecords", () => {
  let fx: ReturnType<typeof makeFixture> | undefined;
  afterEach(() => { fx?.cleanup(); fx = undefined; delete process.env.CLAUDE_CONFIG_DIR; });

  it("reads all live records, skipping malformed files", async () => {
    fx = makeFixture();
    process.env.CLAUDE_CONFIG_DIR = fx.home;
    fx.addLiveRecord("s1", { sessionId: "s1", state: "working", cwd: "/x", ts: "2026-07-15T10:00:00Z" });
    fx.addLiveRecord("s2", { sessionId: "s2", state: "awaiting-input", cwd: "/y", ts: "2026-07-15T10:01:00Z" });
    const { readLiveRecords } = await import("./sessionStore.js?l=1");
    const recs = await readLiveRecords();
    const ids = recs.map((r) => r.sessionId).sort();
    expect(ids).toEqual(["s1", "s2"]);
  });

  it("returns empty when the live dir is absent", async () => {
    fx = makeFixture();
    process.env.CLAUDE_CONFIG_DIR = fx.home;
    const { readLiveRecords } = await import("./sessionStore.js?l=2");
    expect(await readLiveRecords()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/collect/sessionStore.test.ts`
Expected: FAIL — `readLiveRecords` returns `[]` unconditionally (stub).

- [ ] **Step 3: Implement `readLiveRecords` and `readAliveClaudeCount`**

In `src/collect/sessionStore.ts`, add imports (merge with existing):

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
```

Replace the placeholder `readLiveRecords` body with:

```ts
/** Read all hook-owned `live/<id>.json` records. */
export async function readLiveRecords(): Promise<LiveRecord[]> {
  let files: string[];
  try {
    files = (await readdir(MIRANTE_LIVE_DIR)).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const out: LiveRecord[] = [];
  for (const file of files) {
    try {
      const rec = JSON.parse(await readFile(join(MIRANTE_LIVE_DIR, file), "utf8")) as LiveRecord;
      if (rec && typeof rec.sessionId === "string" && typeof rec.state === "string") {
        out.push(rec);
      }
    } catch {
      // skip malformed record
    }
  }
  return out;
}
```

Replace the placeholder `readAliveClaudeCount` body with:

```ts
/** Number of live `claude` processes (0 → all sessions are stale). */
export async function readAliveClaudeCount(): Promise<number> {
  try {
    const { stdout } = await execFileAsync("pgrep", ["-x", "claude"]);
    return stdout.split("\n").filter((l) => l.trim().length > 0).length;
  } catch {
    // pgrep exits non-zero when there are no matches
    return 0;
  }
}
```

Then remove the now-unused `void MIRANTE_LIVE_DIR;` / `void CLAUDE_PROJECTS_DIR;` lines at the bottom of the file (both symbols are now referenced).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/collect/sessionStore.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/collect/sessionStore.ts src/collect/sessionStore.test.ts
git commit -m "feat(collect): read live records and alive-process count"
```

---

## Task 8: Summary resolution chain

**Files:**
- Modify: `src/collect/summary.ts`
- Create: `src/collect/summary.test.ts`

The summarizer's Haiku call is an injected boundary here — a function param defaulting to "no summary". Plan 5 provides the real Haiku implementation; this task wires the chain and its fallbacks deterministically.

- [ ] **Step 1: Write the failing test**

Create `src/collect/summary.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/collect/summary.test.ts`
Expected: FAIL — `resolveSummary` is a `declare function` with no runtime body.

- [ ] **Step 3: Implement the chain**

Replace the entire contents of `src/collect/summary.ts` with:

```ts
import type { MiranteConfig } from "../core/config.js";
import type { SessionSummary, TaskProgress } from "../core/types.js";
import { readNativeRecap, readStoredSummary } from "./sessionStore.js";

/** Injectable readers so the chain is deterministic under test. */
export interface SummaryDeps {
  getRecap: (sessionId: string) => Promise<SessionSummary | null>;
  getStored: (sessionId: string) => Promise<SessionSummary | null>;
}

const DEFAULT_DEPS: SummaryDeps = {
  getRecap: readNativeRecap,
  getStored: readStoredSummary,
};

function fromTask(progress: TaskProgress): SessionSummary {
  if (progress.currentActivity) {
    return { text: progress.currentActivity, source: "task", ts: "" };
  }
  return { text: "", source: "none", ts: "" };
}

/**
 * Resolve a session's plain-language recap following the source chain:
 *   1. native `/recap` (away_summary)   — preferred, free
 *   2. stored Haiku summary (opt-in)     — for sessions without a recap yet
 *   3. task in_progress subject          — always-on offline fallback
 *
 * `config.summary.source`: "native" stops before Haiku; "haiku" prefers a
 * stored Haiku summary when enabled; "auto" walks the whole chain.
 */
export async function resolveSummary(
  sessionId: string,
  progress: TaskProgress,
  config: MiranteConfig,
  deps: SummaryDeps = DEFAULT_DEPS,
): Promise<SessionSummary> {
  const recap = await deps.getRecap(sessionId);
  if (recap) return recap;

  const mode = config.summary.source;
  const haikuAllowed = mode !== "native" && config.summary.haiku.enabled;
  if (haikuAllowed) {
    const stored = await deps.getStored(sessionId);
    if (stored) return stored;
  }

  return fromTask(progress);
}

/**
 * Event-triggered background job (opt-in): read the transcript tail, ask Haiku
 * for a jargon-free one-liner, and write it to `summary/<sessionId>.json`.
 * Implemented in Plan 5; declared here to keep the module's public surface stable.
 */
export async function runHaikuSummarizer(_sessionId: string, _config: MiranteConfig): Promise<void> {
  // Plan 5.
}
```

- [ ] **Step 4: Add the `readStoredSummary` reader used by the chain**

The chain imports `readStoredSummary` from `sessionStore.js`, which does not exist yet. Add it to `src/collect/sessionStore.ts` (import `MIRANTE_SUMMARY_DIR` from paths, then add the function):

Add to the paths import line:

```ts
import { claudeTasksDirFor, MIRANTE_LIVE_DIR, MIRANTE_SUMMARY_DIR, CLAUDE_PROJECTS_DIR } from "../core/paths.js";
```

Add the function:

```ts
/** Read the summarizer-owned recap for a session, if any. */
export async function readStoredSummary(sessionId: string): Promise<SessionSummary | null> {
  try {
    const raw = await readFile(join(MIRANTE_SUMMARY_DIR, `${sessionId}.json`), "utf8");
    const parsed = JSON.parse(raw) as SessionSummary;
    if (parsed && typeof parsed.text === "string") return parsed;
    return null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/collect/summary.test.ts`
Expected: PASS (all 5 cases).

- [ ] **Step 6: Commit**

```bash
git add src/collect/summary.ts src/collect/sessionStore.ts src/collect/summary.test.ts
git commit -m "feat(collect): summary resolution chain (recap -> haiku -> task)"
```

---

## Task 9: Enricher — build merged SessionViews

**Files:**
- Modify: `src/core/types.ts` (one signature change)
- Modify: `src/collect/enrich.ts`
- Create: `src/collect/enrich.test.ts`

- [ ] **Step 1: Adjust the liveness contract in types**

The scaffold's `SessionView.alive` is derived from process liveness. Per the collector design, per-session pid mapping is not available, so liveness is: `state !== "ended"/"stale"` AND (within TTL) AND (at least one `claude` process exists). No type change is required to `SessionView` — `alive: boolean` already fits. Confirm `src/core/types.ts` still exports `SessionView` with `alive: boolean` and `progress`, `usage`, `summary` fields (it does from the scaffold). No edit needed; this step is a verification checkpoint.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 2: Write the failing test**

Create `src/collect/enrich.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { makeFixture } from "../../test/fixtures.js";
import { DEFAULT_CONFIG, type MiranteConfig } from "../core/config.js";

function cfg(over: Partial<MiranteConfig>): MiranteConfig {
  return { ...DEFAULT_CONFIG, ...over };
}

describe("buildSessionViews", () => {
  let fx: ReturnType<typeof makeFixture> | undefined;
  afterEach(() => { fx?.cleanup(); fx = undefined; delete process.env.CLAUDE_CONFIG_DIR; });

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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/collect/enrich.test.ts`
Expected: FAIL — `buildSessionViews` is a `declare function` with no runtime body.

- [ ] **Step 4: Implement the enricher**

Replace the entire contents of `src/collect/enrich.ts` with:

```ts
import { basename } from "node:path";
import type { MiranteConfig } from "../core/config.js";
import type { SessionView } from "../core/types.js";
import {
  readLiveRecords,
  readTaskProgress,
  readUsage,
  readAliveClaudeCount,
} from "./sessionStore.js";
import { resolveSummary } from "./summary.js";

/** A session is considered stale if its last event is older than this. */
const STALE_TTL_MS = 15 * 60 * 1000;

function isExcluded(project: string, filters: MiranteConfig["filters"]): boolean {
  if (filters.excludeProjects.includes(project)) return true;
  if (filters.includeProjects.length > 0 && !filters.includeProjects.includes(project)) return true;
  return false;
}

/**
 * Merge hook-owned live records with task progress, usage, and the resolved
 * summary into render-ready `SessionView`s. Runs fresh on every call; nothing
 * is persisted. Applies project filters and reconciles dead sessions.
 */
export async function buildSessionViews(config: MiranteConfig): Promise<SessionView[]> {
  const [live, aliveCount] = await Promise.all([readLiveRecords(), readAliveClaudeCount()]);
  const now = Date.now();

  const views = await Promise.all(
    live.map(async (rec): Promise<SessionView | null> => {
      const project = basename(rec.cwd || "");
      if (isExcluded(project, config.filters)) return null;

      const [progress, usage] = await Promise.all([
        readTaskProgress(rec.sessionId),
        readUsage(rec.sessionId),
      ]);
      const summary = await resolveSummary(rec.sessionId, progress, config);

      const ageMs = now - Date.parse(rec.ts || "");
      const timedOut = Number.isNaN(ageMs) ? false : ageMs > STALE_TTL_MS;
      const stale = rec.state === "ended" || timedOut || aliveCount === 0;
      const state = stale ? "stale" : rec.state;

      return {
        sessionId: rec.sessionId,
        project,
        cwd: rec.cwd,
        ...(rec.model ? { model: rec.model } : {}),
        state,
        ...(rec.tool ? { tool: rec.tool } : {}),
        lastEventTs: rec.ts,
        progress,
        usage,
        summary,
        alive: !stale,
      };
    }),
  );

  return views.filter((v): v is SessionView => v !== null);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/collect/enrich.test.ts`
Expected: PASS (all 3 cases).

- [ ] **Step 6: Run the whole suite and typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: all tests PASS; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/core/types.ts src/collect/enrich.ts src/collect/enrich.test.ts
git commit -m "feat(collect): enricher merges live + progress + usage + summary"
```

---

## Task 10: Debug `status --json` command

Wire the foundation into a hidden CLI command so real data can be eyeballed before the widget exists.

**Files:**
- Modify: `src/cli/index.ts`

- [ ] **Step 1: Add the `status` command to the dispatcher**

In `src/cli/index.ts`, add the import at the top:

```ts
import { loadConfig } from "../core/config.js";
import { buildSessionViews } from "../collect/enrich.js";
```

Add a `status` branch to the `switch (cmd)` — before `default`:

```ts
    case "status": {
      const config = await loadConfig();
      const views = await buildSessionViews(config);
      process.stdout.write(JSON.stringify(views, null, 2) + "\n");
      return;
    }
```

- [ ] **Step 2: Build and run against the real Claude home**

Run:
```bash
cd /Users/lucas/Code/mirante
npm run build
node dist/cli/index.js status
```
Expected: a JSON array printed. It may be `[]` if no `live/` records exist yet (hooks are not installed until Plan 2) — that is correct. No crash, exit 0.

- [ ] **Step 3: Smoke-test with a synthetic live record**

Run:
```bash
mkdir -p "$HOME/.claude/mirante/live"
cat > "$HOME/.claude/mirante/live/smoke.json" <<'JSON'
{ "sessionId": "smoke", "state": "working", "cwd": "/Users/lucas/Code/mirante", "model": "claude-sonnet-5", "ts": "REPLACED_BELOW" }
JSON
# stamp a fresh timestamp so it isn't marked stale
node -e 'const f=process.env.HOME+"/.claude/mirante/live/smoke.json";const o=require("fs");const j=JSON.parse(o.readFileSync(f));j.ts=new Date().toISOString();o.writeFileSync(f,JSON.stringify(j))'
node dist/cli/index.js status
rm -f "$HOME/.claude/mirante/live/smoke.json"
```
Expected: a one-element array with `sessionId: "smoke"`, `project: "mirante"`, `state: "working"` (or `stale` if no `claude` process is running — acceptable), `progress`, `usage`, `summary` present.

- [ ] **Step 4: Commit**

```bash
git add src/cli/index.ts
git commit -m "feat(cli): hidden status --json command for debugging the collector"
```

---

## Self-review notes (author)

- **Spec coverage (this plan's slice):** task-progress % (Task 5), tokens/cost (Tasks 4+6), native `/recap` (Task 6), live records (Task 7), summary chain incl. `/recap`-first (Task 8), enricher with filters + stale reconciliation (Task 9), config with defaults/validation (Task 3). Notifications, installer/hook-merge, SwiftBar rendering, Haiku implementation, and the config UI are explicitly deferred to Plans 2–6.
- **Fragility handling:** every reader is wrapped so missing/renamed native shapes yield neutral results (tested in Tasks 5–7).
- **Type consistency:** `readAliveClaudeCount` (not the scaffold's `readAliveSessions`) is used consistently in Tasks 7 and 9; `resolveSummary(sessionId, progress, config, deps?)` signature matches between Task 8 definition and Task 9 call; `SessionView`/`TaskProgress`/`Usage`/`SessionSummary` fields match `src/core/types.ts`.
- **Known deferrals:** `runHaikuSummarizer` is a no-op boundary (Plan 5); `readStoredSummary` is real (Task 8) so the chain works the moment a Haiku summary file exists.
