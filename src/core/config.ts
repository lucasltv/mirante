/**
 * Mirante configuration — the single source of truth every component reads.
 * Persisted to `~/.claude/mirante/config.json` and written by the config UI.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { MIRANTE_CONFIG_FILE } from "./paths.js";

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

const notificationRuleSchema = z.object({
  enabled: z.boolean(),
  sound: z.string().optional(),
  titleTemplate: z.string().optional(),
  messageTemplate: z.string().optional(),
});

const configSchema = z.object({
  widget: z.object({
    host: z.enum(["swiftbar", "ubersicht"]),
    refreshSec: z.number().int().positive(),
  }),
  features: z.object({
    taskProgress: z.boolean(),
    tokens: z.boolean(),
    cost: z.boolean(),
    clickToFocus: z.boolean(),
  }),
  summary: z.object({
    source: z.enum(["auto", "native", "haiku"]),
    haiku: z.object({
      enabled: z.boolean(),
      apiKeyEnv: z.string(),
      model: z.string(),
    }),
  }),
  notifications: z.object({
    Notification: notificationRuleSchema,
    Stop: notificationRuleSchema,
    SessionEnd: notificationRuleSchema,
  }),
  filters: z.object({
    includeProjects: z.array(z.string()),
    excludeProjects: z.array(z.string()),
  }),
});

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Deep-merge a partial config over a fresh clone of the defaults. Nested plain
 * objects merge recursively (so a partial `summary.haiku` keeps the default
 * apiKeyEnv/model); arrays and scalars from the partial replace the default.
 * Non-object partials are ignored (fall through to a full defaults clone).
 * Unknown keys are harmless — `configSchema.parse` strips them.
 */
function mergeDefaults(partial: unknown): MiranteConfig {
  const out = structuredClone(DEFAULT_CONFIG) as unknown as Record<string, unknown>;
  mergeInto(out, partial);
  return out as unknown as MiranteConfig;
}

function mergeInto(target: Record<string, unknown>, patch: unknown): void {
  if (!isPlainObject(patch)) return;
  for (const [key, value] of Object.entries(patch)) {
    const current = target[key];
    if (isPlainObject(current) && isPlainObject(value)) {
      mergeInto(current, value);
    } else {
      target[key] = value;
    }
  }
}

/** Load config from disk, filling missing fields from defaults. */
export async function loadConfig(): Promise<MiranteConfig> {
  let raw: string;
  try {
    raw = await readFile(MIRANTE_CONFIG_FILE, "utf8");
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
  try {
    return configSchema.parse(mergeDefaults(parsed));
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
}

/** Validate and persist config to disk. */
export async function saveConfig(config: MiranteConfig): Promise<void> {
  const valid = configSchema.parse(config);
  await mkdir(dirname(MIRANTE_CONFIG_FILE), { recursive: true });
  await writeFile(MIRANTE_CONFIG_FILE, JSON.stringify(valid, null, 2) + "\n");
}
