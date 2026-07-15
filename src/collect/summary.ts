import type { MiranteConfig } from "../core/config.js";
import type { SessionSummary, TaskProgress } from "../core/types.js";

/**
 * Resolve a session's plain-language recap following the source chain:
 *
 *   1. native `/recap` (`away_summary` in the transcript) — preferred, free.
 *   2. Haiku summarizer (opt-in) — for sessions without a recap yet.
 *   3. task `in_progress` subject + `ai-title` — always-on offline fallback.
 *
 * `config.summary.source` selects how far down the chain to walk:
 *   "native" never calls Haiku; "haiku" prefers level 2 when enabled;
 *   "auto" walks the full chain.
 *
 * Implementation follows the plan.
 */
export declare function resolveSummary(
  sessionId: string,
  progress: TaskProgress,
  config: MiranteConfig,
): Promise<SessionSummary>;

/**
 * Event-triggered background job (opt-in): read the transcript tail, ask Haiku
 * for a jargon-free one-liner, and write it to `summary/<sessionId>.json`.
 * Never blocks the session; fails silently down the chain.
 */
export declare function runHaikuSummarizer(sessionId: string, config: MiranteConfig): Promise<void>;
