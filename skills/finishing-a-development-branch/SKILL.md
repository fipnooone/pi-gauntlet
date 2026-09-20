---
name: finishing-a-development-branch
description: Use when implementation is complete, all tests pass, and you need to decide how to integrate the work - guides completion of development work by presenting structured options for merge, PR, or cleanup
argument-hint: "<worktree-path>"
---

# Finishing a Development Branch

## Overview

Guide completion of development work by presenting clear options and handling chosen workflow.

**Core principle:** Verify tests → Detect environment → Surface closure → Present options → Execute choice → Clean up.

## Input

`<worktree-path>` - the absolute path of the worktree to finish, from the `using-git-worktrees` report or the handoff brief. Before anything else - before the announcement and before `phase_tracker` start - if it is missing, stop with "finishing needs the worktree path: /skill:finishing-a-development-branch <worktree-path>" and do nothing else. Derive the primary checkout once:

```bash
WORKTREE=<worktree-path>
PRIMARY=$(dirname "$(git -C "$WORKTREE" rev-parse --path-format=absolute --git-common-dir)")
FEATURE=$(git -C "$WORKTREE" branch --show-current)
```

The process cwd never changes; every command targets `$WORKTREE` or `$PRIMARY` explicitly.

**Announce at start:** "I'm using the finishing-a-development-branch skill to complete this work."

Then call `phase_tracker({ action: "start", phase: "ship" })`.

## The Process

### Step 1: Verify Tests

**Hard verification gate.** Tests/format/lint must pass before presenting any options — including Discard. The user's stated intent to throw the branch away does not change whether the diff is in a verifiable state; verifying first surfaces accidental damage to unrelated code before the branch is gone forever. No exceptions.

Run the project's canonical verification target in the worktree: `(cd "$WORKTREE" && <verification command>)`. The exact command lives in the repo's `AGENTS.md` or service-level docs (look for "verification", "CI", or "test" sections). Typical patterns: `make ci`, `npm test`, `pytest`, `cargo test`, `bundle exec rspec`. Cross-cutting changes: run each affected service's target; don't skip any.

**Scoping caveat — pre-existing findings.** Some services carry lint findings unrelated to the diff. If verification fails on lines you didn't touch:

1. Confirm with `git -C "$WORKTREE" diff <base>...HEAD --name-only` that the offending file isn't in your diff.
2. Surface the pre-existing finding to the user as a separate issue — do **not** auto-fix it in this completion ("surface, don't auto-fix").
3. Proceed only after the user acknowledges.

**If tests fail (within your diff):**
```
Tests failing (<N> failures). Must fix before completing:

[Show failures]

Cannot proceed with Options 1–3 until tests pass.
```

Stop. Don't proceed to Step 2.

**If tests pass:** Continue to Step 2.

No documentation prompt here: Documentation impact is decided at spec time (`/skill:brainstorming` section 6, gated by `brainstorming/reference/documentation-impact.md`) and has already shipped in the diff by the time you reach finishing.

### Step 2: Detect Environment

Detached HEAD (`git -C "$WORKTREE" symbolic-ref -q HEAD` prints nothing) -> reduced 3-option menu (no merge), no cleanup. Otherwise the standard 4 options.

### Step 3: Determine Base Branch

```bash
# Try common base branches
git -C "$WORKTREE" merge-base HEAD main 2>/dev/null || git -C "$WORKTREE" merge-base HEAD master 2>/dev/null
```

Or ask: "This branch split from main - is that correct?"

### Step 3.5: Closure / Conformance Disposition Gate

This is an **enforced disposition gate**, not a surface-only notice. The user is about to choose how to ship; every carried-open decision must get an explicit disposition here, before Step 4's menu. Tests prove the code runs; conformance proves it does what was requested - different gates.

`verification-before-completion/reference/conformance-check.md` is **canonical** for the durable handoff schema, concern-decomposition rules, the single disposition-availability table, the `UNAUTHORIZED` question text, the `recommended: none` preflight, the freshness rule, and the concern-scoped fix projection. This step owns only **render, response, and execute-order** and consumes the rest by link - it does not restate the availability table, the `UNAUTHORIZED` question, or the preflight prose.

