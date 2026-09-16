# plan_tracker state contract: pending-suffix invariant, skipped status, prescriptive rejection

**Goal:** make `plan_tracker` refuse snapshots that misrepresent progress (a `pending` task ahead of started or finished ones), give it a truthful terminal state for not-applicable work (`skipped`), and make every rejection tell the model exactly what is broken and how to fix it - so the widget stays accurate in gauntlet runs and in ad-hoc use (gatekeep-pr, check-delivery, custom prompts) alike.

Supersedes `doc/specs/2026-09-06-task-tracking-reliability.md`, "Scope and non-goals" section only - specifically its two decisions "No runtime prohibition of pending -> complete" and "Preserve the tracker API ... statuses" plus the "`plan-tracker.ts` behavior is unchanged" boundary. The parts of that spec this one relies on, restated so no hop is needed:

- **Positional identity.** Indices are the task identity; they are stable for the life of a list and never re-numbered on continuation. Repairs and re-audits reopen the *same* index (`complete|failed -> in_progress`) instead of appending a fix task. Conformance gaps carry a durable `Gn:` title prefix; a repeated `G1` reuses the existing `G1` index, only a genuinely new gap appends.
- **Completion backstop.** `phase_tracker` `complete` for `implement` or `verify` (when a gauntlet flow is entered and `flowGuards.enforce` is on) reads the latest *successful* `plan_tracker` snapshot on the branch, ignores errored results, and blocks only on `pending | in_progress` tasks; `failed` is terminal-negative and does not block.

## Context

`plan_tracker` (`extensions/plan-tracker.ts`) validates only index range and required params (`:141-237`). Any status may be written to any index in any order. Local session history (`~/.pi/agent/sessions`, 1373 sessions with `plan_tracker` updates, scanned 2026-09-16):

| Context | Sessions with updates | Snapshots with a `pending` ahead of a non-pending task | Rate |
|---|---|---|---|
| Gauntlet (phase_tracker present) | 1137 | 89 | 8% |
| Ad-hoc (gatekeep-pr, check-delivery, custom prompts) | 236 | 97 | 41% |
| pi-gauntlet repo itself | 129 | 0 | 0% |

Dominant patterns: sub-items appended behind a still-pending parent and completed out of order (`kkk>ookkkk`); a task started while an earlier one was never touched (`o>`); `failed` used to mean "not applicable" because no skipped status exists (99 `pending -> failed` transitions, several visibly "n/a"). Two consumer skills are incompatible with an ordering rule today: check-delivery marks a skipped stage `complete` with "skipped" in the title (`skills/check-delivery/SKILL.md:124-130`); gatekeep-pr inits all six stages then appends claim tasks *behind* the still-pending `review` and `consent menu` stages (`skills/gatekeep-pr/SKILL.md:86-88`), so every claim verdict would land after a pending index.

Transitions the contract must keep legal, from the same history: 1537 direct `pending -> complete` (at the first pending index); 83 `complete|failed -> in_progress` reopens (whole-diff CR repairs, re-audited `Gn` gaps); multiple simultaneous `in_progress` (parallel wave fan-out, `skills/subagent-driven-development/SKILL.md:174`). 3652 assistant messages issue 2+ `plan_tracker` calls in one message (typically `complete N` + `in_progress N+1`); the tool declares no `executionMode`, so source order holds only because `execute` happens to be synchronous.

## Design

### Statuses

`TaskStatus = pending | in_progress | complete | failed | skipped`.

| Status | Glyph | Meaning | Terminal | Counts as done |
|---|---|---|---|---|
| `pending` | dim `○` | not yet touched | no | no |
| `in_progress` | warning `→` | started; multiple allowed at once | no | no |
| `complete` | success `✓` | ran and passed / durably committed | yes | yes |
| `failed` | error `✗` | ran and did not pass | yes | no |
| `skipped` | dim `⊘` | deliberately not applicable in this run | yes | yes |

`skipped` uses the same glyph and color as `phase_tracker`'s skipped phase (`extensions/phase-tracker.ts:308`). Reopening any terminal status to `in_progress` stays legal.

### Snapshot grammar

A valid snapshot is `(in_progress | complete | failed | skipped)* pending*`: every `pending` task sits in the tail. Equivalent per-index rule: no `pending` index may precede a non-pending index. Nothing else is constrained - reopens, parallel fan-out, and `pending -> complete` at the first pending index all pass.

