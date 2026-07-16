---
name: pr-review
description: Multi-agent PR reviewer for Mirante. Use ONLY when explicitly asked to review a change set — "/pr-review", "review PR #N", "review this PR", "revisar PR", "revisar o branch". Do NOT trigger automatically during coding, feature implementation, or general questions.
license: CC-BY-4.0
metadata:
  author: Adapted from Fakeflix pr-review by Waldemar Neto
  version: 1.0.0
---

# PR Review — Orchestration Protocol

Coordinates **4 specialized subagents** (via the Task/Agent tool) then consolidates
findings into a unified summary. Each subagent loads the relevant Mirante docs
(`CLAUDE.md`, `docs/spec.md`, `docs/plans/`) — this skill does not duplicate them.
Mirante is a **single-package Node/TypeScript CLI + SwiftBar widget** (npm, NodeNext
ESM), NOT a monorepo. Tasks live in `docs/plans/` (checkbox steps), and — when a
change references one — in Linear. The design of record is `docs/spec.md`; the
architectural invariants are in `CLAUDE.md`.

## Two modes

- **PR mode** — a PR number is given (or found in context). Subagents post inline
  comments via `gh`; consolidation posts a PR-level summary.
- **Local mode** — no PR. Review the working branch vs `main`. Subagents **return**
  their findings (they do NOT touch `gh`); consolidation prints one terminal report.

Detect the mode in Step 1 and pass it to every subagent prompt.

## Step 1: Initialize

1. Determine the mode: if the user supplied a PR number → **PR mode**; otherwise → **local mode**.
2. Identify repo: `gh repo view --json nameWithOwner -q .nameWithOwner` (expected `lucasltv/mirante`).
3. Fetch the diff:
   - PR mode: `gh pr diff {PR_NUMBER}`
   - Local mode: `git diff main...HEAD` (merge-base diff of the current branch).
4. PR mode only — load existing inline comments: `gh api repos/{REPO}/pulls/{PR_NUMBER}/comments`
   → build a set of `{path, line}` pairs to avoid reposting.
5. Read intent:
   - PR mode: `gh pr view {PR_NUMBER} --json title,body,headRefName`
   - Local mode: `git log main..HEAD --format='%s%n%b'` + current branch name (`git rev-parse --abbrev-ref HEAD`).
6. Identify the governing plan/issue:
   - **Plan file:** Mirante branches follow `plan-{N}-{slug}` (e.g. `plan-1-foundation-collector`).
     Fuzzy-match the `{slug}` against files in `docs/plans/` (e.g. `2026-07-15-foundation-collector.md`).
   - **Linear (optional):** if a `[A-Z]+-[0-9]+` identifier appears in the branch, title, or body,
     record it for Subagent 1's Track A.

## Step 2: Launch Subagents in Parallel

Send **one message** with **four Task/Agent tool calls** — all launched simultaneously.
Pass to each subagent prompt: MODE, REPO, PR_NUMBER (if any), the diff, existing comment
locations (PR mode), the intent (title/body/commits), and the resolved plan file path /
Linear identifier. After all complete, run Step 3.

---

## Severity Labels (all subagents use these)

- 🚨 Critical — bugs or logic errors that will cause failures
- 🔒 Security/Safety — secret/PII leaks, unsafe hook shell, or a broken graceful-degradation guard
- ⚡ Performance — hot-path violations (hook doing heavy work; inefficient per-refresh enricher work)
- ⚠️ Warning — code smells or maintainability issues
- 💡 Suggestion — optional improvements

---

## Universal Rules (every subagent must follow)

1. **Comment allowlist:** Only report/post on lines in the diff starting with `+` (excluding `+++`).
2. **Skip duplicates:** PR mode — if `{path, line}` within ±3 lines already has a comment, skip.
3. **Mark resolved:** PR mode — reply `[RESOLVED] This appears resolved by the recent changes.`
   on existing comments where the issue is fixed.
4. **False-positive guard:** Only report findings with ≥80% confidence. Skip when uncertain.
5. **Positive highlight:** Include at least one genuinely well-done aspect before listing issues.
   Do not manufacture praise — if nothing stands out, say so.
6. **Tone:** Specific, actionable, collegial. Explain WHY something is a problem.
7. **Never** approve, request-changes, or modify files. PR mode uses `--comment` only.
8. **Marker:** Start every finding body with `<!-- mirante-review:{type} -->` (invisible when
   rendered; parsed by the consolidation subagent).
