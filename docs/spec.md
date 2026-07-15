# Mirante — Design Spec

> A glanceable macOS menu bar overview of every active Claude CLI session:
> live status, task-progress %, and a plain-language recap of what each session
> is doing. Named after the Portuguese _mirante_ — a lookout point from which
> you see the whole panorama at once.

- **Status:** Design approved (brainstorming). Implementation plan pending.
- **Date:** 2026-07-15
- **Platform:** macOS (first target)
- **Stack:** TypeScript/Node (CLI + collector + summarizer), shell (hooks),
  React/Vite (config UI), SwiftBar (primary widget surface).
- **License:** MIT (open source).

---

## 1. Motivation

Running several Claude CLI sessions across terminals/IDEs, there is no
cross-session, at-a-glance answer to two questions:

1. **Which session needs me right now?** (awaiting permission / finished / idle)
2. **How far along is each one, and what is it actually doing** — in plain
   language, without engineering jargon?

The community already covers live status, tokens/cost, and click-to-focus well
(see §9, Prior Art). Mirante's differentiator is the pair the field does **not**
cover:

- **Task-progress %** derived from Claude Code's own task list.
- **Plain-language recap** of each session, sourced first from Claude Code's
  native `/recap`, then from an optional summarizer, then from the task list.

Mirante also **subsumes** the user's existing clickable-notification hooks
(`notify-focus.sh` / `focus-terminal.sh`) into one configurable tool.

## 2. Scope

### In scope (MVP)
- Live status per session (working / awaiting-input / needs-permission / idle / ended).
- Task-progress % from `~/.claude/tasks/<session_id>/`.
- Plain-language recap (recap → Haiku → task subject fallback chain).
- Token totals and estimated cost per session (from transcript `usage`).
- Configurable notifications per hook type (replaces `notify-focus`).
- Clickable notifications and click-to-focus that raise the originating
  terminal/window (ported from `focus-terminal.sh`).
- SwiftBar menu-bar widget as the primary surface.
- On-demand React/Vite config UI (`npx mirante config`).
- npx installer with idempotent `settings.json` hook merge, `uninstall`, `doctor`.
- Optional bundled skill that nudges sessions to maintain the task list.

### Out of scope (MVP, revisit later)
- Übersicht desktop cards (keep `session-status/` format neutral so a second
  front-end can be added without rework).
- Always-on web dashboard (the config UI is designed to grow into this later).
- Non-macOS platforms.
- Remote / mobile access.

## 3. Architecture

No always-on daemon. Hooks stamp events (fast); the widget refresh computes
derived state; the summarizer is event-triggered and opt-in.

```
config.json  ← single source of truth (features on/off, API key, thresholds, filters)
   ▲ written by
   └── Config UI (React/Vite, localhost, on-demand)

Claude CLI session
  │ hooks (POSIX shell, always exit 0)
  ▼
~/.claude/mirante/live/<session_id>.json   ← owned by hooks {state, tool, cwd, model, ts}
~/.claude/tasks/<session_id>/*.json        ← native (read-only): completed/total → %
<transcript>.jsonl                         ← native (read-only): usage → tokens/cost;
                                              system/away_summary → recap
~/.claude/mirante/summary/<session_id>.json ← owned by summarizer (opt-in)
  ▼
SwiftBar widget (Node, refresh ~4s) → reads config + merges sources → renders enabled features
```

### Key decisions
- **Hot path stays trivial.** `PreToolUse`/`PostToolUse` fire on every tool call;
  hooks must not pay a Node cold start. Hooks are minimal shell that upsert a
  small `live/<id>.json`. All heavier computation happens at widget-refresh time.
- **Per-session file keying** avoids write contention (each session's hooks write
  a distinct file).
- **Separate ownership** of files: hooks own `live/`, summarizer owns `summary/`,
  the widget derives `%`/tokens/cost fresh at render (never a shared mutable file).

## 4. Components

