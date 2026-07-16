# Mirante — Plan 3: Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Mirante into the notifier: on `Notification`/`Stop` (and, opt-in, `SessionEnd`) the hook fires a clickable macOS notification via a TypeScript `notify()` — `terminal-notifier` with an `osascript` fallback — whose click raises the originating VS Code window / Terminal tab through the already-shipped `focus-terminal.sh`.

**Architecture:** A pure, dependency-injected `notify()` core (`src/notify/notifier.ts`) builds the notification and picks the delivery mechanism; a thin CLI entry (`src/notify/run.ts`) maps hook args → `NotifyInput`, loads config, and calls `notify()`. The hot-path-safe `mirante-hook.sh` resolves the focus target in bash (from `$TERM_PROGRAM` + controlling tty — the only place that data exists) and shells out to `node run.js`. The installer templates the real `node` + runner paths into the copied hook and copies `focus-terminal.sh` alongside it. Everything is gated by `config.notifications[event].enabled` and honors the `CLAUDE_CONFIG_DIR` test seam.

**Tech Stack:** TypeScript (NodeNext ESM), Node ≥ 20, Vitest, POSIX shell, `terminal-notifier` (optional), the Plan 1/2 foundation (`core/paths`, `core/config`, installer, fixtures).

---

## Scope note (decided during planning)

- **No migration.** The installer does **not** touch the user's existing `notify-focus.sh` hooks. Mirante simply **adds** its own notification path. During the validation window the user will see **double notifications** (their `notify-focus.sh` + Mirante) — this is accepted; the user manually comments out the notification branch of `notify-focus.sh` once Mirante is proven. No sidecar, no settings surgery, no restore logic. This drops the "notify-focus migration" surface the Plan 1 roadmap parked here.
- **bash → node.** `Notification`/`Stop`/`SessionEnd` are **not** hot-path events (unlike Pre/PostToolUse), so shelling out to `node` there is safe. The hook still `exit 0`s unconditionally and the node call is guarded (`|| true`). Focus target (`{mode,target}`) is resolved **in bash** because `$TERM_PROGRAM` and the controlling tty belong to the hook process — a node subprocess could read the wrong values. `NotifyInput.focus` was designed to receive them pre-resolved.
- **Config is already in code.** `NotifiableHook`, `NotificationRule` (`enabled`, `sound?`, `titleTemplate?`, `messageTemplate?`), the Zod schema, and defaults (`Notification`→Glass, `Stop`→Hero enabled; `SessionEnd` disabled) already exist in `src/core/config.ts` from Plan 1. This plan consumes them; it does not change the schema.
- **Parity confirmed.** Mirante's `src/notify/focus-terminal.sh` already reproduces the user's `~/.claude/hooks/notify-focus.sh` focus behavior (vscode window raise, Apple Terminal tab select by tty, generic fallback). This plan ships and wires it; it does not rewrite it.