9. **Language:** Write review comments in **Brazilian Portuguese**; keep code identifiers,
   file paths, and `CLAUDE.md`/`spec.md` references verbatim (English).
10. **Output by mode:** PR mode — post each inline comment via
    `gh api repos/{REPO}/pulls/{PR_NUMBER}/comments` AND return the finding list.
    Local mode — do NOT call `gh`; just return the finding list in the comment format below.

---

## Subagent 1: Requirements & Definition of Done

**Marker:** `<!-- mirante-review:requirements -->`
**Posts:** One PR-level summary comment only — no inline comments.

Use a two-track approach to find requirements. Run both; use whichever yields content.

### Track A — Linear Issue (source of truth, when referenced)

1. If a `[A-Z]+-[0-9]+` identifier was found in the branch / title / body, fetch it via the
   Linear MCP (`mcp__claude_ai_Linear__get_issue` with the identifier). No curl/token needed.
2. Parse for acceptance criteria, gate-check items, and `Done when` definitions.
   **The acceptance criteria to verify are exactly those recorded in the Linear issue** —
   not a paraphrase from the PR body. If the PR body diverges from Linear, Linear wins.

### Track B — Plan file (`docs/plans/`)

1. Read the plan file resolved in Step 1 (fuzzy-matched to the branch slug), plus any spec
   section it points to in `docs/spec.md`.
2. Extract: the task's checkbox steps, acceptance criteria, and stated goals / non-goals.
   Mirante plans are checkbox-driven and TDD (write-failing-test-first) — treat unchecked
   boxes that the diff claims to satisfy as items to verify.

### Resolution Logic

| Tracks with content | Action                                                                                                                |
| ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Both A and B        | Merge requirements from both; note the source of each item                                                            |
| A only              | Use Linear requirements                                                                                               |
| B only              | Use plan/spec requirements                                                                                            |
| Neither             | Post: "⚠️ Nenhuma issue do Linear nem plano em `docs/plans/` encontrado — verificação de requisitos pulada." and stop |

**Always-on DoD (Mirante gate, independent of the issue):** build, lint, AND test must be
green. Flag if the change shows no evidence of all three passing:

- `npm run build` (tsc → `dist/`)
- `npm run lint` (`eslint .`)
- `npm test` (or `npx vitest run`)

Evidence = command + output shown in the PR/commit body, or the equivalent commands run.
This is a hard gate: the repo owner requires build + lint + test green before any task is done.

Compare the merged requirements against the diff.

- PR mode: post via `gh pr comment {PR_NUMBER} --body '...'`.
- Local mode: return the summary block.

**Second pass:** After drafting the summary, re-read the full requirements list one item at a
time and ask: "Did I evaluate this criterion against the diff?" For any item not yet assessed,
find the relevant section of the diff and explicitly mark it ✅, ❌, or 🔲.

**Summary format:**

```markdown
<!-- mirante-review:requirements -->

## 📋 Requirements Review

**Sources:** {e.g. "Linear: ABC-16" | "Plano: docs/plans/2026-07-15-foundation-collector.md" | "Ambos"}

### ✅ Implementado

### ❌ Faltando ou incompleto

### 🔲 Definition of Done

- [ ] `npm run build` green
- [ ] `npm run lint` green
- [ ] `npm test` green

### 💬 Notas
```

---

## Subagent 2: Architecture & Invariants

**Marker:** `<!-- mirante-review:architecture -->`

This agent also absorbs Mirante's thin security and performance surfaces — in this codebase,
**safety is graceful degradation and hook hygiene, and performance is the hot-path**, both of
which are invariants.

### Phase 0 — Load all reference documents

Load every document before touching the diff. Do not skip any.

1. `CLAUDE.md` (project) — the "Invariants that must not be broken", "Conventions", and "Module map" sections.
2. `docs/spec.md` — the design of record (read the sections the diff touches; §3 for data flow, plus any § referenced by the plan).
3. `eslint.config.js` and `tsconfig.json` for lint/compiler conventions (NodeNext, `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`).

### Phase 1 — Extract the rule list

Scan the loaded documents and extract every explicit invariant/convention into a single
numbered checklist. Do not omit any you find. The core invariants (seed — confirm each is
still present in `CLAUDE.md`, and add any others you find):

1. **Graceful degradation over native state** — every reader of `tasks/`, the transcript, or
   the `away_summary` recap subtype must degrade to an empty/neutral result on a missing /
   renamed / malformed shape and **never throw** (the `try/catch → EMPTY_*` pattern in
   `sessionStore.ts`). These are undocumented Claude Code internals.
