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

  let tn: string | null;
  try {
    tn = await deps.resolveTerminalNotifier();
  } catch {
    tn = null; // a failing resolver must not break the never-throws guarantee
  }
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