Verified against the real machine: `~/.claude/settings.json` currently has `Notification`/`Stop` → `notify-focus.sh` (left untouched by Plan 2's installer, which appended `mirante-hook.sh` alongside on all seven events) and `SessionStart` → `context-mode-cache-heal.mjs`.

---

## File structure (this plan)

| File | Responsibility |
|------|----------------|
| `src/core/paths.ts` (modify) | Add `INSTALLED_FOCUS_SCRIPT` (destination of the copied `focus-terminal.sh`). |
| `package.json` (modify) | Build step also copies `src/notify/focus-terminal.sh` into `dist/notify/`. |
| `src/notify/notifier.ts` (replace stub) | Real `notify(input, config, deps?)`: build title/body/sound, deliver via `terminal-notifier` → `osascript` fallback, `-execute` click runs `focus-terminal.sh`. Dependency-injected for tests. |
| `src/notify/notifier.test.ts` (create) | Unit tests over injected deps (no real notifications fire). |
| `src/notify/run.ts` (create) | Thin CLI entry: argv → `NotifyInput`, `loadConfig()`, call `notify()`. Direct-exec guarded so it's importable in tests. |
| `src/notify/run.test.ts` (create) | Unit tests for arg mapping + config-gated dispatch. |
| `src/collect/hooks/mirante-hook.sh` (modify) | Add `mirante_notify()` that resolves `{mode,target}` and shells to `node run.js` for `Notification`/`Stop`/`SessionEnd`. Placeholders `@@MIRANTE_NODE@@` / `@@MIRANTE_NOTIFY_RUNNER@@` filled at install. Still `exit 0` always. |
| `src/install/installer.ts` (modify) | Template the hook (node + runner paths) instead of a plain copy; also copy `focus-terminal.sh` to `~/.claude/hooks/`. |
| `src/install/installer.test.ts` (modify) | Assert templating happened + focus script copied & executable; keep existing cases green. |
| `src/install/doctor.ts` (modify) | Add informational `terminal-notifier` and `focus-script-present` checks. |
| `src/install/doctor.test.ts` (modify) | Cover the two new checks. |

---

## Task 0: Focus-script path + build wiring

**Files:**
- Modify: `src/core/paths.ts`
- Modify: `package.json`

- [ ] **Step 1: Add the installed focus-script path**

In `src/core/paths.ts`, directly below `INSTALLED_HOOK_SCRIPT`, add:

```ts
/** Destination of Mirante's copied click-to-focus helper. */
export const INSTALLED_FOCUS_SCRIPT = join(CLAUDE_HOOKS_DIR, "focus-terminal.sh");
```

- [ ] **Step 2: Ship `focus-terminal.sh` in the build output**

`tsc` compiles `src/notify/*.ts` into `dist/notify/` but does not copy `.sh` files. Extend the `build` script in `package.json` so the focus helper ships too:

```json
    "build": "tsc -p tsconfig.json && cp -R src/collect/hooks dist/collect/hooks && cp src/notify/focus-terminal.sh dist/notify/focus-terminal.sh",
```

- [ ] **Step 3: Verify build ships both scripts and the runner compiles**

Run:
```bash
cd /Users/lucas/Code/mirante
npm run build \
  && test -f dist/collect/hooks/mirante-hook.sh \
  && test -f dist/notify/focus-terminal.sh \
  && echo "scripts shipped"
```
Expected: `scripts shipped`. Then `npm run typecheck` → clean.

- [ ] **Step 4: Commit**

```bash
git add src/core/paths.ts package.json
git commit -m "feat(notify): installed focus-script path and ship focus-terminal.sh"
```

---

## Task 1: `notify()` core — build + deliver, dependency-injected

**Files:**
- Replace: `src/notify/notifier.ts` (currently a `declare` stub)
- Create: `src/notify/notifier.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/notify/notifier.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG, type MiranteConfig } from "../core/config.js";
import type { NotifyDeps, NotifyInput } from "./notifier.js";
import { notify } from "./notifier.js";

function cfg(overrides: (c: MiranteConfig) => void = () => {}): MiranteConfig {
  const c = structuredClone(DEFAULT_CONFIG);
  overrides(c);
  return c;
}

const BASE_INPUT: NotifyInput = {
  event: "Stop",
  project: "mirante",
  message: "",
  focus: { mode: "vscode", target: "mirante" },
};

function fakeDeps(over: Partial<NotifyDeps> = {}): NotifyDeps & { calls: Array<[string, string[]]> } {
  const calls: Array<[string, string[]]> = [];
  return {
    calls,
    resolveTerminalNotifier: over.resolveTerminalNotifier ?? (async () => "/opt/homebrew/bin/terminal-notifier"),
    run: over.run ?? (async (command, args) => { calls.push([command, args]); }),
  };
}

describe("notify", () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { delete process.env.CLAUDE_CONFIG_DIR; });

  it("does nothing when the event's rule is disabled", async () => {
    const deps = fakeDeps();
    await notify(BASE_INPUT, cfg((c) => { c.notifications.Stop.enabled = false; }), deps);
    expect(deps.calls).toHaveLength(0);
  });

  it("delivers via terminal-notifier with title, message, sound, and a focus -execute", async () => {
    const deps = fakeDeps();
    await notify(BASE_INPUT, cfg(), deps); // Stop default: enabled, sound "Hero", empty message
    expect(deps.calls).toHaveLength(1);
    const [cmd, args] = deps.calls[0]!;
    expect(cmd).toBe("/opt/homebrew/bin/terminal-notifier");
    expect(args).toContain("-title");
    expect(args).toContain("-message");
    expect(args[args.indexOf("-message") + 1]).toBe("Finished the task"); // empty msg → per-event default
    expect(args[args.indexOf("-sound") + 1]).toBe("Hero");
    const exec = args[args.indexOf("-execute") + 1]!;
    expect(exec).toContain("focus-terminal.sh");
    expect(exec).toContain("vscode");
  });

  it("omits -execute when clickToFocus is disabled", async () => {
    const deps = fakeDeps();
    await notify(BASE_INPUT, cfg((c) => { c.features.clickToFocus = false; }), deps);
    const [, args] = deps.calls[0]!;
    expect(args).not.toContain("-execute");
  });

  it("falls back to osascript when terminal-notifier is absent", async () => {
    const deps = fakeDeps({ resolveTerminalNotifier: async () => null });
    await notify(BASE_INPUT, cfg(), deps);
    const [cmd, args] = deps.calls[0]!;
    expect(cmd).toBe("osascript");
    expect(args[0]).toBe("-e");
    expect(args[1]).toContain("display notification");
    expect(args[1]).toContain('sound name "Hero"');
  });

  it("falls back to osascript when terminal-notifier throws", async () => {
    let first = true;
    const deps = fakeDeps({
      run: async (command, cmdArgs) => {
        if (first) { first = false; if (command.includes("terminal-notifier")) throw new Error("boom"); }
        (deps.calls as Array<[string, string[]]>).push([command, cmdArgs]);
      },
    });
    await notify(BASE_INPUT, cfg(), deps);
    expect(deps.calls.at(-1)![0]).toBe("osascript");
  });

  it("substitutes {project} and {message} in custom templates", async () => {
    const deps = fakeDeps();
    const input: NotifyInput = { ...BASE_INPUT, event: "Notification", message: "needs permission" };
    await notify(
      input,
      cfg((c) => {
        c.notifications.Notification.titleTemplate = "[{project}]";
        c.notifications.Notification.messageTemplate = "» {message}";
      }),
      deps,
    );
    const [, args] = deps.calls[0]!;
    expect(args[args.indexOf("-title") + 1]).toBe("[mirante]");
    expect(args[args.indexOf("-message") + 1]).toBe("» needs permission");
  });

  it("never throws even if the fallback delivery fails", async () => {
    const deps = fakeDeps({ resolveTerminalNotifier: async () => null, run: async () => { throw new Error("nope"); } });
    await expect(notify(BASE_INPUT, cfg(), deps)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notify/notifier.test.ts`
Expected: FAIL — `notify` is a `declare` stub / `NotifyDeps` not exported.

- [ ] **Step 3: Implement `notify()`**

Replace the entire contents of `src/notify/notifier.ts` with:

```ts
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { promisify } from "node:util";
import type { MiranteConfig, NotifiableHook } from "../core/config.js";
import { INSTALLED_FOCUS_SCRIPT } from "../core/paths.js";

const execFileAsync = promisify(execFile);

export interface NotifyInput {
  event: NotifiableHook;
  project: string;
  message: string;
  /** How to focus on click, resolved by the hook from $TERM_PROGRAM + tty. */
  focus: { mode: "vscode" | "terminal" | "other"; target: string };
}

/** Injectable side-effects so tests never fire a real notification. */
export interface NotifyDeps {
  /** Absolute path to `terminal-notifier`, or null when it isn't installed. */
  resolveTerminalNotifier(): Promise<string | null>;
  /** Run a command to completion; reject on non-zero exit. */
  run(command: string, args: string[]): Promise<void>;
}

const DEFAULT_TITLE = "Claude Code · {project}";
const DEFAULT_BODY: Record<NotifiableHook, string> = {
  Notification: "Needs your attention",
  Stop: "Finished the task",
  SessionEnd: "Session ended",
};
const TERMINAL_NOTIFIER_CANDIDATES = [
  "/opt/homebrew/bin/terminal-notifier",
  "/usr/local/bin/terminal-notifier",
];

function fill(tpl: string, vars: { project: string; message: string }): string {
  return tpl.replaceAll("{project}", vars.project).replaceAll("{message}", vars.message);
}

/** Single-quote a value for the `sh -c` string terminal-notifier runs on click. */
function shellQuote(s: string): string {
  return `'${s.replaceAll("'", "'\\''")}'`;
}

/** Escape a value for use inside an AppleScript double-quoted string literal. */
function osaString(s: string): string {
  return `"${s.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

async function defaultResolveTerminalNotifier(): Promise<string | null> {
  for (const p of TERMINAL_NOTIFIER_CANDIDATES) {
    try {
      await access(p, constants.X_OK);
      return p;
    } catch {
      // try the next candidate
    }
  }
  try {
    const { stdout } = await execFileAsync("bash", ["-c", "command -v terminal-notifier"]);
    const p = stdout.trim();
    return p.length > 0 ? p : null;
  } catch {
    return null;
  }
}

const DEFAULT_DEPS: NotifyDeps = {
  resolveTerminalNotifier: defaultResolveTerminalNotifier,
  async run(command, args) {
    await execFileAsync(command, args);
  },
};

/**
 * Fire a clickable macOS notification for one hook event, gated by
 * `config.notifications[event].enabled`. Prefers `terminal-notifier` (clickable,
 * runs `focus-terminal.sh`), falls back to a plain `osascript` notification.
 * NEVER throws — notifications must not break a Claude session.
 */
export async function notify(
  input: NotifyInput,
  config: MiranteConfig,
  deps: NotifyDeps = DEFAULT_DEPS,
): Promise<void> {
  const rule = config.notifications[input.event];
  if (!rule?.enabled) return;

  const vars = { project: input.project, message: input.message };
  const title = fill(rule.titleTemplate ?? DEFAULT_TITLE, vars);
  const rendered = rule.messageTemplate ? fill(rule.messageTemplate, vars) : input.message;
  const body = rendered.trim().length > 0 ? rendered : DEFAULT_BODY[input.event];
  const sound = rule.sound;

  const execute = config.features.clickToFocus
    ? `"${INSTALLED_FOCUS_SCRIPT}" ${input.focus.mode} ${shellQuote(input.focus.target)}`
    : undefined;

  const tn = await deps.resolveTerminalNotifier();
  if (tn) {
    const args = ["-title", title, "-message", body];
    if (sound) args.push("-sound", sound);
    if (execute) args.push("-execute", execute);
    try {
      await deps.run(tn, args);
      return;
    } catch {
      // fall through to the osascript fallback
    }
  }

  const parts = [`display notification ${osaString(body)} with title ${osaString(title)}`];
  if (sound) parts.push(`sound name ${osaString(sound)}`);
  try {
    await deps.run("osascript", ["-e", parts.join(" ")]);
  } catch {
    // last resort failed — swallow; never throw from a hook path
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/notify/notifier.test.ts`
Expected: PASS (all 7 cases). Then `npm run typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/notify/notifier.ts src/notify/notifier.test.ts
git commit -m "feat(notify): notify() core with terminal-notifier + osascript fallback"
```

---

## Task 2: `run.ts` — hook args → NotifyInput → dispatch

**Files:**
- Create: `src/notify/run.ts`
- Create: `src/notify/run.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/notify/run.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeFixture } from "../../test/fixtures.js";
import type { NotifyDeps } from "./notifier.js";

describe("buildInput", () => {
  it("maps argv positionally and coerces unknown modes to 'other'", async () => {
    const { buildInput } = await import("./run.js");
    const input = buildInput(["Stop", "vscode", "mirante", "mirante", "done"]);
    expect(input).toEqual({
      event: "Stop",
      project: "mirante",
      message: "done",
      focus: { mode: "vscode", target: "mirante" },
    });
    const other = buildInput(["Notification", "iterm", "/dev/ttys003", "proj", "hi"]);
    expect(other?.focus.mode).toBe("other");
  });

  it("returns null for an unknown or missing event", async () => {
    const { buildInput } = await import("./run.js");
    expect(buildInput(["PreToolUse", "vscode", "x", "p", "m"])).toBeNull();
    expect(buildInput([])).toBeNull();
  });
});

describe("runNotify", () => {
  let fx: ReturnType<typeof makeFixture> | undefined;
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { fx?.cleanup(); fx = undefined; delete process.env.CLAUDE_CONFIG_DIR; vi.resetModules(); });

  function fakeDeps(): NotifyDeps & { calls: Array<[string, string[]]> } {
    const calls: Array<[string, string[]]> = [];
    return {
      calls,
      resolveTerminalNotifier: async () => "/opt/homebrew/bin/terminal-notifier",
      run: async (command, args) => { calls.push([command, args]); },
    };
  }

  it("loads config (defaults) and dispatches an enabled event", async () => {
    fx = makeFixture();
    process.env.CLAUDE_CONFIG_DIR = fx.home; // no config.json → loadConfig returns defaults
    const deps = fakeDeps();
    const { runNotify } = await import("./run.js");
    await runNotify(["Stop", "vscode", "mirante", "mirante", ""], deps);
    expect(deps.calls).toHaveLength(1);
    expect(deps.calls[0]![0]).toBe("/opt/homebrew/bin/terminal-notifier");
  });

  it("is a silent no-op for a malformed event", async () => {
    fx = makeFixture();
    process.env.CLAUDE_CONFIG_DIR = fx.home;
    const deps = fakeDeps();
    const { runNotify } = await import("./run.js");
    await runNotify(["bogus"], deps);
    expect(deps.calls).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/notify/run.test.ts`
Expected: FAIL — module `./run.js` not found.

- [ ] **Step 3: Implement the runner**

Create `src/notify/run.ts`:

```ts
import { pathToFileURL } from "node:url";
import { loadConfig } from "../core/config.js";
import type { NotifiableHook } from "../core/config.js";
import { notify, type NotifyDeps, type NotifyInput } from "./notifier.js";

/** The events that carry a notification (subset of the seven Mirante hooks). */
const NOTIFIABLE: readonly NotifiableHook[] = ["Notification", "Stop", "SessionEnd"];

/**
 * Map the hook's positional args into a NotifyInput, or null when the event is
 * not notifiable. Invoked as: run.js <event> <mode> <target> <project> <message>
 */
export function buildInput(argv: string[]): NotifyInput | null {
  const [event, mode, target, project, message] = argv;
  if (!event || !NOTIFIABLE.includes(event as NotifiableHook)) return null;
  const resolvedMode = mode === "vscode" || mode === "terminal" ? mode : "other";
  return {
    event: event as NotifiableHook,
    project: project ?? "",
    message: message ?? "",
    focus: { mode: resolvedMode, target: target ?? "" },
  };
}

/** Build the input, load config, and dispatch. Never throws. */
export async function runNotify(argv: string[], deps?: NotifyDeps): Promise<void> {
  const input = buildInput(argv);
  if (!input) return;
  const config = loadConfig();
  await notify(input, config, deps);
}

// CLI entry: only when executed directly (so tests can import the functions).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runNotify(process.argv.slice(2)).catch(() => {});
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/notify/run.test.ts`
Expected: PASS (all 4 cases). Then `npm run typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/notify/run.ts src/notify/run.test.ts
git commit -m "feat(notify): run.ts hook entry mapping argv to notify dispatch"
```

---

## Task 3: Wire the hook — `mirante_notify()` for Notification/Stop/SessionEnd

**Files:**
- Modify: `src/collect/hooks/mirante-hook.sh`

- [ ] **Step 1: Add the templated paths and the notify function**

In `src/collect/hooks/mirante-hook.sh`, immediately after the `LIVE_DIR="$HOME/.claude/mirante/live"` line, add the two install-time placeholders:

```bash
# Filled in by `mirante install` (kept as placeholders in the shipped source).
MIRANTE_NODE="@@MIRANTE_NODE@@"
MIRANTE_NOTIFY_RUNNER="@@MIRANTE_NOTIFY_RUNNER@@"
```

Then, above the `main()` function definition, add:

```bash
# Fire a Mirante notification for a lifecycle event. Best-effort: never fails
# the hook. Resolves the click-focus target here (bash owns $TERM_PROGRAM + tty),
# then hands off to the TS runner. No-op until `mirante install` fills the paths.
mirante_notify() {
  local event="$1" cwd="$2" msg="$3"
  case "$MIRANTE_NODE" in *@@*) return 0 ;; esac      # not templated yet
  [ -x "$MIRANTE_NODE" ] || return 0
  [ -f "$MIRANTE_NOTIFY_RUNNER" ] || return 0

  local proj mode target term dev
  proj="$(basename "$cwd")"
  term="${TERM_PROGRAM:-}"
  case "$term" in
    vscode)
      mode="vscode"; target="$proj" ;;
    Apple_Terminal)
      dev="$(ps -o tty= -p "$$" 2>/dev/null | tr -d ' ')"
      if [ -n "$dev" ] && [ "$dev" != "??" ]; then
        mode="terminal"; target="/dev/$dev"
      else
        mode="other"; target=""
      fi ;;
    *)
      mode="other"; target="" ;;
  esac

  "$MIRANTE_NODE" "$MIRANTE_NOTIFY_RUNNER" "$event" "$mode" "$target" "$proj" "$msg" \
    >/dev/null 2>&1 || true
}
```

- [ ] **Step 2: Call it from `main()` after state is resolved**

In `main()`, the `case "$EVENT" in … esac` block that sets `state` is immediately followed by `now="$(date -u …)"`. Insert the notify dispatch **between** them (so it runs before the `state = "ended"` early-return that deletes the live file):

```bash
  # Notify on lifecycle events (gated per-event inside the runner via config).
  case "$EVENT" in
    Notification|Stop|SessionEnd) mirante_notify "$EVENT" "$cwd" "${msg:-}" ;;
  esac

  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
