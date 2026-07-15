---
name: mirante-task-tracking
description: Optional companion skill for Mirante. Nudges the session to keep a task list current so Mirante can show an accurate task-progress %.
---

# Mirante task tracking

Mirante derives each session's progress bar from the Claude Code task list
(`~/.claude/tasks/<sessionId>/`). Sessions that don't maintain a task list show
status but no percentage.

To maximize the value of Mirante's progress view:

- For any multi-step task (3+ distinct steps), create tasks up front so
  `completed / total` reflects real progress.
- Mark exactly one task `in_progress` at a time — Mirante uses its `subject` as
  the plain-language "current activity" fallback when no native `/recap` exists.
- Keep tasks at a meaningful granularity: too coarse and the bar jumps; too fine
  and it never moves.

This skill is optional. Mirante works without it — the percentage is simply
absent for sessions that don't track tasks.
