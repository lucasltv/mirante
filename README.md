# Mirante

> A glanceable macOS menu bar overview of every active Claude CLI session —
> live status, **task-progress %**, and a **plain-language recap** of what each
> session is doing.

Named after the Portuguese _mirante_: a lookout point from which you see the
whole panorama at once.

## Why

Running several Claude CLI sessions at once, two questions have no good answer:

1. **Which session needs me now?** — awaiting permission, finished, or idle.
2. **How far along is each, and what is it doing** — in plain words.

The community already covers live status, tokens/cost, and click-to-focus.
Mirante's differentiator is the pair nobody surfaces:

- **Task-progress %** derived from Claude Code's own task list.
- **Plain-language recap** sourced first from the native `/recap`, then an
  optional summarizer, then the task list.

Mirante also replaces ad-hoc clickable-notification hooks with one configurable
tool.

## Status

🚧 Early development. Design is in [`docs/spec.md`](docs/spec.md). Implementation
plan pending.

## Install (planned)

```bash
npx mirante install     # merge hooks (backup + idempotent), install the widget, migrate old hooks
npx mirante config      # open the config UI
npx mirante doctor      # validate setup
npx mirante uninstall   # remove only Mirante's hooks
```

## Architecture

No always-on daemon. Hooks stamp events (fast); the widget refresh computes
derived state; the summarizer is event-triggered and opt-in. See
[`docs/spec.md`](docs/spec.md) for the full design.

## Requirements

- macOS
- [Claude Code](https://claude.com/claude-code) CLI (≥ 2.1.114 for `/recap`)
- [SwiftBar](https://github.com/swiftbar/SwiftBar) (installed by `mirante install`)
- Optional: `terminal-notifier` for clickable notifications; `ANTHROPIC_API_KEY`
  for the optional summarizer.

## License

MIT © 2026 Lucas Vieira
