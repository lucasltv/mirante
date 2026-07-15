import type { MiranteConfig } from "../core/config.js";
import type { SessionView } from "../core/types.js";

/**
 * Merge hook-owned live records with task progress, usage, and the resolved
 * summary into render-ready `SessionView`s. Runs fresh on every widget refresh;
 * nothing here is persisted as shared mutable state.
 *
 * Applies `config.filters` (include/exclude projects) and reconciles dead
 * sessions (no SessionEnd but pid gone, or `last_event_ts` past its TTL → stale).
 *
 * Implementation follows the plan.
 */
export declare function buildSessionViews(config: MiranteConfig): Promise<SessionView[]>;
