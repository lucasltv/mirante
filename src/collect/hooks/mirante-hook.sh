#!/usr/bin/env bash
#
# mirante-hook.sh — fast, hot-path-safe Claude Code hook. Stamps the session's
# live state into ~/.claude/mirante/live/<sessionId>.json. Does NO heavy work
# (no tasks/ or transcript reads) so PreToolUse/PostToolUse stay cheap.
#
# Usage (registered by `mirante install`):
#   mirante-hook.sh SessionStart
#   mirante-hook.sh UserPromptSubmit
#   mirante-hook.sh PreToolUse
#   mirante-hook.sh PostToolUse
#   mirante-hook.sh Notification
#   mirante-hook.sh Stop
#   mirante-hook.sh SessionEnd
#
# Reads the hook JSON from stdin (session_id, cwd, message, tool_name, ...).
# ALWAYS exits 0 — Mirante must never break or slow a Claude session.

set -uo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

EVENT="${1:-Notification}"
LIVE_DIR="$HOME/.claude/mirante/live"

# Fail-open wrapper: any error below must not propagate to Claude.
main() {
  local payload sid cwd tool msg state now
  payload="$(cat 2>/dev/null || true)"

  if command -v jq >/dev/null 2>&1 && [ -n "$payload" ]; then
    sid="$(printf '%s' "$payload"  | jq -r '.session_id // .sessionId // empty' 2>/dev/null || true)"
    cwd="$(printf '%s' "$payload"  | jq -r '.cwd // empty' 2>/dev/null || true)"
    tool="$(printf '%s' "$payload" | jq -r '.tool_name // empty' 2>/dev/null || true)"
    msg="$(printf '%s' "$payload"  | jq -r '.message // empty' 2>/dev/null || true)"
  fi
  [ -n "${sid:-}" ] || return 0   # no session id → nothing to key on
  [ -n "${cwd:-}" ] || cwd="$PWD"

  case "$EVENT" in
    SessionStart)      state="starting" ;;
    UserPromptSubmit)  state="working" ;;
    PreToolUse|PostToolUse) state="working" ;;
    Notification)
      # Heuristic: permission prompts vs idle nudges. Refined in code later.
      case "$msg" in
        *ermission*|*approve*|*Approve*) state="needs-permission" ;;
        *) state="idle" ;;
      esac ;;
    Stop)              state="awaiting-input" ;;
    SessionEnd)        state="ended" ;;
    *)                 state="working" ;;
  esac

  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  mkdir -p "$LIVE_DIR" 2>/dev/null || true

  local file="$LIVE_DIR/$sid.json"
  if [ "$state" = "ended" ]; then
    rm -f "$file" 2>/dev/null || true
    return 0
  fi

  if command -v jq >/dev/null 2>&1; then
    jq -n --arg sid "$sid" --arg state "$state" --arg tool "$tool" \
          --arg cwd "$cwd" --arg ts "$now" \
      '{sessionId:$sid, state:$state, cwd:$cwd, ts:$ts}
       + (if $tool == "" then {} else {tool:$tool} end)' \
      > "$file.tmp" 2>/dev/null && mv "$file.tmp" "$file" 2>/dev/null || true
  fi
}

main || true
exit 0
