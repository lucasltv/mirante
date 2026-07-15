/** Lifecycle state of a session, derived from hook events. */
export type SessionState =
  | "starting"
  | "working"
  | "awaiting-input"
  | "needs-permission"
  | "idle"
  | "ended"
  | "stale";

/**
 * Hook-owned record written to `live/<sessionId>.json`. Kept intentionally
 * small so the hot-path hooks (Pre/PostToolUse) stay trivial.
 */
export interface LiveRecord {
  sessionId: string;
  state: SessionState;
  /** Tool name when state is `working` via a tool call. */
  tool?: string;
  cwd: string;
  model?: string;
  /** ISO timestamp of the last hook event for this session. */
  ts: string;
}

/** Where a session's plain-language recap ultimately came from. */
export type SummarySource = "recap" | "haiku" | "task" | "none";

export interface SessionSummary {
  text: string;
  source: SummarySource;
  /** ISO timestamp of when the summary was produced. */
  ts: string;
}

/** Task-list progress derived from `~/.claude/tasks/<sessionId>/`. */
export interface TaskProgress {
  total: number;
  completed: number;
  inProgress: number;
  pending: number;
  /** 0..1, or null when the session has no task list. */
  ratio: number | null;
  /** Subject of the current in-progress task, if any. */
  currentActivity?: string;
}

/** Token/cost usage aggregated from the transcript. */
export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** Estimated cost in USD, or null when pricing is unknown for the model. */
  estimatedCostUsd: number | null;
}

/**
 * Fully merged, render-ready view of a session. Produced fresh by the enricher
 * at widget-refresh time — never persisted as a shared mutable file.
 */
export interface SessionView {
  sessionId: string;
  project: string;
  cwd: string;
  gitBranch?: string;
  model?: string;
  state: SessionState;
  tool?: string;
  lastEventTs: string;
  progress: TaskProgress;
  usage: Usage;
  summary: SessionSummary;
  /** True while the underlying `claude` process is alive (via pgrep). */
  alive: boolean;
}
