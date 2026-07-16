# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Mirante is a glanceable macOS menu-bar overview of every active Claude CLI
session: live status, task-progress %, and a plain-language recap. It ships as
an `npx`-installed CLI (`bin: mirante`) plus a SwiftBar widget. Node/TypeScript
core, POSIX-shell hooks, a planned React/Vite config UI.

The differentiator (see `docs/spec.md` §1, §13) is the pair the field doesn't
surface: **task-progress %** (from Claude Code's native task list) and a
**plain-language recap** (native `/recap` → optional Haiku → task subject).

## Commands

- Build: `npm run build` (tsc → `dist/`, the packaged output).
- Watch build: `npm run dev`.
- Typecheck: `npm run typecheck` (tsc `--noEmit`).
- Test (all): `npm test` or `npx vitest run`.
- Test (single file): `npx vitest run src/core/config.test.ts`.
- Test (watch): `npx vitest`.
- Test (by name): `npx vitest run -t "prefers the native recap"`.
- Lint: `npm run lint` (`eslint .`) — ESLint 9 flat config in `eslint.config.js`
  (typescript-eslint recommended; ignores `dist/`, `src/ui/`, `.history/`). Green.

Task-acceptance note: this repo's owner requires build + lint green before any
task is considered done. Run both and attach the evidence — don't silently claim
they passed.

## Architecture

**No always-on daemon.** Three actors with strict, separate file ownership:

1. **Hooks** (`src/collect/hooks/mirante-hook.sh`) fire on Claude Code lifecycle
   events and stamp a tiny `live/<sessionId>.json`. Hot-path safe: Pre/PostToolUse
   run on every tool call, so the hook does *no* heavy work (no task/transcript
   reads), and **always `exit 0`** — Mirante must never break or slow a session.
2. **The enricher** (`src/collect/enrich.ts`, called by the widget on refresh)
   reads everything fresh and merges it into render-ready `SessionView`s. Nothing
   here is persisted as shared mutable state — it's recomputed each refresh.
3. **The summarizer** (`src/collect/summary.ts`, opt-in, event-triggered) writes
   `summary/<sessionId>.json` via Haiku.

Data flow (spec §3):

```
hooks           → ~/.claude/mirante/live/<id>.json      (Mirante-owned, {state,tool,cwd,ts})
native (RO)     → ~/.claude/tasks/<id>/*.json           (task list → progress %)
native (RO)     → ~/.claude/projects/<proj>/<id>.jsonl  (transcript → usage/cost + away_summary recap)
summarizer      → ~/.claude/mirante/summary/<id>.json   (Mirante-owned)
config          → ~/.claude/mirante/config.json         (single source of truth, Zod-validated)
                → SwiftBar widget reads config + merges all sources → renders
```

### Invariants that must not be broken

- **Graceful degradation over native state.** `tasks/`, the transcript shape, and
  the `away_summary` recap subtype are internal, undocumented Claude Code details.
  Every reader must degrade to an empty/neutral result on a missing/renamed/
  malformed shape — **never throw**. See the `try/catch → EMPTY_*` pattern in
  `sessionStore.ts`.
- **Config loading never throws.** `loadConfig()` returns `structuredClone(DEFAULT_CONFIG)`
  on any failure (missing file, bad JSON, schema mismatch). `saveConfig()` is the
  only path that validates strictly.
- **Per-session file keying** (one file per session) avoids write contention
  between concurrent sessions' hooks.
- **`CLAUDE_CONFIG_DIR` is the test seam.** `src/core/paths.ts` resolves all paths
  from it (falling back to `~/.claude`), the same override Claude Code honors.
  Tests point it at a synthetic fixture home (`test/fixtures.ts` → `makeFixture()`)
  so nothing touches the real `~/.claude`. Never hardcode `~/.claude` — derive
  from the `paths.ts` constants.

## Module map

- `src/core/paths.ts` — all Claude/Mirante path constants + `claudeTasksDirFor()`.
- `src/core/types.ts` — domain types (`SessionState`, `LiveRecord`, `TaskProgress`,
  `Usage`, `SessionView`, `SessionSummary`). Read this first.
- `src/core/config.ts` — `MiranteConfig`, `DEFAULT_CONFIG`, Zod schema, `loadConfig`/`saveConfig`.
- `src/core/pricing.ts` — per-model `PRICING` table (USD per 1M tokens) + pure
  `estimateCost()`. Constants need periodic maintenance; unknown model → `null` cost.
- `src/collect/sessionStore.ts` — read-only collectors: `readTaskProgress`,
  `readUsage`, `readNativeRecap`, `readSessionModel`, `readLiveRecords`, `readAliveClaudeCount`.
- `src/collect/summary.ts` — `resolveSummary` (recap→haiku→task chain), `runHaikuSummarizer`.
- `src/collect/enrich.ts` — `buildSessionViews`: merge + project filters + stale reconciliation.
- `src/cli/index.ts` — npx dispatcher (`install`/`uninstall`/`config`/`doctor`, plus hidden `status`).
- `src/notify/notifier.ts` + `src/notify/focus-terminal.sh` — configurable notifications
  and click-to-focus (raises the originating VS Code window / Terminal tab).
- `src/widget/swiftbar/mirante.4s.js` — SwiftBar plugin entry (the `.4s` = 4s refresh);
  imports the built enricher from `dist/`.
- `src/ui/` — React/Vite config UI (excluded from tsc build; not yet initialized).
- `assets/skill/SKILL.md` — optional companion skill nudging sessions to keep a task list.

## Conventions

- **NodeNext ESM.** `"type": "module"`; intra-repo imports use explicit `.js`
  extensions (e.g. `import { loadConfig } from "../core/config.js"`) even though
  the source is `.ts`. `strict` + `noUncheckedIndexedAccess` + `noImplicitOverride`.
- **TDD, plan-driven.** Work follows `docs/plans/` task-by-task (checkbox steps,
  write-failing-test-first). Each task ends with its own conventional commit.
- **Commit style** (from git history): conventional commits scoped by area, e.g.
  `feat(collect):`, `feat(core):`, `fix(collect):`, `docs(spec):`.
- Optional properties on `SessionView`/records are built with the
  `...(x ? { key: x } : {})` spread idiom to satisfy `exactOptionalPropertyTypes`-style strictness.

## Current implementation state

**Plan 1 (Foundation & Collector) is complete** — see
`docs/plans/2026-07-15-foundation-collector.md`. Implemented and tested end-to-end:
all of `core/` (paths, config, pricing, types), all of `sessionStore.ts` (task
progress, usage/cost, native recap, active model, live records, alive count),
`summary.ts` (`resolveSummary` chain; `runHaikuSummarizer` is a Plan-5 boundary
stub), `enrich.ts` (`buildSessionViews` with project filters + stale
reconciliation + model surfacing), and a hidden `mirante status` debug command.
Still stubs pending later plans: `notifier.ts` (Plan 3), the `install`/`uninstall`/
`config`/`doctor` CLI commands (Plans 2/6), the SwiftBar widget render (Plan 4),
and the real Haiku summarizer (Plan 5). Later plans (2–6) cover the installer/hook
wiring, notifications, widget rendering, the Haiku summarizer, and the config UI.
`docs/spec.md` is the approved design of record (see its §2 roadmap for the
next-release Claude account plan-usage panel).