**If no conformance check has run in this flow** (e.g. ad-hoc work that landed without an execution skill): say so, then dispatch a fresh-context `conformance-reviewer` with `cwd: "<worktree-path>"` against the origin (spec + verbatim prompt + full diff vs base) per that reference - it owns the audit-time input rule (stage/commit untracked deliverables before auditing). Closing the loop is cheap relative to shipping unverified intent. Route the raw reviewer verdict through the reference's canonical pipeline (gap/concern partition, auto-fix where eligible, concern decomposition, emission of a durable `## Closure / conformance` block), then consume that block through the branching below exactly as a carried handoff.

**Freshness precondition - before any verdict branch, including `CONFORMS`.** The durable block opens with a two-line sentinel: `status: CONFORMS (0 open)` or `status: GAPS (N open)`, then `audited-base: <full HEAD SHA at audit time>`. Read the sentinel, then apply the reference's freshness rule (its `## Closure / conformance` block is the single source): compare `audited-base` to the current working tree; any change, doubt, missing/mismatched sentinel, legacy terse row, or malformed structured reviewer block triggers a fresh audit and replacement of the closure block. Never infer `CONFORMS` from the absence of bullets. Only a clean, valid `status: CONFORMS (0 open)` handoff enters the zero-gap fast path.

**Zero-gap fast path:** print exactly

```
Closure / conformance: CONFORMS
```

then continue directly to Step 4. No approval prompt, no menu, no shared options line, no sign-off. If the run auto-applied fixes, surface the flat `auto-applied fix commits: <Gn: SHA>, ...` index from the durable block as **one informational, non-blocking line** with a one-line revert offer (see "Revert semantics") - a gap that auto-converged mid-verify has no bullet, so this index is the only place its fix commit stays revertable. Do not wait for acknowledgment.

**Pre-menu amendment funnel (GAPS only).** Before rendering the carried-open menu, run [`amendment-surface.md` § Conformance entry](../brainstorming/reference/amendment-surface.md) over the inventory once: gaps with `recommended: accept`, verdict `DRIFTED` or `PARTIAL`, not `UNAUTHORIZED`, whose `origin` is not an acceptance criterion are drafted as `accept-into-spec` items (the edit built from `origin` + `evidence`) and sent to the reviewer in one call; cleared items apply and land as one batch commit, the spec is re-audited, the inventory regenerated. Only concerns the re-audit actually closed drop out; sibling concerns in the same gap keep their rows and dispositions. Survivors and every other gap render as ordinary rows below - one menu, never two.

**Carried-open (`status: GAPS (N open)`).** Read `reference/disposition-protocol.md` and follow it for the carried-open render (dense) grammar, the response grammar, and the 9-step execute order. Render the human decision menu in the shape below, drive the dispositions per that reference, then print the summary render and continue to Step 4. If that reference file cannot be read, stop and surface a blocking error — do **not** improvise the grammar from memory.

Representative carried-open render (multi-concern gap split to `e2e`; single-concern gap `cache`; `UNAUTHORIZED` gap `auth`):

```
Conformance: 3 decisions needed before shipping.

* e2e - Source-image E2E validation: not run; blocked (HYDRA1.png, HTTP 401).
  Still in scope for this branch? Recommended: rescope (defer until image available) (fix-now N/A: needs HYDRA1.png).
* cache - Cache coverage: implemented but the spec is silent on it.
  In scope? Recommended: accept into spec (behavior is intentional).
* auth - Unrequested admin bypass: adds an unlisted route. Should this unrequested behavior become part of the current workflow? Recommended: fix-now = remove it (rescope N/A: scope creep).

Other options per item: fix-now / accept / rescope / follow-up / custom.

1. Go with recommended
2. Recommended except <handle>=<choice>   e.g. "2: cache=follow-up"
```

A single-concern render is identical minus the split: one bullet whose handle is the gap ID or word, no sibling.

