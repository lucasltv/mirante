import type { MiranteConfig } from "../core/config.js";
import type { SessionSummary, TaskProgress } from "../core/types.js";
import { readNativeRecap, readStoredSummary } from "./sessionStore.js";

/** Injectable readers so the chain is deterministic under test. */
export interface SummaryDeps {
  getRecap: (sessionId: string) => Promise<SessionSummary | null>;
  getStored: (sessionId: string) => Promise<SessionSummary | null>;
}

const DEFAULT_DEPS: SummaryDeps = {
  getRecap: readNativeRecap,
  getStored: readStoredSummary,
};

function fromTask(progress: TaskProgress): SessionSummary {
  if (progress.currentActivity) {
    return { text: progress.currentActivity, source: "task", ts: "" };
  }
  return { text: "", source: "none", ts: "" };
}

/**
 * Resolve a session's plain-language recap following the source chain:
 *   1. native `/recap` (away_summary)   — preferred, free
 *   2. stored Haiku summary (opt-in)     — for sessions without a recap yet
 *   3. task in_progress subject          — always-on offline fallback
 *
 * `config.summary.source`: "native" stops before Haiku; "haiku" prefers a
 * stored Haiku summary when enabled; "auto" walks the whole chain.
 */
export async function resolveSummary(
  sessionId: string,
  progress: TaskProgress,
  config: MiranteConfig,
  deps: SummaryDeps = DEFAULT_DEPS,
): Promise<SessionSummary> {
  const recap = await deps.getRecap(sessionId);
  if (recap) return recap;

  const mode = config.summary.source;
  const haikuAllowed = mode !== "native" && config.summary.haiku.enabled;
  if (haikuAllowed) {
    const stored = await deps.getStored(sessionId);
    if (stored) return stored;
  }

  return fromTask(progress);
}

/**
 * Event-triggered background job (opt-in): read the transcript tail, ask Haiku
 * for a jargon-free one-liner, and write it to `summary/<sessionId>.json`.
 * Implemented in Plan 5; declared here to keep the module's public surface stable.
 */
export async function runHaikuSummarizer(_sessionId: string, _config: MiranteConfig): Promise<void> {
  // Plan 5.
}
