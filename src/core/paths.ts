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

/** Where Claude Code keeps user hook scripts (matches the user's convention). */
export const CLAUDE_HOOKS_DIR = join(CLAUDE_HOME, "hooks");

/** Destination of Mirante's copied hook script. */
export const INSTALLED_HOOK_SCRIPT = join(CLAUDE_HOOKS_DIR, "mirante-hook.sh");

/** Mirante-owned state, kept under the Claude home so it travels with it. */
export const MIRANTE_HOME = join(CLAUDE_HOME, "mirante");
export const MIRANTE_CONFIG_FILE = join(MIRANTE_HOME, "config.json");
/** Hook-owned: one small file per session, `{ state, tool, cwd, model, ts }`. */
export const MIRANTE_LIVE_DIR = join(MIRANTE_HOME, "live");
/** Summarizer-owned: one file per session with the plain-language recap. */
export const MIRANTE_SUMMARY_DIR = join(MIRANTE_HOME, "summary");

/** Per-session native task directory: `<claude-home>/tasks/<sessionId>/`. */
export function claudeTasksDirFor(sessionId: string): string {
  return join(CLAUDE_TASKS_DIR, sessionId);
}