Execute the chosen dispositions per `reference/disposition-protocol.md` (Execute order), then print the closure summary and continue to Step 4:

```
Closure / conformance: CONFORMS
  (or: GAPS resolved - G1/C1 - Source-image E2E validation: rescope-into-spec;
       G2 - Cache coverage: follow-up (PROJ-123); ...)
```

No auto-proceed: every carried-open decision needs an explicit disposition before Step 4 renders.

### Revert semantics

Three tiers, increasing cost — name the tier when a revert is requested:

| Tier | What's reverted | Cost | Mechanics |
|---|---|---|---|
| Cheap | Council edit, reverted at the `brainstorming` gate | Spec isn't yet plan- or code-bearing | Revise spec, re-present |
| Light | Conformance fix, reverted at finish | Gap re-opens for a fresh disposition | Revert the `conformance fix Gn` commit(s), re-audit |
| Heavy | Council edit, reverted at finish | Rewrites the already-ratified contract that drove the plan and code | Amend spec per brainstorming's [Amending an approved spec](../brainstorming/SKILL.md#amending-an-approved-spec) → regenerate affected plan/code → re-run verify before ship |

A **heavy** revert is not a menu toggle — say so explicitly to the user before proceeding, and do not present it as equivalent-effort to the light tier. The council audit that lets the human identify revert candidates lives in the `brainstorming` spec commit message body (not a committed spec section).

### Step 4: Present Options

**Amendment digest (both variants).** Before the options, read `git -C "$WORKTREE" log <base-branch>..HEAD --grep '^amend:'` and take the `auto-apply` and `granted` records from those commit bodies. Render, then the options:

```
Amendments auto-applied (N):
- <title> - <what changed>
```

Omit the block when N = 0.

**Normal repo and named-branch worktree — present exactly these 4 options:**

```
Implementation complete. What would you like to do?

1. Squash-merge to <base-branch> (no PR, no surviving branch)
2. Push and create a Pull Request
3. Keep the branch as-is (I'll handle it later)
4. Discard this work

Which option?
```

**Detached HEAD — present exactly these 3 options:**

```
Implementation complete. You're on a detached HEAD (externally managed workspace).

1. Push as new branch and create a Pull Request
2. Keep as-is (I'll handle it later)
3. Discard this work

Which option?
```

**Don't add explanation** - keep options concise.

### Step 5: Execute Choice

#### Strip the plan, keep the record (Options 1 and 2)

Run this on the feature branch before either landing path. The spec and its telemetry record (`<telemetry.dir>/<spec path with .md -> .yaml>`, default `.pi/gauntlet/telemetry/doc/specs/<spec>.yaml`) are deliverables and ship in the squash; only the plan is stripped. `<bin>` is `<directory of this skill's SKILL.md>/../../bin`, resolved from the skill's `<location>` in the system prompt.

```bash
# Plans are ephemeral - if one was committed on this branch, remove it before landing.
PLAN_PATH=doc/plans/<plan-file>.md   # or <service>/doc/plans/<plan-file>.md
if git -C "$WORKTREE" ls-files --error-unmatch "$PLAN_PATH" >/dev/null 2>&1; then
  git -C "$WORKTREE" rm "$PLAN_PATH" && git -C "$WORKTREE" commit -m "Remove ephemeral plan doc"
fi

# The telemetry record is a deliverable - restore it if a strip or a stray delete removed it.
node <bin>/gauntlet-telemetry-salvage.mjs --worktree "$WORKTREE" --base <base-branch>
```

The salvage prints one line per spec on the branch (`present`, `present <path> (marked shipped)`, `restored <path> from <sha>`, `restored <path> from <sha> (marked shipped)`, `no telemetry run`, `never written`, `restore failed <path>: <reason>`) and always exits 0. `(marked shipped)` means the record was still `in_progress` with no ship phase (the recorder lost its binding) and the salvage committed `status: shipped` + `shipped_at` as one `telemetry:` commit; it rides the squash or push like any branch commit. Print its stdout verbatim in the ship completion message. A `restore failed` line is reported, never retried, and never blocks the ship - the record stays recoverable from the branch ref.

