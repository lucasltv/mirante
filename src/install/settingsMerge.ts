/**
 * Pure transforms over a parsed `settings.json` object. Mirante owns exactly the
 * hook groups whose command references `mirante-hook.sh` (the marker); every
 * other key and hook is preserved untouched. All functions return a fresh object
 * and never mutate their input.
 */

export interface HookCommand {
  type: string;
  command: string;
  [k: string]: unknown;
}
export interface HookGroup {
  hooks?: HookCommand[];
  [k: string]: unknown;
}
export type Settings = Record<string, unknown>;

/** The seven lifecycle events Mirante stamps state on. */
export const MIRANTE_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "Notification",
  "Stop",
  "SessionEnd",
] as const;

/** Substring that identifies a Mirante-owned hook command. */
export const HOOK_MARKER = "mirante-hook.sh";

function miranteCommand(hookScriptPath: string, event: string): string {
  return `"${hookScriptPath}" ${event}`;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** True when a hook group contains a Mirante command. */
function isMiranteGroup(group: HookGroup): boolean {
  return (
    Array.isArray(group.hooks) &&
    group.hooks.some((h) => typeof h?.command === "string" && h.command.includes(HOOK_MARKER))
  );
}

/** Are Mirante's hooks already present anywhere in this settings object? */
export function hasMiranteHooks(settings: Settings): boolean {
  const hooks = settings.hooks;
  if (!isPlainObject(hooks)) return false;
  return Object.values(hooks).some(
    (groups) => Array.isArray(groups) && (groups as HookGroup[]).some(isMiranteGroup),
  );
}

/** Append a Mirante hook group to every event (idempotent, non-clobbering). */
export function mergeMiranteHooks(settings: Settings, hookScriptPath: string): Settings {
  const next = structuredClone(settings);
  const hooks: Record<string, HookGroup[]> = isPlainObject(next.hooks)
    ? (next.hooks as Record<string, HookGroup[]>)
    : {};
  next.hooks = hooks;

  for (const event of MIRANTE_EVENTS) {
    const groups = Array.isArray(hooks[event]) ? hooks[event] : [];
    hooks[event] = groups;
    if (groups.some(isMiranteGroup)) continue; // already installed for this event
    groups.push({ hooks: [{ type: "command", command: miranteCommand(hookScriptPath, event) }] });
  }
  return next;
}

/** Remove every Mirante-owned hook group, leaving all other hooks intact. */
export function removeMiranteHooks(settings: Settings): Settings {
  const next = structuredClone(settings);
  if (!isPlainObject(next.hooks)) return next;
  const hooks = next.hooks as Record<string, HookGroup[]>;
  for (const event of Object.keys(hooks)) {
    if (!Array.isArray(hooks[event])) continue;
    const kept = hooks[event].filter((g) => !isMiranteGroup(g));
    if (kept.length === 0) delete hooks[event];
    else hooks[event] = kept;
  }
  return next;
}