2. **Config loading never throws** — `loadConfig()` returns `structuredClone(DEFAULT_CONFIG)`
   on any failure. Only `saveConfig()` validates strictly.
3. **Per-session file keying** — one file per session; no shared mutable state across sessions.
4. **`CLAUDE_CONFIG_DIR` test seam** — derive all paths from `src/core/paths.ts`; **never
   hardcode `~/.claude`**.
5. **Hooks are hot-path safe** — Pre/PostToolUse fire on every tool call, so the hook does
   **no heavy work** (no task/transcript reads) and **always `exit 0`**. Mirante must never
   break or slow a session.
6. **Enricher persists nothing** — `enrich.ts` recomputes render-ready views each refresh; no
   shared mutable state is written there.
7. **NodeNext ESM** — intra-repo imports use explicit `.js` extensions (e.g. `../core/config.js`).
8. **`exactOptionalPropertyTypes` idiom** — optional props built with `...(x ? { key: x } : {})`.
9. **Strict TS** — respect `noUncheckedIndexedAccess` (guard indexed access) and `noImplicitOverride`.
10. **File-ownership separation** — hooks own `live/`, the summarizer owns `summary/`, config is
    the single source of truth in `config.json`; readers of native state are read-only.

**Security/Safety facet (report under 🔒):** no secrets or transcript PII written to logs;
the hook shell (`mirante-hook.sh`) quotes inputs and cannot be injected and still `exit 0`s;
what the summarizer sends to Haiku is minimal/appropriate; unknown model → `null` cost, never a crash.

**Performance facet (report under ⚡):** the hook does no heavy work; the enricher (runs every
4s per widget refresh) avoids unbounded reads or O(N) round-trips it could batch.

Number the combined list sequentially from 1. This is your evaluation matrix for Phase 2.

### Phase 2 — Evaluate the matrix

Work through the diff **one file at a time**. For each changed file, for each rule decide:
**PASS** / **VIOLATION** / **N/A**. N/A only when the rule is structurally inapplicable
(e.g. a type-only file cannot violate the hot-path rule). For every VIOLATION, post/return an
inline comment on the exact `+` line, citing the rule number and source (`CLAUDE.md` / `spec.md §`).

**Second pass:** After the matrix for all files, re-read the full diff top to bottom. List every
file or hunk you did not evaluate and run the matrix again. Only skip a file when you can state
which rules are N/A and why.

**Comment format:**

```
<!-- mirante-review:architecture -->
[🚨/🔒/⚡/⚠️/💡] — [Short title]
Rule: [Rule number + source, e.g. "Rule 1 — CLAUDE.md graceful degradation"]
[What in the diff violates it — quote the offending line]
**Recommendation:** [Exact fix, code snippet if < 6 lines]
```

---

## Subagent 3: Test Coverage

**Marker:** `<!-- mirante-review:tests -->`

Review the diff against Mirante's test setup: **Vitest** (`npm test` / `npx vitest run`), TDD
(write-failing-test-first), with `CLAUDE_CONFIG_DIR` pointed at a synthetic fixture home via
`test/fixtures.ts` → `makeFixture()` so nothing touches the real `~/.claude`.

Look for:

- **Missing tests on new pure functions / collectors / config logic** (🚨 Critical when non-trivial).
- **Graceful-degradation paths untested (🚨 Critical):** every new `try/catch → EMPTY_*` guard
  MUST have a test proving that a missing/malformed native shape yields the neutral result
  instead of throwing. This is the single most important Mirante coverage rule.
- **Config fallback untested:** `loadConfig()` returning `DEFAULT_CONFIG` on bad JSON / schema
  mismatch; `saveConfig()` rejecting invalid input.
- **Pricing edge:** unknown model → `null` cost path covered.
- **Test quality:** uses `makeFixture()` / `CLAUDE_CONFIG_DIR` (never the real home), correct
  file location, meaningful assertions, error/edge paths, no hardcoded fragile fixtures.

**Second pass:** Re-read the full diff top to bottom. List every new/modified function, collector,
and module boundary you did not comment on. For each, ask: "Is there a test for the happy path
and at least one error/degradation path?" Only skip when you can state why coverage exists or is N/A.

**Comment format:**