```

- [ ] **Step 3: Smoke-test the shell in its un-templated (no-op) state**

The placeholders are still present in source, so `mirante_notify` must return without invoking node. Verify the branch guards hold and the script stays syntactically valid:

```bash
cd /Users/lucas/Code/mirante
bash -n src/collect/hooks/mirante-hook.sh && echo "syntax ok"
echo '{"session_id":"smoke","cwd":"/tmp/x","message":"hi"}' \
  | bash src/collect/hooks/mirante-hook.sh Stop; echo "exit=$?"
```
Expected: `syntax ok`, then `exit=0` (no node call — placeholder guard `*@@*` returns early). If `shellcheck` is installed, `shellcheck src/collect/hooks/mirante-hook.sh` should stay clean.

- [ ] **Step 4: Commit**

```bash
git add src/collect/hooks/mirante-hook.sh
git commit -m "feat(collect): hook fires Mirante notifications on Notification/Stop/SessionEnd"
```

---

## Task 4: Installer — template the hook + copy `focus-terminal.sh`

**Files:**
- Modify: `src/install/installer.ts`
- Modify: `src/install/installer.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/install/installer.test.ts` (inside the existing `describe("install / uninstall", …)` block). This adds a helper that produces a hook source **with the placeholders** plus a focus source, and asserts both were handled:

```ts
  async function makeNotifyFixtures(): Promise<{ hookSource: string; focusSource: string; runner: string }> {
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
    return { hookSource, focusSource, runner };
  }

  it("templates node + runner paths into the copied hook and copies focus-terminal.sh", async () => {
    fx = makeFixture();
    process.env.CLAUDE_CONFIG_DIR = fx.home;
    await writeSettings(fx.home, {});
    const { hookSource, focusSource, runner } = await makeNotifyFixtures();

    const { install } = await import("./installer.js?i=notify1");
    await install(hookSource, { notifyRunner: runner, focusSource, nodeBin: "/opt/homebrew/bin/node" });

    const { readFile, stat } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const installedHook = await readFile(join(fx.home, "hooks", "mirante-hook.sh"), "utf8");
    expect(installedHook).toContain('MIRANTE_NODE="/opt/homebrew/bin/node"');
    expect(installedHook).toContain(`MIRANTE_NOTIFY_RUNNER="${runner}"`);
    expect(installedHook).not.toContain("@@");
    // focus helper copied and executable
    const focusStat = await stat(join(fx.home, "hooks", "focus-terminal.sh"));
    expect(focusStat.mode & 0o111).not.toBe(0);
  });
