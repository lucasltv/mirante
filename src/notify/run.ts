import { pathToFileURL } from "node:url";
import { loadConfig } from "../core/config.js";
import type { NotifiableHook } from "../core/config.js";
import { notify, type NotifyDeps, type NotifyInput } from "./notifier.js";

/** The events that carry a notification (subset of the seven Mirante hooks). */
const NOTIFIABLE: readonly NotifiableHook[] = ["Notification", "Stop", "SessionEnd"];

/**
 * Map the hook's positional args into a NotifyInput, or null when the event is
 * not notifiable. Invoked as: run.js <event> <mode> <target> <project> <message>
 */
export function buildInput(argv: string[]): NotifyInput | null {
  const [event, mode, target, project, message] = argv;
  if (!event || !NOTIFIABLE.includes(event as NotifiableHook)) return null;
  const resolvedMode = mode === "vscode" || mode === "terminal" ? mode : "other";
  return {
    event: event as NotifiableHook,
    project: project ?? "",
    message: message ?? "",
    focus: { mode: resolvedMode, target: target ?? "" },
  };
}

/** Build the input, load config, and dispatch. Never throws. */
export async function runNotify(argv: string[], deps?: NotifyDeps): Promise<void> {
  const input = buildInput(argv);
  if (!input) return;
  const config = await loadConfig();
  await notify(input, config, deps);
}

// CLI entry: only when executed directly (so tests can import the functions).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runNotify(process.argv.slice(2)).catch(() => {});
}
