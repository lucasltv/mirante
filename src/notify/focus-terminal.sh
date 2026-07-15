#!/usr/bin/env bash
#
# focus-terminal.sh — raise the terminal/window that originated a Mirante
# notification. Invoked by terminal-notifier's -execute on click, and reused by
# the widget's click-to-focus. Ported from the user's proven notify-focus setup.
#
# Usage:
#   focus-terminal.sh vscode   "<project-folder-name>"
#   focus-terminal.sh terminal "/dev/ttysNNN"
#
# vscode:   activates VS Code and raises the window whose title contains the
#           folder name. (The integrated terminal tab is not scriptable; window
#           is the reliable maximum.)
# terminal: activates Terminal.app and selects the tab whose tty matches.
#
# Extensible to iTerm2 / Ghostty / Warp post-MVP.

set -uo pipefail

MODE="${1:-}"
TARGET="${2:-}"

case "$MODE" in
  vscode)
    /usr/bin/osascript - "$TARGET" <<'APPLESCRIPT'
on run argv
  set proj to item 1 of argv
  tell application "System Events"
    tell process "Code"
      try
        set win to first window whose title contains proj
        perform action "AXRaise" of win
      end try
    end tell
  end tell
  tell application "Visual Studio Code" to activate
end run
APPLESCRIPT
    ;;

  terminal)
    /usr/bin/osascript - "$TARGET" <<'APPLESCRIPT'
on run argv
  set targetTty to item 1 of argv
  tell application "Terminal"
    activate
    repeat with w in windows
      repeat with t in tabs of w
        try
          if tty of t is targetTty then
            set selected of t to true
            set index of w to 1
          end if
        end try
      end repeat
    end repeat
  end tell
end run
APPLESCRIPT
    ;;

  *)
    /usr/bin/osascript -e 'tell application "System Events" to set frontmost of first process whose frontmost is false to true' >/dev/null 2>&1 || true
    ;;
esac
