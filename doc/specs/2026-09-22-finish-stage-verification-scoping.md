# Finish-stage verification scoping

> **Superseded by:** [doc/specs/2026-09-22-finish-verification-dirty-tree-hotfix.md](./2026-09-22-finish-verification-dirty-tree-hotfix.md) - Step 1 skip predicate and its test coverage only

**Goal:** Run the full verification set once before a PR opens and twice before a squash lands (the post-squash run is kept deliberately) instead of two and three times, make PR the first landing option with a draft-PR sibling, and define the plan header's `**Verification:**` set as the affected services' commands in multi-service repos - all as prose edits plus two CI literals.

**Supersedes:** [doc/specs/2026-08-12-execution-fidelity-hardening.md](./2026-08-12-execution-fidelity-hardening.md), the "ship-time re-run accepted, out of scope" note only (its Out of scope bullet on `finishing-a-development-branch` and the closing sentence of the tier-boundary paragraph). The once-at-verify tiering rule itself stands.

## Problem

The plan header's `**Verification:**` set runs three times before a squash lands and twice before a PR opens:

| Run | Owner | Citation |
|---|---|---|
| 1 | SDD "Parent full verification" after the last wave | `skills/subagent-driven-development/SKILL.md:223` |
| 2 | finishing Step 1 "Hard verification gate ... No exceptions", on the same unchanged tree, because SDD step 5 invokes finishing immediately (`SDD:227`) | `skills/finishing-a-development-branch/SKILL.md:33-37` |
| 3 | finishing Option 1 post-squash re-verify (squash only) | `finishing:202,207` |