| # | Component | Stack | Responsibility |
|---|-----------|-------|----------------|
| 1 | Hooks | POSIX shell | Stamp state into `live/<id>.json` on SessionStart, UserPromptSubmit, Pre/PostToolUse, Notification, Stop, SessionEnd. Always `exit 0`. |
| 2 | Enricher | Node (in widget) | On refresh: read `tasks/` → %, transcript → tokens/cost + recap, `pgrep` → reconcile dead sessions. |
| 3 | Summarizer | Node + Haiku | Opt-in. Event-triggered background spawn. Reads transcript tail, produces a jargon-free one-liner. Fallback if disabled/offline. |
| 4 | Notifier | Node/shell | Configurable notification per hook type. Clickable → focus originating terminal (ported focus logic). Replaces `notify-focus`. |
| 5 | Widget | SwiftBar plugin (Node) | Aggregate menu-bar icon + one dropdown card per session. Renders only enabled features. |
| 6 | Config UI | React/Vite (localhost) | `npx mirante config` serves an ephemeral page; toggles + API key + thresholds → writes `config.json`. Designed to grow into a live dashboard. |
| 7 | Installer | Node CLI (npx) | `install` / `uninstall` / `config` / `doctor`. |
| 8 | Skill (optional) | markdown | Nudges sessions to maintain the task list, maximizing `%` coverage. Installed to `~/.agents/skills`. |

## 5. Data sources (verified)

Confirmed against Claude Code 2.1.210 on this machine:

- **Task list:** `~/.claude/tasks/<session_id>/<n>.json`, one file per task, fields
  `{id, subject, status, activeForm}`, status ∈ `pending|in_progress|completed`.
  → `% = completed / total`; current-activity label = `in_progress` task's
  `subject`/`activeForm`.
- **Transcript:** `~/.claude/projects/<proj>/<session_id>.jsonl`, append-only.
  Per line: `sessionId`, `cwd`, `gitBranch`, `message.model`, `message.usage`
  (input/output/cache tokens → cost), `timestamp`, `type`.
- **Recap:** a `type: "system"`, `subtype: "away_summary"` line with a plain
  `content` string and `timestamp`. Native `/recap` output (Claude Code ≥ 2.1.114).
- **Liveness:** `pgrep claude` to reconcile sessions that died without `SessionEnd`.

> **Fragility note:** `tasks/` and the `away_summary` subtype are internal and
> undocumented. All readers MUST degrade gracefully (missing/renamed → skip the
> feature, never crash).

## 6. Status state machine

| Hook event | State |
|------------|-------|
| `SessionStart` | `starting` |
| `UserPromptSubmit` | `working` |
| `PreToolUse` / `PostToolUse` | `working` (with `tool` name) |
| `Notification` (permission) | `needs-permission` |
| `Notification` (idle) | `idle` |
| `Stop` | `awaiting-input` |
| `SessionEnd` | `ended` (record removed / marked) |

Aggregate menu-bar icon priority: `needs-permission` > `working` > `awaiting-input` > `idle`.

Stale reconciliation: if `live/<id>.json` has no `SessionEnd` but the pid is gone
(`pgrep`) or `last_event_ts` exceeds a TTL, mark `stale` and drop.

## 7. Summary source chain (`/recap` first)

1. **`away_summary`** (native `/recap`) — preferred when present and recaps are
   not disabled in `/config`. Free, offline, no API key.
2. **Haiku summarizer** (opt-in) — covers sessions without a recap yet (recap only
   fires after ~3 min unfocused + ≥3 turns). Requires `ANTHROPIC_API_KEY`.
3. **Task `in_progress` subject + `ai-title`** — always-on offline fallback.

`config.summary.source: "auto"` walks this chain; `"native"` stops at level 1/3
(never calls Haiku); `"haiku"` prefers level 2 when enabled.

## 8. Notifications (replaces `notify-focus`)

Configurable per hook type. Ported behavior from the user's existing scripts:
clickable via `terminal-notifier`, click raises the originating VS Code window
(by folder name) or Terminal.app tab (by tty); `osascript` fallback when
`terminal-notifier` is absent.

