import { readdir, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { claudeTasksDirFor, MIRANTE_LIVE_DIR, CLAUDE_PROJECTS_DIR } from "../core/paths.js";
import type { LiveRecord, TaskProgress, Usage, SessionSummary } from "../core/types.js";
import { estimateCost, priceFor, type RawUsageTotals } from "../core/pricing.js";

const execFileAsync = promisify(execFile);

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
    if (!task || typeof task !== "object") continue;
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

/**
 * The model of the most recent assistant turn in the transcript, or undefined.
 * The transcript is the reliable source for the active model (the hot-path hook
 * does not stamp it); the enricher uses this to populate `SessionView.model`.
 */
export async function readSessionModel(sessionId: string): Promise<string | undefined> {
  const path = await findTranscript(sessionId);
  if (!path) return undefined;
  const lines = await readJsonl(path);
  let model: string | undefined;
  for (const line of lines) {
    if (line.type !== "assistant") continue;
    const message = line.message as { model?: string } | undefined;
    if (message?.model) model = message.model;
  }
  return model;
}

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