Run 2 is a pure duplicate in the gated flow. The 2026-08-12 spec noticed it and left it "out of scope" without a rationale (the `finishing-a-development-branch` Out of scope bullet and the tier-boundary paragraph's last sentence); this spec removes it.

Three smaller gaps ride along:

- The landing menu lists squash first (`finishing:152-153`) although the documented flow is finishing -> gatekeep-pr -> check-delivery (`README.md:43`), i.e. PR-shaped.
- No draft-PR option exists; `gh pr create` at `finishing:224` never takes `--draft`.
- In a repo with per-service verification commands, nothing says what the header's `**Verification:**` set contains. Finishing improvises with "run each affected service's target" (`finishing:37`) and "<Step 1 command for the service(s) touched>" (`finishing:202`) - prose from the import commit, never ratified.

Corrected premise (accepted in the questionary): the scoped test set is already declared, not inferred. Every plan task carries file-anchored `**Tests:**` commands (`skills/writing-plans/reference/plan-contract.md:22-30`), wave gates run their union, and plan-check rejects a task segment equal to a header segment (`plan-contract.md:30`). No mechanism derives tests from `git diff`, and this spec adds none.

## Acceptance criteria

none - no ticket

## Design

### Decision summary

| # | Decision | Chosen |
|---|---|---|
| 1 | Where the full set runs | Stays at SDD verify (`SDD:223`); finishing loses its duplicate. SDD's verification steps untouched. |
| 2 | Finishing Step 1 | One option-agnostic skip rule keyed to a tree check; otherwise runs the header set once. |
| 3 | Landing menu | 1 Push + PR, 2 Push + draft PR, 3 Squash-merge, 4 Keep, 5 Discard. Detached HEAD: 1 Push + PR, 2 Push + draft PR, 3 Keep, 4 Discard. |
| 4 | Draft PR | Own menu row and own `####` block, body defined by reference to the PR block plus `--draft`. No new human gate. |
| 5 | Multi-service scoping | One sentence in the `**Verification:**` header template at `skills/writing-plans/SKILL.md:157`. No overrides schema. |
| 6 | Post-squash run | Kept, mandatory, phrased as the Step 1 set. |

### Change 1: `skills/finishing-a-development-branch/SKILL.md`

**Step 1: Verify Tests.** Keep the hard-gate paragraph and the pre-existing-findings caveat; change "No exceptions." (`:35`) to "The skip rule below is the only exception." Replace the "Run the project's canonical verification target ..." paragraph (`:37`) with:

- The command is the plan header's `**Verification:**` set, run as `(cd "$WORKTREE" && <command>)`. With no plan in this session, use the verification command(s) of the affected services from the overrides file or `AGENTS.md`.
- Skip rule, stated once, before the menu, never naming an option: *Skip the run when this set passed in the verify phase of this session and the tree is unchanged since apart from the telemetry record: `git -C "$WORKTREE" diff --quiet <commit the run passed on> HEAD -- . ':!<telemetry.dir>'` exits 0 and no edit or write landed outside `<telemetry.dir>` since. Otherwise run it once. Unsure means run.* The telemetry recorder commits `telemetry: <spec>` at `complete verify` and at finishing's own `start ship` (`extensions/telemetry.ts:235-267`), so the carve-out is what makes the condition hold in the SDD flow; on manual entry without a verify-phase pass the gate fires as today.
- Delete "Cross-cutting changes: run each affected service's target; don't skip any." - the header set (plan path) and the fallback bullet (no-plan path) both carry the affected-services rule now.
- The failure block's "Cannot proceed with Options 1-3 until tests pass." (`:51`) becomes "Cannot proceed until tests pass." so no future menu row edits Step 1.

**Step 2: Detect Environment** (`:62`). "reduced 3-option menu" -> "reduced 4-option menu"; "standard 4 options" -> "standard 5 options".

**Step 4 menu.** Normal (`:147-158`, "present exactly these 5 options"):

```
1. Push and create a Pull Request
2. Push and create a draft Pull Request
3. Squash-merge to <base-branch> (no PR, no surviving branch)
4. Keep the branch as-is (I'll handle it later)
5. Discard this work
```

Detached HEAD (`:160-170`, "present exactly these 4 options"): 1 Push as new branch and create a Pull Request, 2 Push as new branch and create a draft Pull Request, 3 Keep as-is, 4 Discard. Add one sentence under the detached menu: "Rows 1-2 run the Option 1/2 blocks; row 3 runs the Keep block and row 4 the Discard block." (the numbers differ from the block headings, as they do today).

**Step 5 blocks**, in this order and with these exact headings:

- `#### Strip the plan, keep the record (Options 1-3)` (`:176`) - text unchanged apart from the parenthetical and the lead sentence's `before either landing path` -> `before any landing path` (three landing options now).
- `#### Option 1: Push and Create PR` - today's Option 2 block (`:213-242`) verbatim, including the `## Acceptance criteria` PR-body rule and "Do NOT clean up worktree". Its sentence "Option 1's squash commit message is unchanged." (`:234`) becomes "Option 3's ...".
- `#### Option 2: Push and Create Draft PR` - four sentences: run the strip-and-salvage block above first (plan stripped, telemetry record kept); then follow Option 1 exactly, adding `--draft` to `gh pr create`; the PR body is unchanged; do not clean up the worktree. No copied bash.
- `#### Option 3: Squash-merge to base` - today's Option 1 block (`:193-211`) verbatim except the post-squash line becomes `(cd "$PRIMARY" && <the Step 1 set>)`, so the no-plan fallback carries. The "not optional" sentence stays.
- `#### Option 4: Keep As-Is` (`:244`), `#### Option 5: Discard` (`:250`) - renumbered, text unchanged.

**Every other option-number and option-count reference** is updated; the full list from `rg -n 'Option|[0-9] options|[0-9]-option' skills/finishing-a-development-branch/SKILL.md` and its new text:

| Line | Today | New |
|---|---|---|
| `:268` | "**Only runs for Options 1 and 4.** Options 2 and 3 always preserve the worktree." | "**Only runs for the Squash-merge and Discard options (3 and 5).** The PR, draft PR, and Keep options always preserve the worktree." |
| `:285-291` | option matrix rows | renumbered; a draft-PR row identical to the PR row is added |
| `:298` | "Always verify tests before offering options" | "Verify, or apply the Step 1 skip rule, before offering options" |
| `:302`, `:360` | "Present exactly 4 ... options (or 3 for detached HEAD)" | "5 ... (or 4 ...)" |
| `:304` | "Cleaning up worktree for Option 2" | "for a PR option (1 or 2)" |
| `:306`, `:362` | "Only cleanup for Options 1 and 4" / "Clean up worktree for Options 1 & 4 only" | "3 and 5" |
| `:324` | "Options 1 and 2 (any path that lands on base)" | "Options 1-3" |
| `:334` | "Options 1, 2, or 3 - not Discard" | "Options 1-4 - not Discard" |
| `:353` | "before the Option 1 squash or the Option 2 push" | "before the Option 3 squash or the Option 1/2 push" |
| `:357` | "Verify tests before offering options" | "Verify, or apply the Step 1 skip rule, before offering options" |
| `:361` | "typed confirmation for Option 4" | "Option 5" |

Where a sentence allows, the new text names the option ("the squash option") beside the numeral, so a future PR-style row costs one table cell.

Stage-skill lint constraints hold: no bare `cd` at statement start, no `--show-toplevel`, no "switch into the worktree" prose. The file stays under 500 lines (369 today, about +20).

`reference/disposition-protocol.md:40,44` say "Re-run Step 1's canonical tests"; the phrase resolves to whatever Step 1 specifies and is unchanged.

### Change 2: `skills/writing-plans/SKILL.md:157`

Append one sentence to the `**Verification:**` header template's placeholder text: *in a repo with per-service verification commands, list the command of every service the change affects - its own files or code it depends on; a repo-wide shared path (root config, lockfile, shared library) affects every dependent service - taking the per-service commands from the overrides file or `AGENTS.md` when recon reports a single entrypoint.* The commands stay on the one `**Verification:**` line as backtick spans, which is what `plan-check` reads (`extensions/lib/plan-check.ts:164-166,424-429`); `plan-contract.md` is unchanged.

### Change 3: `scripts/ci.mjs:293`

The heading array becomes `["#### Option 1: Push and Create PR", "#### Option 2: Push and Create Draft PR", "#### Option 3: Squash-merge to base"]`. The existing assertion (each block names "telemetry record") passes for the draft block through its first sentence.

### Change 4: stale menu enumerations

| File | Today | New |
|---|---|---|
| `README.md:43` | "squash, PR, keep, or discard" | "PR, draft PR, squash, keep, or discard" |
| `doc/configuration.md:144` | "before the Option 1 `git merge --squash` ... or the Option 2 `git push`" | "before the Option 3 `git merge --squash` ... or the Option 1/2 `git push`" |
| `skills/subagent-driven-development/SKILL.md:227` | "(squash / PR / keep / discard)" | "(PR / draft PR / squash / keep / discard)" |

`skills/using-git-worktrees/SKILL.md:197` ("Default finish squashes ...") and `extensions/phase-tracker.ts:140` ("squash/PR/keep/discard") stay as-is: the first describes the squash option's effect, not the menu order; the second is an unordered nudge string and an extension edit would force a bundle rebuild for no behaviour change.

### What does not change

SDD's verification steps (`SDD:222-224`), `dispatching-parallel-agents/SKILL.md`, `plan-contract.md`, every extension and bin. `verify-before-ship`'s regex already matches `gh pr create --draft` and `git merge --squash` (`extensions/lib/telemetry-paths.ts:43-46`); `phase_tracker` and telemetry detect ship by command, not option number. gatekeep-pr already treats a draft PR as assessment-only (`skills/gatekeep-pr/SKILL.md:274`). The gh-14 note "CI-first at finish not reopened" (`doc/specs/2026-09-06-gh-14-gatekeep-ci-evidence-default.md:72`) stands: a local full run still precedes every landing.

## Errors and edge cases

| Case | Behaviour |
|---|---|
| Agent unsure whether the tree changed since verify | Run the set; the skip rule's default is "run". |
| Only `telemetry:` commits and record writes since the verify pass | The skip rule's tree check excludes `<telemetry.dir>`; skip applies. |
| Finishing entered manually, no plan this session | Command falls back to the affected services' commands from overrides/AGENTS.md; pre-existing-findings caveat applies unchanged. |
| No verify-phase pass this session (verify failed, skipped, or never ran) | The skip rule's precondition is false; Step 1 runs. (`phase_tracker` does not gate `ship` on verify - `extensions/phase-tracker.ts:862-936` rejects `start` only for an in-progress sibling phase.) |
| Draft PR with no passing test this session | `verify-before-ship` warns on `gh pr create` regardless of flags; unchanged. |
| Draft PR reaches gatekeep-pr | Assessment rows only until ready-for-review; unchanged. |
| Squash conflict | Post-squash run on Option 3 catches it; mandatory as today. |
| Consumer overrides pin finishing option numbers | Broken by renumbering; called out in CHANGELOG as a behaviour change, no migration. |

## Testing

`npm test` (`scripts/ci.mjs`) is the whole verification: stage-skill lint over the touched skills; literal pins at `ci.mjs:173-255` untouched (`#amending-an-approved-spec`, `Amendments auto-applied`, `## Acceptance criteria`, `- deferred: <where>`, the `venue:`/`deferred:` sentence, SDD's `` never default to `no` ``); the updated heading split at `:293` asserts all three landing blocks name the telemetry record; `model-literal-lint` unaffected. Plus one manual check at implement: `rg -n 'Option|[0-9] options|[0-9]-option' skills/finishing-a-development-branch/SKILL.md` shows no numeral outside the Change 1 table. No new test file.

## Out of scope

Moving the full run from SDD verify to the landing decision (would supersede the 2026-08-12 tiering rule and gh-14's note); replacing the post-squash run with hotfix's tree-equality proof; a structured overrides schema for service -> command mapping; `verify-before-ship` branching on squash vs PR; any CI wait inside finishing; `dispatching-parallel-agents` wording.

## Documentation impact
- Feature / user-facing docs introduced: none
- Materially amended existing docs: `CHANGELOG.md` (`## Unreleased`: menu renumbering with PR first and a draft-PR row, Step 1 skip rule, header-set scoping, consumer option-number pins break); `README.md:43`; `doc/configuration.md:144`
- Derived / memory docs invalidated: none

Per `skills/brainstorming/reference/documentation-impact.md`; skill bodies are implementation surface, not doc-impact entries.

## Open questions

None outstanding. Unverified and carried as an assumption: no consumer depends on Step 1 firing when the verify-phase run passed on an unchanged tree - the skip rule targets exactly that case and keeps the run everywhere else.