One pure function in `extensions/plan-tracker.ts`, `validateSnapshot(tasks: Task[]): number[]`, returns the indices of every `pending` task that has a non-pending task after it (empty array = valid). Both `update` and `init` call it on the candidate snapshot before committing state.

Consequence for parallel fan-out: a wave whose indices are `3,4,5` is started with three `update -> in_progress` calls, and because each call validates against the state the previous one committed, they must go in increasing index order (`3`, then `4`, then `5`); starting `5` first is rejected naming `3` and `4`. SDD already marks the whole wave before dispatch; this only fixes the order.

### Actions

| Action | Change |
|---|---|
| `init` | `tasks: Array<string \| { name: string, status: TaskStatus }>`. A string is shorthand for `{ name, status: "pending" }`; the two forms may be mixed. The normalized list is validated as one snapshot; on violation nothing changes. This is the bulk-recreation surface for a fresh session, for the brainstorming amendment re-init, and for truthful reconciliation of a legacy snapshot (see Rejection contract). Element shape (name present, status in the enum) is owned by the TypeBox schema. |
| `add` | unchanged: appends `pending` tasks at the tail, always valid. |
| `update` | `status` schema enum unchanged (keeps `pending` so the tool, not the harness, owns the message). `execute` rejects `status: "pending"` with the prescriptive text below; otherwise the candidate snapshot is validated and rejected on violation; on any rejection nothing changes. |
| `status`, `clear` | unchanged. |
| tool registration | `executionMode: "sequential"`, matching `phase_tracker` (`extensions/phase-tracker.ts:858-866`). Pi serializes the *entire* assistant-message tool batch when any call in it targets a sequential tool (`pi-agent-core` `agent-loop.js:287-288`) - the same trade-off `phase_tracker` already makes; a pi-cohort `tasks: []` fan-out inside one `subagent` call is unaffected. Same-message `plan_tracker` siblings therefore run in source order and each validates against the previous sibling's committed state. |
| tool description | rewritten to name all five statuses with `skipped` = not applicable, the one-sentence pending-suffix rule, "update never sets pending; init/add do", and the `init` object form - ad-hoc callers have no skill text, so the description is their only contract. |

### Rejection contract