| Event | Default | Configurable |
|-------|---------|--------------|
| `Notification` (permission/idle) | on, sound `Glass` | enabled, sound, title/message template |
| `Stop` (finished) | on, sound `Hero` | enabled, sound, title/message template |
| `SessionEnd` | off | enabled, sound |

The focus module is shared with the widget's click-to-focus. Extensible to more
terminals (iTerm2, Ghostty, Warp) post-MVP; MVP keeps parity with the current
VS Code + Terminal.app support.

**Migration:** `install` detects existing `notify-focus.sh` hooks in
`Notification`/`Stop` and offers to remove them, so notifications are not doubled.

## 9. Configuration

`~/.claude/mirante/config.json` — single source of truth, validated with a schema.

```jsonc
{
  "widget": { "host": "swiftbar", "refreshSec": 4 },
  "features": {
    "taskProgress": true,
    "tokens": true,
    "cost": true,
    "clickToFocus": true
  },
  "summary": {
    "source": "auto",                 // "auto" | "native" | "haiku"
    "haiku": { "enabled": false, "apiKeyEnv": "ANTHROPIC_API_KEY", "model": "claude-haiku-4-5-20251001" }
  },
  "notifications": {
    "Notification": { "enabled": true,  "sound": "Glass" },
    "Stop":         { "enabled": true,  "sound": "Hero"  },
    "SessionEnd":   { "enabled": false }
  },
  "filters": { "includeProjects": [], "excludeProjects": [] }
}
```

## 10. Installation & CLI

```
npx mirante install     # merge hooks into settings.json (backup + idempotent),
                        # brew install swiftbar if missing, drop plugin,
                        # offer notify-focus migration, optionally install skill
npx mirante uninstall   # remove only Mirante's hooks; restore is safe
npx mirante config      # open the config UI (ephemeral localhost server)
npx mirante doctor      # validate permissions, deps, hook wiring, data access
```

`settings.json` merge rules: back up first; **append** to existing hook arrays
(the user already has `notify-focus` on `Notification`/`Stop` and `context-mode`
on `SessionStart`); never clobber; idempotent (second run is a no-op).

## 11. Error handling

- Every hook `exit 0` under a trap — Mirante must never break or slow a session.
- `tasks/` format change → no `%`, no crash.
- Transcript unreadable / rotating → skip tokens for that session.
- Summarizer without API key / offline / rate-limited → fall back down the chain,
  never block.
- Dead session without `SessionEnd` → reconcile via `pgrep` + `last_event_ts` TTL.
- `settings.json` merge always backs up before writing.

## 12. Testing

- **Unit:** parse `tasks/` → `%`; parse `usage` → tokens/cost; `settings.json`
  merge idempotency; hook event → `live/` upsert; recap extraction from transcript.
- **Integration:** synthetic session dir (`tasks/` + transcript with an
  `away_summary`) → assert the widget's rendered JSON.
- **Idempotency:** run `install` twice → `settings.json` unchanged on the 2nd run.
- **Summary chain:** mocked Haiku → assert fallback when native recap absent and
  Haiku disabled/offline.
- **Manual:** real multi-session smoke test on macOS.

## 13. Prior art (differentiation)

Crowded field; Mirante deliberately does **not** re-compete on the commodity
layer (live status, tokens/cost, focus, install mechanics), and instead owns the
gap: task-progress % + plain-language recap.

- gmr/claude-status — native menu bar + WidgetKit widgets, analytics, focus.
- Stargx/claude-code-dashboard — tokens/cost, active tools, context-window bar.
- m1ckc3s/claude-status-bar — aggregate menu bar icon, lifecycle.
- joe-re/eyes-on-claude-code — hook events → menubar + dashboard.

None surface task-list completion % or a native-recap-based plain summary.

## 14. Open questions / follow-ups

- Exact SwiftBar refresh-on-signal vs interval polling for near-instant updates.
- Whether the config UI should expose a live preview of a session card.
- Pricing table maintenance for cost estimation (per-model constants).
