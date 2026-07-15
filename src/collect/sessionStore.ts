import type { LiveRecord, TaskProgress, Usage, SessionSummary } from "../core/types.js";

/**
 * Readers over Claude Code's native state plus Mirante's own `live/` records.
 * All readers MUST degrade gracefully: internal formats (`tasks/`, the
 * `away_summary` subtype) are undocumented and may change between versions —
 * a missing/renamed shape means "skip this feature", never a throw.
 *
 * Implementation follows the plan; signatures are the contract.
 */

/** Read all hook-owned `live/<id>.json` records. */
export declare function readLiveRecords(): Promise<LiveRecord[]>;

/** Compute task progress from `~/.claude/tasks/<sessionId>/`. */
export declare function readTaskProgress(sessionId: string): Promise<TaskProgress>;

/** Aggregate token usage + estimated cost from the session transcript. */
export declare function readUsage(sessionId: string): Promise<Usage>;

/**
 * Extract the latest native recap (`type:"system"`, `subtype:"away_summary"`)
 * from the transcript, if present. Returns null when no recap exists yet.
 */
export declare function readNativeRecap(sessionId: string): Promise<SessionSummary | null>;

/** Read the summarizer-owned recap for a session, if any. */
export declare function readStoredSummary(sessionId: string): Promise<SessionSummary | null>;

/** Set of session ids whose `claude` process is currently alive (via pgrep). */
export declare function readAliveSessions(): Promise<Set<string>>;