```

Then update the **existing** helper `makeHookSource()` so the older cases still pass focus fixtures. Replace the existing `it("backs up, merges hooks, and copies the hook script", …)` call site and the other `install(hookSource)` calls so each passes the focus source. The minimal edit: change `makeHookSource` to also create a focus source and return both, and update each `await install(hookSource)` / `await install(hookSource, …)` to `await install(hookSource, { focusSource })`. Concretely, replace `makeHookSource` with:

```ts
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
```

and in each existing case that does `hookSource = await makeHookSource();` followed by `install(hookSource…)`, switch to:

```ts
    const src = await makeHookSource();
    const { install } = await import("./installer.js?i=1"); // keep each case's unique query
    const result = await install(src.hook, { focusSource: src.focus });
```

(Apply the same `{ focusSource: src.focus }` to every `install(...)` call in the file, including the idempotency and uninstall cases.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/install/installer.test.ts`
Expected: FAIL — `install` does not accept an options object / does not copy the focus script.

- [ ] **Step 3: Implement the templating + focus copy**

In `src/install/installer.ts`, add `INSTALLED_FOCUS_SCRIPT` to the paths import and `readFile` is already imported. Add two default-source resolvers next to `defaultHookSource`:

```ts
/** Default source of the compiled notify runner (relative to the built module). */
export function defaultNotifyRunner(): string {
  // dist/install/installer.js -> dist/notify/run.js
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "notify", "run.js");
}

/** Default source of the click-to-focus helper (relative to the built module). */
export function defaultFocusSource(): string {
  // dist/install/installer.js -> dist/notify/focus-terminal.sh
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "notify", "focus-terminal.sh");
}
```

