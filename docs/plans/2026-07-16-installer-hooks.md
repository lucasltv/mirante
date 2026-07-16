# Mirante — Plan 2: Installer & Hook Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire Mirante's state-stamping hooks into Claude Code safely — an idempotent, backed-up `settings.json` merge plus `mirante install` / `uninstall` / `doctor` — so live session data starts flowing to the collector built in Plan 1.

**Architecture:** A pure, unit-tested merge core (`settingsMerge.ts`) transforms a parsed `settings.json` object (append/remove Mirante's hook groups without touching anything else). A thin side-effecting installer backs up the file, applies the merge, and copies the hook script into `~/.claude/hooks/`. `doctor` runs read-only checks and reports structured results. Everything honors the `CLAUDE_CONFIG_DIR` test seam so it runs against synthetic fixtures, never the real `~/.claude`.

**Tech Stack:** TypeScript (NodeNext ESM), Node ≥ 20, Vitest, the Plan 1 foundation (`core/paths`, fixtures).

---

## Scope note (decided during planning)

The Plan 1 roadmap lumped "SwiftBar install" and "notify-focus migration" into Plan 2. This plan **narrows** to the installer core and **defers** those two, for cleaner, independently-testable units and to avoid a functionality gap:

- **In scope:** idempotent `settings.json` hook merge (7 events → `mirante-hook.sh`), backup-before-write, copy the hook script to `~/.claude/hooks/`, `install` / `uninstall` / `doctor` commands.
- **Additive, non-destructive:** Mirante's hooks are **appended** alongside the user's existing hooks (context-mode on `SessionStart`, `notify-focus.sh` on `Notification`/`Stop`). `mirante-hook.sh` only stamps state and exits 0, so it coexists with `notify-focus.sh` — **notifications keep working**.
- **Deferred:** SwiftBar install → **Plan 4** (bundled with the widget it launches). notify-focus removal/migration → **Plan 3** (when Mirante's own notifier replaces it — only then is removing notify-focus safe).

Verified against the real machine: `~/.claude/settings.json` uses `hooks: { <Event>: [ { hooks: [ { type:"command", command:"…" } ] } ] }`. Existing hooks that MUST be preserved: `SessionStart` → `context-mode-cache-heal.mjs`; `Notification`/`Stop` → `notify-focus.sh`.

---

## File structure (this plan)

| File | Responsibility |
|------|----------------|
| `src/core/paths.ts` (modify) | Add `CLAUDE_HOOKS_DIR` and `INSTALLED_HOOK_SCRIPT` (destination of the copied hook). |
| `package.json` (modify) | Build step copies `src/collect/hooks/` into `dist/` so the hook ships via npx. |
| `src/install/settingsMerge.ts` (create) | Pure: `mergeMiranteHooks` / `removeMiranteHooks` / `hasMiranteHooks` over a parsed settings object. |
| `src/install/settingsMerge.test.ts` (create) | Unit tests incl. idempotency and non-clobbering. |
| `src/install/installer.ts` (create) | `install` / `uninstall`: read → backup → merge/unmerge → write; copy hook script. |
| `src/install/installer.test.ts` (create) | Integration over a synthetic `CLAUDE_CONFIG_DIR`. |
| `src/install/doctor.ts` (create) | `runDoctor`: structured read-only checks. |
| `src/install/doctor.test.ts` (create) | Unit tests for the check logic. |
| `src/cli/index.ts` (modify) | Wire `install` / `uninstall` / `doctor` to the real implementations. |

---

## Task 0: Paths, hook packaging, and build wiring

**Files:**
- Modify: `src/core/paths.ts`
- Modify: `package.json`

- [ ] **Step 1: Add hook paths to `src/core/paths.ts`**

Add, below the existing `MIRANTE_*` exports:

```ts
/** Where Claude Code keeps user hook scripts (matches the user's convention). */
export const CLAUDE_HOOKS_DIR = join(CLAUDE_HOME, "hooks");

/** Destination of Mirante's copied hook script. */
export const INSTALLED_HOOK_SCRIPT = join(CLAUDE_HOOKS_DIR, "mirante-hook.sh");
```

- [ ] **Step 2: Ship the hook script in the build output**

`tsc` does not copy `.sh` files, so the hook must be copied into `dist/` for npx distribution. Change the `build` script in `package.json`:

```json
    "build": "tsc -p tsconfig.json && cp -R src/collect/hooks dist/collect/hooks",
```

(`dist/` is already in `files`, so the hook ships. The copied script lands at `dist/collect/hooks/mirante-hook.sh`, resolvable relative to the compiled installer.)

- [ ] **Step 3: Verify build produces the hook**

Run:
```bash
cd /Users/lucas/Code/mirante
npm run build && test -f dist/collect/hooks/mirante-hook.sh && echo "hook shipped"
```
Expected: `hook shipped`. Then `npm run typecheck` → clean.

- [ ] **Step 4: Commit**

```bash
git add src/core/paths.ts package.json
git commit -m "feat(install): hook paths and ship hook script in the build"
```

---

## Task 1: Settings merge — append Mirante's hooks (non-clobbering)

**Files:**
- Create: `src/install/settingsMerge.ts`
- Create: `src/install/settingsMerge.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/install/settingsMerge.test.ts`:

```ts
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
      const cmds = groups.flatMap((g) => g.hooks.map((h) => h.command));
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/install/settingsMerge.test.ts`
Expected: FAIL — module `./settingsMerge.js` not found.

- [ ] **Step 3: Implement the merge**

Create `src/install/settingsMerge.ts`:

```ts
/**
 * Pure transforms over a parsed `settings.json` object. Mirante owns exactly the
 * hook groups whose command references `mirante-hook.sh` (the marker); every
 * other key and hook is preserved untouched. All functions return a fresh object
 * and never mutate their input.
 */

export interface HookCommand {
  type: string;
  command: string;
  [k: string]: unknown;
}
export interface HookGroup {
  hooks?: HookCommand[];
  [k: string]: unknown;
}
export type Settings = Record<string, unknown>;

/** The seven lifecycle events Mirante stamps state on. */
export const MIRANTE_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "Notification",
  "Stop",
  "SessionEnd",
] as const;

/** Substring that identifies a Mirante-owned hook command. */
export const HOOK_MARKER = "mirante-hook.sh";

function miranteCommand(hookScriptPath: string, event: string): string {
  return `"${hookScriptPath}" ${event}`;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** True when a hook group contains a Mirante command. */
function isMiranteGroup(group: HookGroup): boolean {
  return (
    Array.isArray(group.hooks) &&
    group.hooks.some((h) => typeof h?.command === "string" && h.command.includes(HOOK_MARKER))
  );
}

/** Are Mirante's hooks already present anywhere in this settings object? */
export function hasMiranteHooks(settings: Settings): boolean {
  const hooks = settings.hooks;
  if (!isPlainObject(hooks)) return false;
  return Object.values(hooks).some(
    (groups) => Array.isArray(groups) && (groups as HookGroup[]).some(isMiranteGroup),
  );
}

/** Append a Mirante hook group to every event (idempotent, non-clobbering). */
export function mergeMiranteHooks(settings: Settings, hookScriptPath: string): Settings {
  const next = structuredClone(settings);
  const hooks: Record<string, HookGroup[]> = isPlainObject(next.hooks)
    ? (next.hooks as Record<string, HookGroup[]>)
    : {};
  next.hooks = hooks;

  for (const event of MIRANTE_EVENTS) {
    const groups = Array.isArray(hooks[event]) ? hooks[event] : [];
    hooks[event] = groups;
    if (groups.some(isMiranteGroup)) continue; // already installed for this event
    groups.push({ hooks: [{ type: "command", command: miranteCommand(hookScriptPath, event) }] });
  }
  return next;
}

/** Remove every Mirante-owned hook group, leaving all other hooks intact. */
export function removeMiranteHooks(settings: Settings): Settings {
  const next = structuredClone(settings);
  if (!isPlainObject(next.hooks)) return next;
  const hooks = next.hooks as Record<string, HookGroup[]>;
  for (const event of Object.keys(hooks)) {
    if (!Array.isArray(hooks[event])) continue;
    const kept = hooks[event].filter((g) => !isMiranteGroup(g));
    if (kept.length === 0) delete hooks[event];
    else hooks[event] = kept;
  }
  return next;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/install/settingsMerge.test.ts`
Expected: PASS (all 4 cases).

- [ ] **Step 5: Commit**

```bash
git add src/install/settingsMerge.ts src/install/settingsMerge.test.ts
git commit -m "feat(install): idempotent, non-clobbering settings.json hook merge"
```

---

## Task 2: Settings merge — remove Mirante's hooks (clean uninstall)

**Files:**
- Modify: `src/install/settingsMerge.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/install/settingsMerge.test.ts`:

```ts
import { removeMiranteHooks } from "./settingsMerge.js";

describe("removeMiranteHooks", () => {
  it("removes only mirante groups and preserves the rest", () => {
    const merged = mergeMiranteHooks(
      {
        hooks: {
          SessionStart: [{ hooks: [{ type: "command", command: "\"/x/context-mode.mjs\"" }] }],
          Notification: [{ hooks: [{ type: "command", command: "\"/x/notify-focus.sh\" Notification" }] }],
        },
      },
      HOOK,
    );
    const out = removeMiranteHooks(merged) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    };
    // mirante gone everywhere
    expect(hasMiranteHooks(out)).toBe(false);
    // context-mode preserved
    expect(out.hooks.SessionStart.flatMap((g) => g.hooks.map((h) => h.command))).toContain(
      "\"/x/context-mode.mjs\"",
    );
    // notify-focus preserved
    expect(out.hooks.Notification.flatMap((g) => g.hooks.map((h) => h.command))).toContain(
      "\"/x/notify-focus.sh\" Notification",
    );
    // events that only had mirante (e.g. Stop, PreToolUse) are dropped entirely
    expect(out.hooks.Stop).toBeUndefined();
    expect(out.hooks.PreToolUse).toBeUndefined();
  });

  it("is a no-op when there are no mirante hooks", () => {
    const settings = { hooks: { Stop: [{ hooks: [{ type: "command", command: "\"/x/other.sh\"" }] }] } };
    expect(removeMiranteHooks(settings)).toEqual(settings);
  });

  it("round-trips: merge then remove restores the original hooks", () => {
    const original = {
      hooks: {
        SessionStart: [{ hooks: [{ type: "command", command: "\"/x/context-mode.mjs\"" }] }],
      },
    };
    const restored = removeMiranteHooks(mergeMiranteHooks(original, HOOK));
    expect(restored).toEqual(original);
  });
});
```

- [ ] **Step 2: Run test to verify it fails, then passes**

Run: `npx vitest run src/install/settingsMerge.test.ts`
Expected: `removeMiranteHooks` is already implemented in Task 1, so these PASS immediately. If the round-trip case fails, the bug is in `removeMiranteHooks` dropping/keeping the wrong groups — fix there. (Writing the tests separately locks in the uninstall contract.)

- [ ] **Step 3: Commit**

```bash
git add src/install/settingsMerge.test.ts
git commit -m "test(install): lock in clean uninstall + merge/remove round-trip"
```

---

## Task 3: Installer — backup, write, and copy the hook script

**Files:**
- Create: `src/install/installer.ts`
- Create: `src/install/installer.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/install/installer.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeFixture } from "../../test/fixtures.js";

describe("install / uninstall", () => {
  let fx: ReturnType<typeof makeFixture> | undefined;
  let hookSource: string;
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { fx?.cleanup(); fx = undefined; delete process.env.CLAUDE_CONFIG_DIR; vi.resetModules(); });

  async function writeSettings(home: string, obj: object) {
    const { writeFile, mkdir } = await import("node:fs/promises");
    const { join } = await import("node:path");
    await mkdir(home, { recursive: true });
    await writeFile(join(home, "settings.json"), JSON.stringify(obj, null, 2));
  }

  async function makeHookSource(): Promise<string> {
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "mirante-hooksrc-"));
    const p = join(dir, "mirante-hook.sh");
    writeFileSync(p, "#!/usr/bin/env bash\nexit 0\n");
    return p;
  }

  it("backs up, merges hooks, and copies the hook script", async () => {
    fx = makeFixture();
    process.env.CLAUDE_CONFIG_DIR = fx.home;
    await writeSettings(fx.home, {
      hooks: { Notification: [{ hooks: [{ type: "command", command: "\"/x/notify-focus.sh\" Notification" }] }] },
    });
    hookSource = await makeHookSource();

    const { install } = await import("./installer.js?i=1");
    const result = await install(hookSource);

    const { readFile, access } = await import("node:fs/promises");
    const { join } = await import("node:path");
    // backup exists
    await expect(access(result.backupPath)).resolves.toBeUndefined();
    // settings now has mirante hooks + preserved notify-focus
    const settings = JSON.parse(await readFile(join(fx.home, "settings.json"), "utf8"));
    const notif = settings.hooks.Notification.flatMap((g: { hooks: { command: string }[] }) => g.hooks.map((h) => h.command));
    expect(notif).toContain("\"/x/notify-focus.sh\" Notification");
    expect(notif.some((c: string) => c.includes("mirante-hook.sh"))).toBe(true);
    // hook script copied and executable
    const stat = await import("node:fs/promises").then((m) => m.stat(join(fx.home, "hooks", "mirante-hook.sh")));
    expect(stat.mode & 0o111).not.toBe(0); // has an execute bit
  });

  it("is idempotent: a second install does not double the hooks", async () => {
    fx = makeFixture();
    process.env.CLAUDE_CONFIG_DIR = fx.home;
    await writeSettings(fx.home, {});
    hookSource = await makeHookSource();
    const { install } = await import("./installer.js?i=2");
    await install(hookSource);
    await install(hookSource);
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
    hookSource = await makeHookSource();
    const { install, uninstall } = await import("./installer.js?i=3");
    await install(hookSource);
    await uninstall();
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const settings = JSON.parse(await readFile(join(fx.home, "settings.json"), "utf8"));
    const ss = settings.hooks.SessionStart.flatMap((g: { hooks: { command: string }[] }) => g.hooks.map((h) => h.command));
    expect(ss).toContain("\"/x/context-mode.mjs\"");
    expect(ss.some((c: string) => c.includes("mirante-hook.sh"))).toBe(false);
  });

  it("install works when no settings.json exists yet", async () => {
    fx = makeFixture();
    process.env.CLAUDE_CONFIG_DIR = fx.home;
    hookSource = await makeHookSource();
    const { install } = await import("./installer.js?i=4");
    const result = await install(hookSource);
    expect(result.backupPath).toBeNull(); // nothing to back up
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const settings = JSON.parse(await readFile(join(fx.home, "settings.json"), "utf8"));
    expect(settings.hooks.SessionStart.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/install/installer.test.ts`
Expected: FAIL — module `./installer.js` not found.

- [ ] **Step 3: Implement the installer**

Create `src/install/installer.ts`:

```ts
import { fileURLToPath } from "node:url";
import { chmod, copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  CLAUDE_SETTINGS_FILE,
  CLAUDE_HOOKS_DIR,
  INSTALLED_HOOK_SCRIPT,
} from "../core/paths.js";
import { mergeMiranteHooks, removeMiranteHooks, type Settings } from "./settingsMerge.js";

export interface InstallResult {
  /** Path of the settings backup, or null when there was nothing to back up. */
  backupPath: string | null;
  hookInstalledAt: string;
}

/** Default source of the hook script, resolved relative to the built module. */
export function defaultHookSource(): string {
  // dist/install/installer.js -> dist/collect/hooks/mirante-hook.sh
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "collect", "hooks", "mirante-hook.sh");
}

async function readSettings(): Promise<{ settings: Settings; existed: boolean; raw: string | null }> {
  try {
    const raw = await readFile(CLAUDE_SETTINGS_FILE, "utf8");
    return { settings: JSON.parse(raw) as Settings, existed: true, raw };
  } catch {
    return { settings: {}, existed: false, raw: null };
  }
}

async function backup(raw: string | null): Promise<string | null> {
  if (raw === null) return null;
  // Deterministic-enough suffix without Date.now(): copy to `.mirante.bak`.
  const backupPath = `${CLAUDE_SETTINGS_FILE}.mirante.bak`;
  await writeFile(backupPath, raw);
  return backupPath;
}

async function writeSettingsAtomic(settings: Settings): Promise<void> {
  await mkdir(dirname(CLAUDE_SETTINGS_FILE), { recursive: true });
  const tmp = `${CLAUDE_SETTINGS_FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(settings, null, 2) + "\n");
  await rename(tmp, CLAUDE_SETTINGS_FILE);
}

/** Install Mirante's hooks: back up, merge, copy the hook script into place. */
export async function install(hookSource: string = defaultHookSource()): Promise<InstallResult> {
  const { settings, raw } = await readSettings();
  const backupPath = await backup(raw);

  await mkdir(CLAUDE_HOOKS_DIR, { recursive: true });
  await copyFile(hookSource, INSTALLED_HOOK_SCRIPT);
  await chmod(INSTALLED_HOOK_SCRIPT, 0o755);

  const merged = mergeMiranteHooks(settings, INSTALLED_HOOK_SCRIPT);
  await writeSettingsAtomic(merged);

  return { backupPath, hookInstalledAt: INSTALLED_HOOK_SCRIPT };
}

/** Remove only Mirante's hooks from settings.json (leaves the copied script). */
export async function uninstall(): Promise<{ backupPath: string | null }> {
  const { settings, raw, existed } = await readSettings();
  if (!existed) return { backupPath: null };
  const backupPath = await backup(raw);
  const cleaned = removeMiranteHooks(settings);
  await writeSettingsAtomic(cleaned);
  return { backupPath };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/install/installer.test.ts`
Expected: PASS (all cases). Then `npm run typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/install/installer.ts src/install/installer.test.ts
git commit -m "feat(install): install/uninstall with backup and hook-script copy"
```

---

## Task 4: Doctor — read-only diagnostics

**Files:**
- Create: `src/install/doctor.ts`
- Create: `src/install/doctor.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/install/doctor.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/install/doctor.test.ts`
Expected: FAIL — module `./doctor.js` not found.

- [ ] **Step 3: Implement doctor**

Create `src/install/doctor.ts`:

```ts
import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { CLAUDE_SETTINGS_FILE, INSTALLED_HOOK_SCRIPT, MIRANTE_LIVE_DIR } from "../core/paths.js";
import { hasMiranteHooks, type Settings } from "./settingsMerge.js";

const execFileAsync = promisify(execFile);

export interface DoctorCheck {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
}
export interface DoctorReport {
  ok: boolean;
  checks: DoctorCheck[];
}

async function commandExists(cmd: string): Promise<boolean> {
  try {
    // `command -v` is a bash builtin, so run it through bash. `cmd` is a fixed
    // literal here (no user input), so the interpolation is safe.
    await execFileAsync("bash", ["-c", `command -v ${cmd}`]);
    return true;
  } catch {
    return false;
  }
}

/** Run all read-only diagnostics and return a structured report. */
export async function runDoctor(): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];

  // 1. settings.json parseable + mirante hooks wired
  let settings: Settings | null = null;
  try {
    settings = JSON.parse(await readFile(CLAUDE_SETTINGS_FILE, "utf8")) as Settings;
    checks.push({ id: "settings-readable", label: "settings.json is readable", ok: true, detail: CLAUDE_SETTINGS_FILE });
  } catch {
    checks.push({ id: "settings-readable", label: "settings.json is readable", ok: false, detail: `cannot read/parse ${CLAUDE_SETTINGS_FILE}` });
  }
  const wired = settings ? hasMiranteHooks(settings) : false;
  checks.push({ id: "hooks-wired", label: "Mirante hooks are wired in settings.json", ok: wired, detail: wired ? "found" : "run `mirante install`" });

  // 2. hook script present
  let scriptOk = false;
  try {
    await access(INSTALLED_HOOK_SCRIPT);
    scriptOk = true;
  } catch {
    scriptOk = false;
  }
  checks.push({ id: "hook-script-present", label: "hook script installed", ok: scriptOk, detail: INSTALLED_HOOK_SCRIPT });

  // 3. jq present (hooks need it to parse stdin)
  const jqOk = await commandExists("jq");
  checks.push({ id: "jq-present", label: "jq is installed", ok: jqOk, detail: jqOk ? "found" : "brew install jq" });

  // 4. live dir writable (or creatable) — informational
  let liveOk = true;
  try {
    await access(MIRANTE_LIVE_DIR);
  } catch {
    liveOk = false; // absent is fine before first hook fires
  }
  checks.push({ id: "live-dir", label: "live/ directory exists", ok: liveOk, detail: liveOk ? MIRANTE_LIVE_DIR : "created on first hook event" });

  const ok = checks.filter((c) => c.id !== "live-dir").every((c) => c.ok);
  return { ok, checks };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/install/doctor.test.ts`
Expected: PASS. Then `npm run typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/install/doctor.ts src/install/doctor.test.ts
git commit -m "feat(install): doctor read-only diagnostics"
```

---

## Task 5: Wire the CLI commands

**Files:**
- Modify: `src/cli/index.ts`

- [ ] **Step 1: Replace the not-implemented stubs**

In `src/cli/index.ts`, add imports near the top (with the existing imports):

```ts
import { install, uninstall } from "../install/installer.js";
import { runDoctor } from "../install/doctor.js";
```

Replace the `case "install": case "uninstall": case "config": case "doctor":` block with individual cases (keep `config` as not-yet-implemented — it lands in Plan 6):

```ts
    case "install": {
      const result = await install();
      process.stdout.write(`mirante: hooks installed (${result.hookInstalledAt}).\n`);
      if (result.backupPath) process.stdout.write(`mirante: settings backed up to ${result.backupPath}.\n`);
      process.stdout.write("mirante: restart your Claude sessions for hooks to take effect.\n");
      return;
    }
    case "uninstall": {
      const result = await uninstall();
      process.stdout.write("mirante: hooks removed from settings.json.\n");
      if (result.backupPath) process.stdout.write(`mirante: settings backed up to ${result.backupPath}.\n`);
      return;
    }
    case "doctor": {
      const report = await runDoctor();
      for (const c of report.checks) {
        process.stdout.write(`${c.ok ? "✓" : "✗"} ${c.label} — ${c.detail}\n`);
      }
      process.exitCode = report.ok ? 0 : 1;
      return;
    }
    case "config":
      process.stdout.write("mirante config: not implemented yet\n");
      process.exitCode = 1;
      return;
```

- [ ] **Step 2: Build and smoke-test against the real home (SAFE: backs up first)**

Run:
```bash
cd /Users/lucas/Code/mirante
npm run build
node dist/cli/index.js doctor
```
Expected: a checklist. `hooks-wired` and `hook-script-present` will be ✗ until you install; `jq-present` ✓ (jq is at /usr/bin/jq).

- [ ] **Step 3: Commit**

```bash
git add src/cli/index.ts
git commit -m "feat(cli): wire install, uninstall, and doctor commands"
```

---

## Task 6: Manual end-to-end verification (real install, then clean up)

This task has no code — it verifies the installer against the real `~/.claude` and then restores it, so the reviewer sees hooks actually fire.

- [ ] **Step 1: Snapshot the real settings**

```bash
cp ~/.claude/settings.json /tmp/mirante-settings-before.json
```

- [ ] **Step 2: Install and inspect**

```bash
cd /Users/lucas/Code/mirante
node dist/cli/index.js install
node dist/cli/index.js doctor
jq '.hooks | keys' ~/.claude/settings.json
```
Expected: doctor all ✓; `.hooks` now includes all seven events; `context-mode` (SessionStart) and `notify-focus` (Notification/Stop) still present alongside Mirante.

- [ ] **Step 2.5: Confirm a hook fires**

Start a throwaway Claude session (or trigger any tool call), then:
```bash
ls ~/.claude/mirante/live/
node dist/cli/index.js status
```
Expected: a `live/<id>.json` appears; `status` prints a real `SessionView`.

- [ ] **Step 3: Uninstall and verify restoration**

```bash
node dist/cli/index.js uninstall
node dist/cli/index.js doctor            # hooks-wired now ✗
diff <(jq -S . /tmp/mirante-settings-before.json) <(jq -S . ~/.claude/settings.json) && echo "settings restored identically"
```
Expected: `settings restored identically` (uninstall is a clean inverse of install). If diff shows any non-Mirante change, that is a bug — fix `removeMiranteHooks`.

- [ ] **Step 4: Full gate**

```bash
npm run build && npm run lint && npm run typecheck && npx vitest run
```
Expected: all green.

- [ ] **Step 5: (no commit — verification only)**

---

## Self-review notes (author)

- **Spec coverage (Plan 2 slice):** idempotent `settings.json` merge with backup (Tasks 1, 3), append-not-clobber preserving context-mode/notify-focus (Tasks 1, 3, 6), `uninstall` clean inverse (Tasks 2, 3, 6), `doctor` (Task 4), CLI wiring (Task 5). SwiftBar install and notify-focus migration are explicitly deferred (see scope note).
- **Graceful/safe:** install backs up before writing and writes atomically (tmp + rename); uninstall is a tested inverse (`removeMiranteHooks` round-trips); everything runs against the `CLAUDE_CONFIG_DIR` fixture seam so tests never touch the real `~/.claude`.
- **Idempotency:** proven by `hasMiranteHooks`/marker detection (Tasks 1, 3) — a second install is a no-op.
- **Packaging:** the hook script ships via the build copy into `dist/` and is resolved relative to the compiled installer (Task 0), so `npx mirante install` finds it.
- **Type consistency:** `mergeMiranteHooks`/`removeMiranteHooks`/`hasMiranteHooks` share the `Settings`/`HookGroup` types; `install(hookSource?)`/`uninstall()` and `runDoctor()` signatures match their CLI call sites (Task 5).
- **Known deferrals:** `mirante config` stays a stub (Plan 6); SwiftBar plugin drop + `brew install` (Plan 4); removing notify-focus once Mirante's notifier exists (Plan 3).
