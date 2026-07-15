/**
 * Mirante configuration — the single source of truth every component reads.
 * Persisted to `~/.claude/mirante/config.json` and written by the config UI.
 *
 * NOTE: schema validation (e.g. zod) is intentionally not wired yet; this module
 * defines the shape and defaults. Load/save/validate implementation follows the
 * implementation plan.
 */

export type WidgetHost = "swiftbar" | "ubersicht";
export type SummarySourceMode = "auto" | "native" | "haiku";
export type NotifiableHook = "Notification" | "Stop" | "SessionEnd";

export interface NotificationRule {
  enabled: boolean;
  /** macOS notification sound name (e.g. "Glass", "Hero"). */
  sound?: string;
  /** Optional templates; `{project}`, `{message}` are substituted. */
  titleTemplate?: string;
  messageTemplate?: string;
}

export interface MiranteConfig {
  widget: {
    host: WidgetHost;
    refreshSec: number;
  };
  features: {
    taskProgress: boolean;
    tokens: boolean;
    cost: boolean;
    clickToFocus: boolean;
  };
  summary: {
    source: SummarySourceMode;
    haiku: {
      enabled: boolean;
      /** Env var name that holds the API key — never the key itself. */
      apiKeyEnv: string;
      model: string;
    };
  };
  notifications: Record<NotifiableHook, NotificationRule>;
  filters: {
    includeProjects: string[];
    excludeProjects: string[];
  };
}

export const DEFAULT_CONFIG: MiranteConfig = {
  widget: { host: "swiftbar", refreshSec: 4 },
  features: {
    taskProgress: true,
    tokens: true,
    cost: true,
    clickToFocus: true,
  },
  summary: {
    source: "auto",
    haiku: {
      enabled: false,
      apiKeyEnv: "ANTHROPIC_API_KEY",
      model: "claude-haiku-4-5-20251001",
    },
  },
  notifications: {
    Notification: { enabled: true, sound: "Glass" },
    Stop: { enabled: true, sound: "Hero" },
    SessionEnd: { enabled: false },
  },
  filters: { includeProjects: [], excludeProjects: [] },
};
