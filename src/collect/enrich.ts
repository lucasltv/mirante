import { basename } from "node:path";
import type { MiranteConfig } from "../core/config.js";
import type { SessionView } from "../core/types.js";
import {
  readLiveRecords,
  readTaskProgress,
  readTranscriptDigest,
  readStoredSummary,
  readAliveClaudeCount,
} from "./sessionStore.js";
import { resolveSummary } from "./summary.js";

/** A session is considered stale if its last event is older than this. */
const STALE_TTL_MS = 15 * 60 * 1000;

function isExcluded(project: string, filters: MiranteConfig["filters"]): boolean {
  if (filters.excludeProjects.includes(project)) return true;
  if (filters.includeProjects.length > 0 && !filters.includeProjects.includes(project)) return true;
  return false;
}

/**
 * Merge hook-owned live records with task progress, usage, and the resolved
 * summary into render-ready `SessionView`s. Runs fresh on every call; nothing
 * is persisted. Applies project filters and reconciles dead sessions.
 *
 * The active `model` comes from the hook-stamped live record when present, and
 * falls back to the transcript's most recent assistant model otherwise (the
 * reliable source before the hook stamps it).
 */
export async function buildSessionViews(config: MiranteConfig): Promise<SessionView[]> {
  const [live, aliveCount] = await Promise.all([readLiveRecords(), readAliveClaudeCount()]);
  const now = Date.now();

  const views = await Promise.all(
    live.map(async (rec): Promise<SessionView | null> => {
      const project = basename(rec.cwd || "");
      if (isExcluded(project, config.filters)) return null;

      // One transcript scan per session: usage, recap, and model come from the
      // same digest instead of three separate re-scans.
      const [progress, digest] = await Promise.all([
        readTaskProgress(rec.sessionId),
        readTranscriptDigest(rec.sessionId),
      ]);
      const summary = await resolveSummary(rec.sessionId, progress, config, {
        getRecap: async () => digest.recap,
        getStored: readStoredSummary,
      });
      const usage = digest.usage;
      const model = rec.model ?? digest.model;

      const ageMs = now - Date.parse(rec.ts || "");
      const timedOut = Number.isNaN(ageMs) ? false : ageMs > STALE_TTL_MS;
      const stale = rec.state === "ended" || timedOut || aliveCount === 0;
      const state = stale ? "stale" : rec.state;

      return {
        sessionId: rec.sessionId,
        project,
        cwd: rec.cwd,
        ...(model ? { model } : {}),
        state,
        ...(rec.tool ? { tool: rec.tool } : {}),
        lastEventTs: rec.ts,
        progress,
        usage,
        summary,
        alive: !stale,
      };
    }),
  );

  return views.filter((v): v is SessionView => v !== null);
}
