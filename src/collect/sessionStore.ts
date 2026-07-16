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