Update the paths import to include `INSTALLED_FOCUS_SCRIPT`:

```ts
import {
  CLAUDE_SETTINGS_FILE,
  CLAUDE_HOOKS_DIR,
  INSTALLED_HOOK_SCRIPT,
  INSTALLED_FOCUS_SCRIPT,
} from "../core/paths.js";
```

Replace the `install` function signature and body with:

```ts
export interface InstallOptions {
  notifyRunner?: string;
  focusSource?: string;
  nodeBin?: string;
}

/** Install Mirante's hooks: back up, template + copy the hook, copy focus helper, merge. */
export async function install(
  hookSource: string = defaultHookSource(),
  opts: InstallOptions = {},
): Promise<InstallResult> {
  const notifyRunner = opts.notifyRunner ?? defaultNotifyRunner();
  const focusSource = opts.focusSource ?? defaultFocusSource();
  const nodeBin = opts.nodeBin ?? process.execPath;

  const { settings, raw } = await readSettings();
  const backupPath = await backup(raw);
  if (settings === null) throw new Error(CORRUPT_MSG);

  await mkdir(CLAUDE_HOOKS_DIR, { recursive: true });

  // Copy the hook, substituting real node + runner paths for the placeholders.
  const hookSrc = await readFile(hookSource, "utf8");
  const hookOut = hookSrc
    .replaceAll("@@MIRANTE_NODE@@", nodeBin)
    .replaceAll("@@MIRANTE_NOTIFY_RUNNER@@", notifyRunner);
  await writeFile(INSTALLED_HOOK_SCRIPT, hookOut);
  await chmod(INSTALLED_HOOK_SCRIPT, 0o755);

  // Copy the click-to-focus helper alongside the hook.
  await copyFile(focusSource, INSTALLED_FOCUS_SCRIPT);
  await chmod(INSTALLED_FOCUS_SCRIPT, 0o755);

  const merged = mergeMiranteHooks(settings, INSTALLED_HOOK_SCRIPT);
  await writeSettingsAtomic(merged);

  return { backupPath, hookInstalledAt: INSTALLED_HOOK_SCRIPT };
}
```

