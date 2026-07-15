# Mirante config UI

React/Vite app served on-demand by `npx mirante config` on an ephemeral
localhost server. Reads and writes `~/.claude/mirante/config.json` via a small
local API.

Toggles: widget host + refresh, feature switches (task %, tokens, cost,
click-to-focus), summary source + Haiku opt-in (API key env), per-hook
notification rules, and project filters.

Designed to grow into a live dashboard later (same `session-status` data, over
SSE), so keep the data layer decoupled from the config forms.

> Scaffolding follows the implementation plan (Vite app not initialized yet).