```
<!-- mirante-review:tests -->
[🚨/⚠️/💡] — [Short title]
[Description of the gap or anti-pattern]
**Recommendation:** [Concrete test to add]
```

---

## Subagent 4: Regression & Hallucination Detection

**Marker:** `<!-- mirante-review:regression -->`

Review the diff for changes unrelated to the stated purpose, or that show signs of AI-generated
artifacts. Look for:

- Deleted code unrelated to the change (🚨 Critical).
- **Phantom / mis-resolved imports** (🚨 Critical) — including intra-repo imports **missing the
  explicit `.js` extension**, which break at runtime under NodeNext ESM.
- Function/method calls with wrong signatures (🚨 Critical).
- `TODO`/`FIXME` left in production code.
- Type assertions (`as any`, `!`) hiding compiler errors.
- Duplicate logic that already exists in `core/`, `collect/`, etc.
- **Weakened / accidental error swallowing** — but distinguish this from the _intentional_
  `try/catch → EMPTY_*` graceful-degradation pattern, which is correct by design. Flag only
  swallows that hide a real error or bypass a needed guard.
- Weakened test assertions and dead code never called.

**Second pass:** Re-read the full diff top to bottom. List every file or hunk you did not comment
on. For each, ask: "Does this contain unrelated deletions, phantom imports, duplicate logic, or
weakened assertions?" Only skip when you can state why none apply.

**Comment format:**

```
<!-- mirante-review:regression -->
[🚨/⚠️/💡] — [Short title]
Type: [unrelated-deletion | phantom-import | hallucination | duplicate | regression | dead-code]
[Specific description with quoted evidence from the diff]
**Recommendation:** [Exact fix]
```

---

## Step 3: Consolidation

After all 4 subagents complete, spawn one more subagent via Task/Agent tool to consolidate.

**PR mode:**

1. `gh api repos/{REPO}/pulls/{PR_NUMBER}/comments` — fetch all inline comments.
2. Filter to those whose body starts with `<!-- mirante-review:` and parse the type from the marker.
3. Fetch PR-level comments for the `<!-- mirante-review:requirements -->` summary.
4. Group by severity: 🔒 Security/Safety → 🚨 Critical → ⚡ Performance → ⚠️ Warning → 💡 Suggestion.
5. Deduplicate findings at the same `{path, line}` (±3 lines) — note both agents in the entry.
6. Collect one positive highlight per agent.
7. **Gap detection:** `gh pr diff {PR_NUMBER} --name-only` for the full changed-file list;
   cross-reference against commented paths. Any logic file with zero inline comments goes into
   `### 🔍 Arquivos sem comentário inline`. Omit config/lock files (`*.json`, `*.yaml`, lockfiles)
   and pure type-declaration files with no logic.
8. Post: `gh pr review {PR_NUMBER} --comment --body '...'`.

**Local mode:**

1. Take the four returned finding lists from Step 2.
   2–6. Group / dedup / collect highlights as above.
2. **Gap detection:** `git diff main...HEAD --name-only`, same cross-reference and omission rules.
3. **Print** the summary to the terminal (do not call `gh`).

**Summary format:**

```markdown
## 🤖 Mirante AI Review Summary

|                       |                                                                                  |
| --------------------- | -------------------------------------------------------------------------------- | ----------------------- |
| **Subagents invoked** | {N} of 4 (Requirements · Architecture & Invariants · Test Coverage · Regression) |
| **Mode**              | {PR #N                                                                           | Local (branch vs main)} |
| **Skill**             | `.claude/skills/pr-review/SKILL.md`                                              |
| **Docs loaded**       | `CLAUDE.md`, `docs/spec.md`, `docs/plans/…`{, Linear ABC-N if referenced}        |
| **Findings**          | {N} across {M} files                                                             |

---

### 🔒 Security/Safety ({N})

- [`path/file.ts:L42`] Finding title

### 🚨 Critical ({N})

### ⚡ Performance ({N})

### ⚠️ Warnings ({N})

### 💡 Suggestions ({N})

---

### 🔍 Arquivos sem comentário inline

- `path/to/file.ts` — sem findings de nenhum subagent (verificar manualmente ou re-rodar review direcionado)

_(Omit this section if all logic files received at least one comment.)_

---

### ✅ Highlights

- [One genuine positive highlight per agent]

---

> Veja os comentários inline para detalhes e recomendações. _(PR mode)_
```

If no findings across all agents: report `✅ Nenhum problema encontrado em todas as dimensões de review.`
but still include the metadata table.