#### Option 1: Squash-merge to base

Run the strip-and-salvage block above first (plan stripped, telemetry record kept), then:

```bash
git -C "$PRIMARY" checkout <base-branch>
git -C "$PRIMARY" pull
git -C "$PRIMARY" merge --squash "$FEATURE"
git -C "$PRIMARY" commit -m "<imperative summary> (ref <ticket-id>)"
(cd "$PRIMARY" && <Step 1 command for the service(s) touched>)
```

The plan was already removed on the branch, so the staged squash tree carries the spec, the telemetry record, and the implementation - never the plan.

The post-squash re-verify is not optional - `git merge --squash` can surface conflict-resolution mistakes the worktree-side run couldn't catch.

Cleanup worktree (Step 6), then, if Step 6 removed the worktree, `git -C "$PRIMARY" branch -D "$FEATURE"`.

**No push. No PR.** The squashed commit stays local on `<base-branch>` unless the user explicitly asks to push.

#### Option 2: Push and Create PR

Run the strip-and-salvage block above first (plan stripped, telemetry record kept), then:

```bash
# Push branch
git -C "$WORKTREE" push -u origin "$FEATURE"
```

```bash
# Create PR
(cd "$WORKTREE" && gh pr create --title "<title>" --body "$(cat <<'EOF'
## Summary
<2-3 bullets of what changed>

## Test Plan
- [ ] <verification steps>
EOF
)")
```

When the spec's `## Acceptance criteria` has at least one `venue:` or `deferred:` row, append this block after `## Test Plan`, listing those rows verbatim with their disposition, so the reader knows what `/skill:check-delivery` verifies after deploy and what a follow-up owns. With no such rows the body ends at `## Test Plan`, byte-identical to today. Option 1's squash commit message is unchanged.

```markdown
## Acceptance criteria
- [ ] <row text verbatim> - venue: <env> - <observation>
- [ ] <row text verbatim> - deferred: <where>
```

**Do NOT clean up worktree** — user needs it alive to iterate on PR feedback.

#### Option 3: Keep As-Is

Report: "Keeping branch <name>. Worktree preserved at <path>."

**Don't cleanup worktree.**

#### Option 4: Discard

**Confirm first:**
```
This will permanently delete:
- Branch <name>
- All commits: <commit-list>
- Worktree at <path>

Type 'discard' to confirm.
```

Wait for exact confirmation.

If confirmed: Cleanup worktree (Step 6), then, if Step 6 removed the worktree, `git -C "$PRIMARY" branch -D "$FEATURE"`.

### Step 6: Cleanup Workspace

**Only runs for Options 1 and 4.** Options 2 and 3 always preserve the worktree.

**If the worktree was created by a project-native script** (e.g. `script/worktree create`, `bin/worktree`): defer to its destroy command, run against the primary: `"$PRIMARY/script/worktree" destroy "${WORKTREE##*/}"`.

**If `$WORKTREE` is under `$PRIMARY/.worktrees/` or `~/.worktrees/<project>/`:** gauntlet created it - we own cleanup:

```bash
git -C "$PRIMARY" worktree remove "$WORKTREE"
git -C "$PRIMARY" worktree prune
```

Removal precedes branch deletion in both options; `git branch -d`/`-D` fails while the worktree still references the branch.

**Otherwise:** the host environment owns this workspace. Do NOT remove it, and skip the branch deletion that follows - report that the host-owned worktree still holds `$FEATURE`.

## Quick Reference

| Option | Merge | Push | Keep Worktree | Cleanup Branch | Plan strip + record salvage |
|---|---|---|---|---|---|
| 1. Squash-merge locally | yes (squash) | - | - | yes (after Step 6 removal) | yes (guarded, on the branch before squash) |
| 2. Create PR | - | yes | yes | - | yes (guarded, on the branch before push) |
| 3. Keep as-is | - | - | yes | - | - |
| 4. Discard | - | - | - | yes (force, after Step 6 removal) | - |

A host-owned worktree (Step 6 "Otherwise") keeps both the worktree and the branch.

