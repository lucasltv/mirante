import type { MiranteConfig, NotifiableHook } from "../core/config.js";

/**
 * Configurable notifications, one rule per hook type. Replaces the user's
 * ad-hoc notify-focus scripts. Clickable via `terminal-notifier` (falls back to
 * `osascript display notification` when absent); clicking runs
 * `focus-terminal.sh` to raise the originating VS Code window / Terminal tab.
 *
 * Called from the hook path when `config.notifications[event].enabled`.
 * Implementation follows the plan.
 */
export interface NotifyInput {
  event: NotifiableHook;
  project: string;
  message: string;
  /** How to focus on click, resolved from $TERM_PROGRAM + controlling tty. */
  focus: { mode: "vscode" | "terminal" | "other"; target: string };
}

export declare function notify(input: NotifyInput, config: MiranteConfig): Promise<void>;