Rejections keep the existing shape: `content` text starts with `Error:`, `details.error` is a short code (today's pattern is `index 3 out of range`; `renderResult` prints `Error: <details.error>` so a multi-line value would render twice), `details.tasks` is the unchanged pre-call snapshot. Widget reconstruction (`extensions/plan-tracker.ts:99-112`) and both `phase_tracker` consumers (`extensions/phase-tracker.ts:737-744`, `:994-1007`) already ignore errored results, so a rejected call is invisible to them.

Three rejection texts. Each names what is broken, lists **every** offending index with its name, states the rule in one sentence, gives the legal fixes, forbids the dishonest ones, and renders the current snapshot so the model needs no `status` call to recover.

`update` ordering violation (`details.error: "pending-suffix violation: 3,4"`). Example state `kkkoo o` -> `update 5 -> complete`:

```
Error: cannot set task 5 "verify claims" to complete: pending tasks precede it: 3 "provision worktree", 4 "review".
Rule: pending tasks must trail every started or finished task.
Fix first, then retry: update each listed task to in_progress (working on it now), complete, failed, or skipped (not applicable in this run); or, if the list order itself is wrong, re-init with {name, status}[] keeping every task and its true status so the untouched ones trail.
Never clear, drop tasks, or record a status the work has not actually reached.
Current: 0 gather=complete, 1 resolve evidence=complete, 2 claim-check=complete, 3 provision worktree=pending, 4 review=pending, 5 verify claims=pending
```

`update -> pending` (`details.error: "update cannot set pending"`):

```
Error: cannot set task 2 "claim-check" to pending: update never sets pending; a task is pending only from init/add.
To redo it, update it to in_progress. To recreate the whole list, re-init with {name, status}[].
Current: <snapshot as above>
```

`init` ordering violation (`details.error: "pending-suffix violation: 1"`, no `Current:` line - nothing was committed):

```
Error: cannot init: pending tasks precede started or finished ones: 1 "b".
Rule: pending tasks must trail every started or finished task.
Reorder the list or restate those statuses truthfully, then retry.
Proposed: 0 a=complete, 1 b=pending, 2 c=complete
```

**Legacy snapshots.** Old sessions are never re-validated on replay, but the first `update` in a resumed legacy-invalid session validates a candidate that still contains the old violation and is rejected listing those offenders. When several offenders exist, single-index updates may not be able to reach a valid state (`[pending, pending, complete]`: fixing either pending alone still leaves the other) - the re-init fix in the text is the sanctioned atomic repair. Re-init is a *bypass* only when it drops tasks or asserts statuses the work has not reached; a validated object-form re-init that keeps every task and its true status is reconciliation, and `validateSnapshot` runs on it anyway.

### Rendering

- Done count = `complete + skipped`, labelled `done`: widget footer `(N/M)`; `formatStatus` header `Plan: N/M done (x in progress, y pending, z failed, s skipped)` (zero-count groups omitted, as today); `renderResult` for `update`/`status`: `Updated (N/M done, z failed, s skipped)` / `N/M done, z failed, s skipped` with the same omission rule.
- Current-task name: first `in_progress`, else first `pending` (unchanged - `skipped` is never current).
- `formatWidget`, `formatStatus`, and `renderResult` all gain the `skipped` glyph case; today's `default -> ○` branch would otherwise render skipped as pending.

### phase_tracker (minimal touch)

`phase_tracker` is working and gauntlet-only; it already has a `skipped` phase status and `skip` action. Exactly one predicate changes: implement auto-complete at `extensions/phase-tracker.ts:420` becomes `tasks.every(t => t.status === "complete" || t.status === "skipped")`. `failed` still blocks auto-complete. The completion backstop (`:1009-1011`) already treats only `pending | in_progress` as unfinished, so `skipped` passes it with no edit. Errored-result filtering is untouched.

### Consumer skill wording

Implementation surface, not doc impact. Each edit is the smallest unit that becomes false under the new contract:

| Skill | Edit |
|---|---|
| `skills/check-delivery/SKILL.md:124-130` | skipped stage 2 -> `skipped` (not `complete` with a renamed title). AC tasks follow the four stage tasks; state that AC verdicts are recorded while stage 3 is `in_progress` (already the last stage, so no pending stage precedes an AC). |
| `skills/gatekeep-pr/SKILL.md:86-92` | List lifecycle replaces "init six stages, append claims": `init` `gather`, `provision worktree`, `resolve evidence`, `claim-check`; during claim-check (`in_progress`) `add` one task per material claim and record each verdict; once every claim is terminal and claim-check is closed, `add` `review` and `consent menu` and proceed. Legal trace: `kkk>` -> add claims `kkk>ooo` -> `kkk>kxk` -> `kkkkkxk` -> add `review`, `consent menu` -> `kkkkkxk>o` -> `kkkkkxkk>`. No `skipped` mapping is added: worktree provisioning is required on every path (`:104-127`), and no stage is genuinely not applicable. |
| `skills/subagent-driven-development/SKILL.md:169-185` | add `skipped` to the lifecycle vocabulary; wave fan-out marks indices `in_progress` in increasing order; note the runtime rejects a start/finish while an earlier index is still `pending` and that the fix is to record the earlier task's true state. |
| `skills/brainstorming/SKILL.md:357` | amendment path: anchor-changed completed tasks are not set "back to `pending`"; re-`init` with `{name, status}[]`: preserved tasks keep order and statuses, reopened tasks `in_progress` in place, every still-`pending` task (including newly added ones) trails the non-pending ones. Removed tasks are the only deletions. |
| `skills/verification-before-completion/reference/conformance-check.md` (gap-task synchronization step) | reopened/started `Gn` indices are marked `in_progress` in increasing index order. |
| `skills/writing-plans/SKILL.md` | only if it enumerates task statuses: add `skipped`. |

### Out of scope

- Multi-index update action; hierarchical or sub-task model; a richer multi-task widget (the SDD "widget caveat" stays as documented).
- Runtime policing of `init`/`add` provenance, or of `clear`. The rejection text forbids the dishonest uses; enforcement stays skill-level.
- Re-validating snapshots already persisted in old sessions on replay.
- Any `piGauntlet.*` settings key. The invariant is fixed.
- `phase_tracker` changes beyond the single auto-complete predicate.

## Error and edge cases

| Case | Behavior |
|---|---|
| `update N -> pending` | rejected in `execute` with the `update cannot set pending` text; state unchanged |
| `update N -> any` with `pending` at some index `< N` | rejected, every such index listed, state unchanged |
| `update` at index 0 or at the first `pending` index | valid |
| terminal -> `in_progress` reopen | valid |
| `pending -> failed` / `pending -> skipped` at the first pending index | valid (direct jumps stay legal, as `pending -> complete` does) |
| wave fan-out `in_progress` in increasing index order | valid; out of order -> rejected naming the earlier pending indices |
| `init` with a `pending` before a non-pending (after string normalization) | rejected as a whole; state unchanged (still "no plan" if none) |
| `init` element with unknown status / missing name | TypeBox schema error (generic harness text; the only case where the message is not tool-owned - it is a malformed call, not a state question) |
| `add` at any time | valid |
| rejected call inside a same-message batch | sequential mode: later siblings validate against the unchanged state |
| errored result on session resume | skipped by widget replay and by phase_tracker, as today |
| resumed legacy-invalid snapshot | first `update` rejected listing the legacy offenders; repaired by the standard fixes or a truthful object-form re-init |
| all tasks `skipped` | implement auto-completes; widget shows `(M/M)` |

## Testing

`npm test` (`scripts/ci.mjs:219-236`) runs `extensions/plan-tracker.test.ts` and `extensions/phase-tracker.test.ts` under `node --test` with `extensions/test-support/pi-stubs.mjs`, which replaces `@sinclair/typebox` and `StringEnum` with inert schema-shaped objects; tests call `tool.execute` directly, so TypeBox never runs. Therefore every rejection asserted below is one `execute` owns; schema shape is asserted structurally on the registered `parameters` object (the stub records `kind`/`args`), as the existing `executionMode` test does for `phase_tracker`.

Add:

- `validateSnapshot` table: valid (`kkkoo`, `kk>>oo`, `kk>kk`, `x>o`, all-pending, all-skipped) and invalid (`okoo`, `kkk>ookkkk`, `o>`, `ook`) with expected offending indices.
- `update` ordering rejection: state unchanged, `details.error === "pending-suffix violation: <indices>"`, text contains every offending index and name, the rule line, the fix line including re-init, the prohibition, and the `Current:` line.
- `update -> pending` rejection: state unchanged, `details.error === "update cannot set pending"`, text names reopen and re-init.
- `init`: strings-only (all pending); object form valid; mixed form normalizes; object form rejected (no `Current:` line, `Proposed:` line present, state unchanged).
- Fan-out order: `init` 3 pending; `update 0,1,2 -> in_progress` in order all succeed; from fresh, `update 2 -> in_progress` first is rejected listing `0,1`.
- `skipped` round-trip: update, replay from branch, widget glyph `⊘`, `(N/M)` counts complete+skipped, `, s skipped` suffix in `formatStatus` and `renderResult`, never selected as current.
- Reopen `complete -> in_progress` and `failed -> in_progress` accepted.
- Legacy reconciliation: seed the branch fixture with a `[pending, pending, complete]` snapshot; `update 0 -> complete` is rejected listing `1`; object-form `init` `[complete, skipped, complete]` succeeds.
- Registration: `executionMode === "sequential"`; `parameters` `tasks` is an `Array` of a `Union` of `String` and an `Object`; description mentions `skipped` and `pending`-suffix rule.
- Existing test `renderResult status path shows ✗ for failed` (`extensions/plan-tracker.test.ts:141-148`) currently fails index 1 while 0 is pending - rewrite to fail index 0 (or expect the rejection), and update its `0/2 complete` assertion to the `done` wording.
- phase_tracker: a `[complete, skipped]` snapshot auto-completes an in-progress implement; `[complete, failed]` does not; an errored plan result still does not.

No integration test: external consumers assert only the tool name (`customer-ops/tests/test_gauntlet_integration.py:48`, `tests/gauntlet-adapter.test.js:467`).

## Documentation impact
- Feature / user-facing docs introduced: none
- Materially amended existing docs: `doc/configuration.md` (`### plan-tracker` paragraph: statuses incl. `⊘ skipped`, pending-suffix rule, `init` object form, `update` cannot set `pending`, `executionMode: sequential` and its batch-wide effect; `### phase-tracker` sentence on implement auto-complete: "complete or skipped"); `CHANGELOG.md` `## Unreleased`; `doc/specs/2026-09-06-task-tracking-reliability.md` (supersession banner)
- Derived / memory docs invalidated: none

## Open questions

None.