## Common Mistakes

**Skipping test verification**
- **Problem:** Merge broken code, create failing PR
- **Fix:** Always verify tests before offering options

**Open-ended questions**
- **Problem:** "What should I do next?" is ambiguous
- **Fix:** Present exactly 4 structured options (or 3 for detached HEAD)

**Cleaning up worktree for Option 2**
- **Problem:** Remove worktree user needs for PR iteration
- **Fix:** Only cleanup for Options 1 and 4

**Deleting branch before removing worktree**
- **Problem:** `git branch -d` fails because worktree still references the branch
- **Fix:** Merge first, remove worktree, then delete branch

**Removing the worktree with the wrong `-C`**
- **Problem:** `git worktree remove` run against the worktree itself fails
- **Fix:** `git -C "$PRIMARY" worktree remove "$WORKTREE"`

**Cleaning up harness-owned worktrees**
- **Problem:** Removing a worktree the harness created causes phantom state
- **Fix:** Only clean up worktrees under `.worktrees/`, `~/.worktrees/<project>/`, or paths produced by a project-native worktree script

**No confirmation for discard**
- **Problem:** Accidentally delete work
- **Fix:** Require typed "discard" confirmation

**Skipping the strip-and-salvage block in Options 1 and 2 (any path that lands on base)**
- **Problem:** Plan docs are ephemeral and shouldn't land on `<base-branch>`; the telemetry record is a deliverable and must. Skipping the block ships the plan, or drops the record the spec index reads.
- **Fix:** Run the block on `$WORKTREE` before the squash or the push. The plan stays in the branch's git history (`git -C "$PRIMARY" log --all -- doc/plans/...`). Spec and telemetry record stay on `<base-branch>`; plan does not.

**Widening the plan strip to the telemetry record**
- **Problem:** `.pi/gauntlet/telemetry/**` looks like scaffolding next to the plan and gets deleted in the same commit - main then has no record for the run.
- **Fix:** Never `git rm` under the telemetry dir. The salvage restores a stripped record, but the deletion should not happen in the first place.

## Completion

Once the chosen option (Options 1, 2, or 3 — not Discard) is executed successfully, mark the ship phase complete:

```
phase_tracker({ action: "complete", phase: "ship" })
```

Once the merge (and any deploy) has landed, `/skill:check-delivery <ticket-ref>` is the explicit follow-up that proves delivery before the ticket's status advances - not run automatically here.

## Red Flags

**Never:**
- Proceed with failing tests
- Merge without verifying tests on result
- Delete work without confirmation
- Force-push without explicit request
- Remove a worktree before confirming merge success
- Clean up worktrees you didn't create (provenance check)
- Run any step without the `<worktree-path>` argument
- Auto-proceed past an undispositioned carried-open gap
- Skip the strip-and-salvage block before the Option 1 squash or the Option 2 push
- Delete the telemetry record (`.pi/gauntlet/telemetry/**` or the configured `telemetry.dir`) on any path

**Always:**
- Verify tests before offering options
- Print the `gauntlet-telemetry-salvage.mjs` output verbatim in the ship completion message
- Derive `$PRIMARY` and `$FEATURE` from `<worktree-path>` before presenting the menu
- Present exactly 4 options (or 3 for detached HEAD)
- Get typed confirmation for Option 4
- Clean up worktree for Options 1 & 4 only
- Target `$PRIMARY` with `git -C` for merge, worktree removal, and branch deletion
- Run `git -C "$PRIMARY" worktree prune` after removal
- Surface the closure / conformance verdict as its own section before the options menu

## Project overrides

If a gauntlet overrides file exists - checked in order: `.pi/gauntlet-overrides.md`, `<repo root>/gauntlet-overrides.md`, `<repo root>/doc/gauntlet-overrides.md`; first found wins - read it. Any sections relevant to this skill — by name match, by topic (routing, verification, worktrees, etc.), or by workflow convention — override or extend the instructions above. Project-local `AGENTS.md` is already in context — check it for project-specific routing tables, service paths, and verification commands.
