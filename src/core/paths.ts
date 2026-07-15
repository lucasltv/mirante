import { homedir } from "node:os";
import { join } from "node:path";

/** Root of the Claude CLI user data directory. */
export const CLAUDE_HOME = join(homedir(), ".claude");

/** Native Claude Code data (read-only from Mirante's perspective). */
export const CLAUDE_TASKS_DIR = join(CLAUDE_HOME, "tasks");
export const CLAUDE_PROJECTS_DIR = join(CLAUDE_HOME, "projects");
export const CLAUDE_SETTINGS_FILE = join(CLAUDE_HOME, "settings.json");

/** Mirante-owned state, kept under the Claude home so it travels with it. */
export const MIRANTE_HOME = join(CLAUDE_HOME, "mirante");
export const MIRANTE_CONFIG_FILE = join(MIRANTE_HOME, "config.json");
/** Hook-owned: one small file per session, `{ state, tool, cwd, model, ts }`. */
export const MIRANTE_LIVE_DIR = join(MIRANTE_HOME, "live");
/** Summarizer-owned: one file per session with the plain-language recap. */
export const MIRANTE_SUMMARY_DIR = join(MIRANTE_HOME, "summary");

/** Per-session native task directory: `~/.claude/tasks/<sessionId>/`. */
export function claudeTasksDirFor(sessionId: string): string {
  return join(CLAUDE_TASKS_DIR, sessionId);
}
