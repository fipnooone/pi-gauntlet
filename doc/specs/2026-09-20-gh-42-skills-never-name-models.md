# Skills never name a provider or model; skill edits follow writing-skills

**Ticket:** #42 (GitHub Issues, jjuraszek/pi-gauntlet)
**Related:** #29 (escalation model, shipped v5.4.0 - contract preserved), #43 (gatekeep-pr split burn-down, filed from this brainstorm)
**Date:** 2026-09-20
**Worktree:** `.worktrees/gh-42-no-model-in-skills`

**Goal:** Remove every skill-authored provider/model choice from the package, state the single dispatch-model rule once, enforce the literal ban in CI, and make `/skill:writing-skills` - extended with four authoring rules (imperative voice, low conditionality, minimal diff, oversized-skill extraction) - binding for every skill, persona, and prompt-template edit in this repo and in consumer repos.

## 1. Problem

`skills/subagent-driven-development/SKILL.md` `## Model Selection` (`:114-137`) tells the orchestrator to pick a model tier per task and shows `model: "anthropic/claude-haiku-4"` as the "cheap tier" example. An orchestrator following it overrides `subagents.agentOverrides.<agent>.model` pins with a guessed model on a provider the operator may not have. The AC1 scan (section 7) returns exactly this one hit today (exit 0); `agents/`, `extensions/`, `README.md`, `AGENTS*.md`, `scripts/`, `src/` are clean. Historical specs and telemetry YAML name models as context; they are out of the ban's scope.

Separately, nothing states how skill/prompt files must be written so smaller models follow them. Verified against `AGENTS.core.md` (48 lines) and `skills/writing-skills/SKILL.md` (432 lines): "follow writing-skills for edits" is present (Iron Law `:197`, "Applies to new skills AND edits"); "minimal change" is present (GREEN); "extract to `reference/` or a sibling md" is present. "Imperative language mandatory" and "low/no conditionality" are stated nowhere. "Refactor an oversized skill as part of the change" is partial: the >500-line items (`:164`, `:379`, `:416`) target the skill being authored, not an existing oversized skill a change touches. `AGENTS.core.md` has no skill-authoring rule. No CI check covers provider literals or skill size. `gatekeep-pr/SKILL.md` is 589 lines; its split is #43, not this change.

Premise correction recorded against #42's Idea text ("otherwise the call omits `model`"): `extensions/lib/gauntlet-settings.ts:98-101` (`resolveEscalationLoop`) returns the main loop's model string when `implModel` is unset (and `undefined` when the session has no model, `:107-114`), and the escalated fix round passes that string explicitly to bypass the implementer pin (#29 shipped comment). Section 2 covers it as a runtime-resolved value, not an omission.

## 2. The rule (stated once)

Skill text never authors a provider or model name, never tiers tasks by cost, and never trades a pinned model for a cheaper or stronger one. A dispatch's `model:` is either omitted or carries a string resolved at runtime from one of three provenances:

1. a `gauntlet_setting` result for a role key - `closureReview.model`, `escalationLoop.implModel`, `specCouncil.members[]` (each element is a model string), `specCouncil.chair`;
2. an explicit user instruction naming a model for that dispatch;
3. the main loop's own string, read from `$PI_PROVIDER`/`$PI_MODEL` with the bash tool, used only where a skill must bypass a persona's frontmatter `thinking` pin for cost (`doc/personas.md:35` documents this path: `shape-ticket` `:low` roasts, brainstorming's amendment review) or must pass an explicit fallback after a configured model is unreachable (section 3.9).

Omitting `model:` lets `subagents.agentOverrides.<agent>.model` apply, else the child inherits the main loop. Per key: `closureReview.model` or `specCouncil.chair` `undefined` -> omit; `implModel` string -> pass verbatim; `implModel` `undefined` -> stop note (the existing SDD `:93` behavior; never omit, because omission would reuse the implementer pin). Suffix edits (`:low`) apply only to a runtime-resolved string, never to a name the skill wrote.

## 3. Components

### 3.1 `skills/subagent-driven-development/SKILL.md`

- Delete `## Model Selection` (`:114-137`: tier table, the `anthropic/claude-haiku-4` snippet, "When in doubt, default. Don't downgrade reviewers"). The conformance row's `gauntlet_setting` note survives in `## Dispatch` (`:157-159`).
- Add `## Model` (5-8 lines) stating section 2 in imperative voice: the three provenances, the per-key `undefined` handling, the negative form (never a skill-picked name; never override a pin).
- Line 24 ("Smaller models can handle simple subtasks") is reworded to not imply the skill chooses: the pin or the operator chooses.
- Existing sketches stay unchanged: Fix-Loop `:93` (`implModel undefined -> stop note`), `## Dispatch` `:139-165` (the `// implementer` sketch at `:145` has no `model:`; the escalated-fix sketch at `:148` carries `model: "<implModel>"` by design).
- The reviewer-pin advice moves to `doc/configuration.md` (3.3).

### 3.2 Provider/model literal lint

Follows the repo's testable-lint pattern (`scripts/stage-skill-lint.mjs` + `scripts/stage-skill-lint.test.mjs`, both invoked from `scripts/ci.mjs`):

- `scripts/model-literal-lint.mjs` exports `lintModelLiterals(root) -> { path, line, text }[]`; regex, scope, exclusions are exported constants.
- Regex, case-insensitive: AC1's alternation verbatim as the floor - `anthropic/|openai/|github-copilot/|google/|haiku|sonnet|opus|gpt-` - plus additive families `xai/|mistral/|gemini|grok`. No word boundaries (AC1 matches `haiku4`, `gpt-example`; the lint must too).
- Scope: every file under `skills/`, `agents/`, `extensions/` (any extension, so `extensions/test-support/pi-stubs.mjs` is covered), plus `README.md`, `AGENTS.md`, `AGENTS.core.md`.
- Exclusion (the only one): `skills/writing-skills/reference/**`. Test fixtures already use neutral strings (`p/main`, `x/y`) and stay in scope.
- `scripts/model-literal-lint.test.mjs`: `mkdtempSync` fixtures - `model: "anthropic/x"` in `skills/foo/SKILL.md` -> one hit; the same under `skills/writing-skills/reference/` -> none; `haiku4` in `extensions/x.mjs` -> one hit (substring, `.mjs`); neutral `p/main` in `extensions/x.test.ts` -> none.
- `scripts/ci.mjs`: runs the test file, then `lintModelLiterals(root)` against the repo; on hits prints one `path:line: <text>` per hit and `Skills never name a provider or model - see doc/configuration.md "Dispatch model precedence".`, then fails.
- Incidental English words the floor flags (`haiku`, `sonnet`, `opus`) are reworded in prose; the exclusion list does not grow.

### 3.3 `doc/configuration.md`

- New `### Dispatch model precedence` paragraph beside the `gauntlet_setting` section: section 2's three provenances; the order for an omitted `model:` (`agentOverrides` pin, then main loop); skill text never supplies a name; the `implModel` exception in one sentence; the main-loop-string path in one sentence citing `doc/personas.md`.
- `:17` and `:43` reworded from "inherits the parent's model" to "omits `model:` (the `agentOverrides` pin applies, else the main loop)"; `:17`'s "retries once inherited" becomes "retries once with the main loop's own string passed explicitly" (3.9).
- Relocated reviewer advice: "Pin review personas (`code-reviewer`, `spec-reviewer`, `conformance-reviewer`) at least as capable as `implementer`; false negatives in review cost more than the model does."
- `doc/personas.md:9,35,58` are read for consistency with the paragraph; `:35` already describes provenance 3 and stays.

### 3.4 `skills/writing-skills/SKILL.md`

- **Description** (frontmatter) rewritten as trigger + symptoms: "Use when creating, editing, or refactoring any SKILL.md, its reference/ files, an agent persona (`agents/*.md`, `.pi/agents/*.md`), or a prompt template - including one-line edits - or when such a file exceeds 500 lines, gains if/else branching, or drifts from imperative voice." `name` + `description` <= 1024 chars; frontmatter lint passes.
- **New `## Authoring rules`** section (about 15 lines), imperative:
  - Imperative voice: instructions are commands. No "should", "consider", "you may want to", "it is recommended".
  - Low conditionality: one path per step. Branch only on a runtime fact the agent can observe (a tool result, a file's presence, a settings value), never on the reader's judgment. Two branches are the ceiling; a third goes to a table or a `reference/` file.
  - Minimal diff: a rule change touches the sentence that owns the rule, not the section. Never restate a rule in a second place; link the owner.
  - Oversized skill: a change touching a SKILL.md over 500 lines extracts the concern it touches (or, if that concern is small, the largest self-contained `##` section) into `reference/<topic>.md` or a sibling md, in the same change, before it lands. The body keeps a one-line "read X now" pointer at the step that needs it.
  - Binding scope: the four rules bind the lines an edit adds or changes in any skill, persona, or prompt-template file; pre-existing text is not rewritten (minimal diff). Where `reference/anthropic-best-practices.md` differs (its "Conditional workflow pattern"), this section wins.
- **Iron Law** (`:197-206`, the owner of test scope) gains one sentence: the RED-GREEN-REFACTOR baseline binds skill bodies - new skills and behavior-changing edits to SKILL.md or reference files; a wording-only edit to a skill, persona, or prompt template is verified by reading the changed lines back against `## Authoring rules`. The red flag `:412` ("Edited a skill without re-running the relevant baseline") gets "behavior-changing" inserted so it agrees.
- Existing >500-line items (`:379` checklist, `:416` red flag) gain "or a skill this change touches".
- Net edit: one new section, one description, one Iron Law sentence, three touched lines.

### 3.5 `AGENTS.core.md` and the `v6` stamp

One sentence appended to "Code & Documentation Discipline": `- **Skill, persona, and prompt edits follow \`/skill:writing-skills\`** - any size, including one-line rewordings; its authoring rules (imperative voice, low conditionality, minimal diff, oversized-skill extraction) bind the edit.`

`scripts/check-agents-core.mjs --fix` rewrites only the body between the marker comments and never bumps the stamp (`:16-19`, `:39-43`; the v4->v5 bump in `870e0c2` edited the markers by hand). So: edit both `<!-- agents-core:begin v5 ... -->` and `<!-- agents-core:end v5 -->` lines in `AGENTS.md` to `v6`, then run `--fix`, then `node scripts/check-agents-core.mjs` verifies body equality. The same two manual marker edits happen in each sibling (3.8).

### 3.6 `AGENTS.md` (this repo)

"Package rules" gains one bullet routing to writing-skills' `## Authoring rules` and to the CI literal ban. "Testing" sentence lists `model-literal-lint`.

### 3.7 `CHANGELOG.md`

`## Unreleased` entry naming: the Model Selection removal, the literal lint, the precedence paragraph, writing-skills' widened trigger and authoring rules, the two skill dispatch clarifications (3.9), the AGENTS core `v6` sentence.

### 3.8 Sibling sync - the plan's final task, post-merge

`/skill:finishing-a-development-branch` has no post-merge hook (ship completes at `:326` once the chosen option runs) and generic skills carry no repo-specific steps, so the carrier is this change's plan: its final task runs after the squash lands on `main` and before `phase_tracker` marks ship complete. For each of `~/repos/pi-quiver`, `~/repos/pi-cohort`, `~/repos/pi-condense`: `git status --porcelain` empty on `main` (dirty -> stop and report, never stash); copy `AGENTS.core.md` from this repo; edit both marker lines to `v6`; `node scripts/check-agents-core.mjs --fix`; `node scripts/check-agents-core.mjs` passes; commit `Sync AGENTS core v6 (writing-skills binding)` on `main`; push. Sibling CHANGELOGs untouched. So future core bumps recur the same way, `.pi/gauntlet-overrides.md` "Release (any skill that ships)" gains one sentence: an `AGENTS.core.md` change syncs the three siblings' `main` before ship completes.

### 3.9 Two dispatch clarifications in shipped skills

- `skills/shape-ticket/SKILL.md:179`: "an unconfigured chair is dispatched as the parent's model with `:low` appended" already is provenance 3; reword to say the string is read from `$PI_PROVIDER`/`$PI_MODEL` (the amendment-surface bash snippet), so no reader takes "the parent's model" as a name to type.
- `skills/verification-before-completion/reference/conformance-check.md:48-49`: "retry once with the inherited model" becomes "retry once passing the main loop's own string explicitly (provenance 3; the phase-tracker guard blocks an omitted `model:` when `closureReview.model` is set and warns on the difference)". `doc/configuration.md:17` matches (3.3).
- `skills/brainstorming/reference/amendment-surface.md:45-54` already reads the string from env and stays.

## 4. Data flow

No runtime code changes. `gauntlet-settings.ts` already resolves the model keys; the skill and docs describe what it does. The lint runs inside `npm test` locally and in `.github/workflows/test.yml` on push and PR.

## 5. Errors and edge cases

- Lint hit on an incidental English word: reword the prose; the exclusion stays single.
- `gauntlet_setting` unavailable: existing skills already stop and report; `## Model` adds nothing.
- `implModel` `undefined` (no session model): stop note, unchanged.
- Persona edits in a consumer repo: the widened description is the only hook (this repo's AGENTS.md is not in their context); the AGENTS core sentence reaches repos carrying the shared block.
- Sibling with drift after copy: `--fix` resolves it; a sibling with uncommitted changes blocks the sync task - report, do not stash.
- `#43` is the only known oversized skill; the authoring rule cites no ticket (skills stay generic).

## 6. Tests

- `scripts/model-literal-lint.test.mjs` (3.2 fixtures) passes; the lint fails on the pre-change SDD line 133 and passes after; AC1 scan exits 1.
- `node scripts/check-agents-core.mjs` passes here and in each sibling after 3.8; `rg -c 'agents-core:(begin|end) v6' AGENTS.md` is 2 in all four repos.
- Frontmatter lint passes on the rewritten description.
- writing-skills baseline (Iron Law), two RED/GREEN pairs with fresh `worker` context (repo `AGENTS.md` in context, `/skill:writing-skills` loaded in GREEN only), transcript paths recorded in the plan:
  - Prompt A: "Edit `skills/subagent-driven-development/SKILL.md` to recommend a cheap model for rename tasks." Pass: the worker declines to add a provider/model name and cites `## Model` or the precedence paragraph.
  - Prompt B: "Add a note to `agents/implementer.md` that it might be worth considering running tests twice if they look flaky." Pass: the added lines are imperative (no "should"/"consider"/"might"), carry no reader-judgment branch, touch only the sentence that owns the rule, and the worker names `## Authoring rules` as the reason.
- `npm test` passes end to end.

## 7. Acceptance criteria (from #42, plus this brainstorm)

- [ ] `rg -n -i 'anthropic/|openai/|github-copilot/|google/|haiku|sonnet|opus|gpt-' skills agents extensions --glob '!skills/writing-skills/reference/**'` exits 1 from the repo root.
- [ ] `skills/subagent-driven-development/SKILL.md` has no `## Model Selection`, no tier table, no provider/model name; the `// implementer` sketch in `## Dispatch` has no `model:` key (the escalated-fix sketch keeps `model: "<implModel>"`); `## Model` states the rule once.
- [ ] `doc/configuration.md` has `### Dispatch model precedence` with the three provenances, the `implModel` exception, and the reviewer-pin sentence; `:17` and `:43` agree with it.
- [ ] `scripts/model-literal-lint.mjs` + test exist; `scripts/ci.mjs` runs both.
- [ ] `skills/writing-skills/SKILL.md`: description names skills, reference files, personas, prompt templates, one-line edits, and the three symptoms; `## Authoring rules` holds the four rules and the binding-scope sentence; the Iron Law owns the baseline scope; the >500-line items say "or a skill this change touches".
- [ ] `AGENTS.core.md` carries the sentence; `AGENTS.md` markers read `v6` and the block is regenerated; Package rules and Testing updated.
- [ ] `shape-ticket/SKILL.md:179` and `conformance-check.md:48-49` reworded per 3.9.
- [ ] `CHANGELOG.md` `## Unreleased` names the change; `.pi/gauntlet-overrides.md` Release section carries the sibling-sync sentence.
- [ ] Post-merge plan task: pi-quiver, pi-cohort, pi-condense `main` each carry the `v6` markers and matching core body, committed and pushed.

## 8. Out of scope

- Splitting `gatekeep-pr` (589 lines) - #43.
- Any CI check on skill size, imperative voice, or conditionality (Q3 decision: prose rules only).
- Changes to pi-cohort's call-site `model` override contract or to `check-agents-core.mjs`.
- Removing model names from historical specs, telemetry YAML, or `skills/writing-skills/reference/**`.
- Sibling CHANGELOG entries; editing `finishing-a-development-branch`.

## Documentation impact
- Feature / user-facing docs introduced: none
- Materially amended existing docs: `doc/configuration.md` (dispatch-model precedence, `implModel` exception, retry wording, reviewer-pin guidance); `AGENTS.core.md` (one sentence, synced to pi-quiver, pi-cohort, pi-condense at `v6`); `AGENTS.md` (Package rules bullet, Testing sentence, `v6` markers); `.pi/gauntlet-overrides.md` (Release sentence); `CHANGELOG.md`
- Derived / memory docs invalidated: none - `README.md` does not describe model selection; `doc/personas.md:35` already matches provenance 3

Per `reference/documentation-impact.md`; the five skill/reference files touched are implementation surface, not doc-impact entries.

## Open questions

None blocking. Decision surfaced for the gate: the council chair recommended removing the main-loop-string dispatches (`amendment-surface`, `shape-ticket` chair) so pins always win; this spec instead legitimizes them as provenance 3 because removing them changes two shipped skills' cost profile (persona `thinking: xhigh` pins would apply to cheap roasts and amend reviews) and #29 already established the main-loop bypass as legitimate. Say "remove provenance 3" at the gate to flip it.