(`writeFile`, `copyFile`, `chmod`, `readFile` are already imported at the top of the file from `node:fs/promises`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/install/installer.test.ts`
Expected: PASS (existing cases + the new templating case). Then `npm run typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/install/installer.ts src/install/installer.test.ts
git commit -m "feat(install): template node+runner into hook and copy focus-terminal.sh"
```

---

## Task 5: Doctor — surface notification readiness

**Files:**
- Modify: `src/install/doctor.ts`
- Modify: `src/install/doctor.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/install/doctor.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/install/doctor.test.ts`
Expected: FAIL — no `focus-script-present` / `terminal-notifier` checks yet.

- [ ] **Step 3: Add the checks**

In `src/install/doctor.ts`, import the focus path and add the two checks before the final `ok` computation. Update the paths import:

```ts
import {
  CLAUDE_SETTINGS_FILE,
  INSTALLED_HOOK_SCRIPT,
  INSTALLED_FOCUS_SCRIPT,
  MIRANTE_LIVE_DIR,
} from "../core/paths.js";
```

Then, immediately before the existing `const ok = …` line, insert:

```ts
  // 5. focus helper present (installed alongside the hook)
  let focusOk = false;
  try {
    await access(INSTALLED_FOCUS_SCRIPT);
    focusOk = true;
  } catch {
    focusOk = false;
  }
  checks.push({
    id: "focus-script-present",
    label: "click-to-focus helper installed",
    ok: focusOk,
    detail: focusOk ? INSTALLED_FOCUS_SCRIPT : "run `mirante install`",
  });

  // 6. terminal-notifier (informational — osascript fallback works without it)
  const tnOk = await commandExists("terminal-notifier");
  checks.push({
    id: "terminal-notifier",
    label: "terminal-notifier installed (clickable notifications)",
    ok: tnOk,
    detail: tnOk ? "found" : "optional: brew install terminal-notifier (falls back to osascript)",
  });
```

Finally, extend the overall-ok exclusion so the two informational checks (`live-dir`, `terminal-notifier`) don't fail the command:

```ts
  const informational = new Set(["live-dir", "terminal-notifier"]);
  const ok = checks.filter((c) => !informational.has(c.id)).every((c) => c.ok);
  return { ok, checks };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/install/doctor.test.ts`
Expected: PASS. Then `npm run typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/install/doctor.ts src/install/doctor.test.ts
git commit -m "feat(install): doctor reports focus helper + terminal-notifier"
```

---

## Task 6: Manual end-to-end verification (real install, real notification, cleanup)

No code — proves the notification actually fires and clicks focus the right window, then restores the machine.

- [ ] **Step 1: Snapshot the real settings**

```bash
cp ~/.claude/settings.json /tmp/mirante-settings-before.json
```

- [ ] **Step 2: Build and install**

```bash
cd /Users/lucas/Code/mirante
npm run build
node dist/cli/index.js install
node dist/cli/index.js doctor
```
Expected: doctor shows `focus-script-present` ✓, `hook-script-present` ✓, `hooks-wired` ✓; `terminal-notifier` ✓ if installed (else the osascript-fallback note).

- [ ] **Step 3: Confirm the hook was templated (not left with placeholders)**

```bash
grep -n 'MIRANTE_NODE\|MIRANTE_NOTIFY_RUNNER' ~/.claude/hooks/mirante-hook.sh
```
Expected: both lines show real absolute paths (the running `node` and `…/dist/notify/run.js`), **no** `@@…@@`.

- [ ] **Step 4: Fire a notification directly through the runner**

```bash
node dist/notify/run.js Stop vscode mirante mirante "e2e test"
```
Expected: a macOS notification titled `Claude Code · mirante` with body `e2e test`. If `terminal-notifier` is installed, clicking it raises the VS Code window whose title contains `mirante`. (This exercises the exact path the hook takes.)

- [ ] **Step 5: Confirm a real session triggers it**

Start a throwaway Claude session in this repo and let it go idle / stop. Expected: you receive **two** notifications — the user's existing `notify-focus.sh` and Mirante's — which is the accepted temporary state (the user comments out `notify-focus.sh`'s notification branch once satisfied).

- [ ] **Step 6: Uninstall and verify settings restored identically**

```bash
node dist/cli/index.js uninstall
diff <(jq -S . /tmp/mirante-settings-before.json) <(jq -S . ~/.claude/settings.json) \
  && echo "settings restored identically"
```
Expected: `settings restored identically` (uninstall removes only Mirante's hook groups; `notify-focus.sh` untouched throughout). The copied `mirante-hook.sh` / `focus-terminal.sh` are intentionally left in `~/.claude/hooks/`.

- [ ] **Step 7: Full gate**

```bash
npm run build && npm run lint && npm run typecheck && npx vitest run
```
Expected: all green.

- [ ] **Step 8: (no commit — verification only)**

---

## Self-review notes (author)

- **Spec coverage:** `notify()` core with terminal-notifier + osascript fallback and click-to-focus (Task 1); config-gated dispatch from hook args (Task 2); hook wiring for `Notification`/`Stop`/`SessionEnd`, focus resolved in bash (Task 3); installer templating of node + runner paths and shipping/copying `focus-terminal.sh` (Tasks 0, 4); doctor visibility (Task 5); real end-to-end proof (Task 6). Consumes the existing `NotificationRule` schema (Plan 1) unchanged.
- **Invariants held:** hook still `exit 0` always and the node call is guarded (`|| true`) and only on non-hot-path events; `notify()` never throws (both delivery paths wrapped); all path resolution flows through `paths.ts` / `CLAUDE_CONFIG_DIR`, so tests never touch the real `~/.claude`.
- **No migration by design:** `notify-focus.sh` is never read, moved, or removed by any task — double notifications during validation are accepted and the user retires their script manually. Uninstall round-trips settings byte-for-byte (Task 6, Step 6).
- **Self-containment:** the copied hook carries absolute `node` + runner paths (install-time templating), so it works under nvm / minimal PATH; `focus-terminal.sh` is resolved from `INSTALLED_FOCUS_SCRIPT` at notify time.
- **Type consistency:** `NotifyInput` / `NotifyDeps` are shared by `notifier.ts`, `run.ts`, and their tests; `install(hookSource?, opts?)` with `InstallOptions` matches every call site (existing tests updated in Task 4, Step 1); `buildInput`/`runNotify` signatures match the runner's CLI entry.
- **Known deferrals:** `SessionEnd` is wired but ships disabled by default (config knob only); richer per-project notification rules and the `mirante config` editor remain Plan 6.
