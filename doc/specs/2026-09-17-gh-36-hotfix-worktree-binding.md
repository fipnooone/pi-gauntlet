# hotfix.md: bind the implementer to the hotfix worktree

Ticket: https://github.com/jjuraszek/pi-gauntlet/issues/36
Supersedes: `doc/specs/2026-09-03-chase-bug-hotfix.md`, decision 5 "Self-containment" only (the `ci.mjs` exclusion).

**Goal:** An `implementer` dispatched by `skills/chase-bug/hotfix.md` can no longer mutate the primary checkout without the parent noticing before tests, review, or landing proceed. The child proves its binding to the hotfix worktree as its first command and addresses it explicitly on every mutating git command; the parent asserts the primary checkout is untouched after every implementer return, before it reads the child's status; `scripts/ci.mjs` asserts the guard text is present in step 4.

## Problem

In the `resume-cwd-binding` hotfix run, the step 4 implementer - dispatched with `cwd` = `.worktrees/hotfix/<slug>` and `context: "fork"` - committed `adf7404` on primary `main` (saved `BASE_SHA` was `7b39636`) and then cherry-picked it into the worktree. Step 8's land guard (`<default>` == `BASE_SHA`) would have refused to squash, but nothing between step 4 and step 8 detects the damage, and the stray commit is left for the user to find.

The mechanism is transcript priming, not cwd loss. pi-cohort 7.0.0 forwards the task `cwd` to the spawned child for single and parallel dispatch (`src/runs/foreground/subagent-executor.ts:1974-2001`, `src/runs/foreground/execution.ts:176-183`) and `context: "fork"` branches the persisted parent session (`src/shared/fork-context.ts:25-74`). The forked child therefore started in the worktree but inherited a transcript full of `cd <primary> && git ...` lines from the parent's step 3 and followed them. Later children in the same run, given a first-command toplevel assertion, stayed in the worktree.

## Design

All edits live in `skills/chase-bug/hotfix.md` except component 4 (`scripts/ci.mjs`), the CHANGELOG entry, and the predecessor banner.

### 1. Step 3 additions: worktree path and primary snapshot

Step 3 creates the worktree with an absolute path and derives the literal the child will be compared against from git itself, so both sides of the guard come from the same resolver (a symlinked `.worktrees/` or a step 3 run from a subdirectory of the primary can otherwise make the string-concatenated path disagree with the child's `show-toplevel`):

```bash
ORIG_HEAD=$(git rev-parse HEAD)                       # alongside ORIG_BRANCH, before any mutation
git worktree add "$PRIMARY_ROOT/.worktrees/hotfix/<slug>" -b "hotfix/<slug>" "$DEFAULT"
WORKTREE=$(git -C "$PRIMARY_ROOT/.worktrees/hotfix/<slug>" rev-parse --show-toplevel)
```

`ORIG_HEAD` joins `PRIMARY_ROOT`, `DEFAULT`, `BASE_SHA`, `ORIG_BRANCH` in the pre-mutation capture block. `WORKTREE` is set only after `git worktree add` succeeds. Every `.worktrees/hotfix/<slug>` reference in steps 8-9 and the abort blocks keeps its current form; only creation becomes absolute.

### 2. Worktree binding block in the implementer task text (step 4)

Step 4 becomes "One `implementer`, `context: "fresh"` - passed explicitly, because the persona's frontmatter pins `defaultContext: fork` (`agents/implementer.md:5`) and pi-cohort fills that default whenever the call omits `context` (`applyAgentDefaultContext`, `src/runs/foreground/subagent-executor.ts:766`)". The one-line rationale in the skill text: a forked parent transcript carries the parent's `cd <primary>` commands and primes the child to leave the worktree; the evidence pack and record path already make the task self-contained, so a fresh context loses nothing the child needs. The skill text never contains the substring `fork context` (the ci row in component 5 asserts its absence).

The parent substitutes the literal values of `WORKTREE` and `PRIMARY_ROOT` into the task text (never a `$VAR` the child would have to resolve). The task text gains this block, inserted before the TDD instructions:

```
Worktree binding: your checkout is <WORKTREE>. Your first command, before any
other, is
  actual=$(git rev-parse --show-toplevel); [ "$actual" = "<WORKTREE>" ] || echo "MISMATCH: $actual != <WORKTREE>"
On MISMATCH run nothing else; your final message opens with the line
`BLOCKED: toplevel <actual> != <WORKTREE>` and ends with `STATUS: BLOCKED`.
Every mutating git command (add, commit, checkout, reset, stash) runs as
`git -C <WORKTREE> ...`. Never `cd` out of <WORKTREE>; never run a command
against <PRIMARY_ROOT>.
```

The `BLOCKED:` opening line is load-bearing: pi-cohort turns a final message whose first non-empty line starts with `BLOCKED:` into a dispatch error that carries the full output (`src/runs/shared/completion-guard.ts:65-67`, `src/runs/foreground/attempt-finalization.ts:214-217`), and that classification runs before the implementer's `completionGuard` (`agents/implementer.md:9`), which would otherwise replace an edit-free child's report with the generic "completed without making edits" error and lose the two paths.

The existing dispatch fields stay: `cwd` = `<WORKTREE>`, the record path and inlined evidence pack, `SCOPED_TEST_COMMANDS`, "commit on `hotfix/<slug>` before reporting", the SDD status line.

### 3. One rule for all four implementer rounds

Step 3's closing sentence ("Every dispatch below: `cwd` = the worktree path, the record path in the task text, `output:` (when used) an absolute `$TMPDIR` path.") stays as written - it is the only cwd/record/output rule for the step 6 and step 7 reviewers. A second sentence follows it:

> Every implementer round - step 4, the step 5 retry, the step 6 gap fix, the step 7 FIX_FIRST round - is `context: "fresh"` and reuses the **full step 4 task text** (binding block, record path and inlined evidence pack, `SCOPED_TEST_COMMANDS`, commit-before-reporting, SDD status line) with the round's failing output appended verbatim: the red test output (step 5), the conformance gaps (step 6), the review findings (step 7). Each round is followed by `binding_check` before anything else.

Under fork the retry children inherited the step 4 payload from the transcript; under fresh they get only what the task text says, and a fix child that is not told to commit leaves its fix in the working tree where step 7's `<base-sha>..HEAD` review and step 8's `merge --squash` never see it. Reusing the full template closes that.

Steps 5, 6, and 7 keep their existing wording ("one implementer retry", "one implementer round"); they inherit the rule. The step 6 `conformance-reviewer` and step 7 `code-reviewer` dispatches are already fresh and read-only; they are unchanged and are not followed by a binding check.

### 4. Parent binding check after every implementer return

`binding_check` is the **first thing the parent does after any implementer round returns** - before reading the status line and before handling a dispatch error. A child that reports `BLOCKED` (including the MISMATCH case) or whose dispatch errored may have mutated the primary before stopping, and the pre-land abort that `BLOCKED` triggers would delete the worktree evidence. Order per return: `binding_check` -> on failure `binding_abort` only, the status branch is skipped -> on pass, the existing status routing (`DONE`, `DONE_WITH_CONCERNS`, `NEEDS_CONTEXT`, `BLOCKED`). A dispatch error on any implementer round is routed as `BLOCKED` (step 4 today has no dispatch-failure branch; steps 6 and 7 do).

```bash
binding_check() {
  local head branch dirt default
  default=$(git -C "$PRIMARY_ROOT" rev-parse "$DEFAULT")    || binding_abort read "rev-parse $DEFAULT failed"
  head=$(git -C "$PRIMARY_ROOT" rev-parse HEAD)              || binding_abort read "rev-parse HEAD failed"
  branch=$(git -C "$PRIMARY_ROOT" branch --show-current)     || binding_abort read "branch --show-current failed"
  dirt=$(git -C "$PRIMARY_ROOT" status --porcelain --untracked-files=no) || binding_abort read "status failed"
  local moved=""
  [ "$default" = "$BASE_SHA" ] || moved="$moved <default>:$BASE_SHA..$default"
  [ "$head" = "$ORIG_HEAD" ]   || moved="$moved HEAD:$ORIG_HEAD..$head"
  [ "$branch" = "$ORIG_BRANCH" ] || moved="$moved branch:$ORIG_BRANCH->$branch"
  [ -z "$moved" ] && [ -z "$dirt" ] && return 0
  binding_abort drift "$moved" "$dirt"
}
```

Every git read must succeed before any value is compared: a failed read with empty stdout would otherwise satisfy `-z "$dirt"` and let the run proceed, or be misclassified as HEAD drift. All observations are collected before classification, so combined drift (a stray commit plus tracked dirt) is reported as one abort.

Three assertions, not one: a drifted child commits on whatever branch the primary has checked out, which is `ORIG_BRANCH`, and hotfix.md supports `ORIG_BRANCH != DEFAULT` (step 3 aborts only on empty `ORIG_BRANCH`; step 8 checks out `<default>` then restores `<orig-branch>`). Checking `<default>` alone misses the incident's exact failure mode whenever the user was on a feature branch, and misses a checkout-only branch switch. `ORIG_HEAD` and `ORIG_BRANCH` are captured in step 3 before any mutation.

The tracked-only comparison target is the empty string: step 3 aborts unless `git status --porcelain --untracked-files=no` is already empty, so "equals the step 3 baseline" and "is empty" are the same assertion. The full-porcelain baseline file at `$TMPDIR/hotfix-<slug>.baseline` remains report-only, as today. The "Baseline re-check" paragraph is reworded to say "is empty" for the tracked-only check.

`binding_abort` is a third abort class, documented alongside pre-land and land-stage:

- **Never touches the primary checkout**: no `git reset`, no `git checkout`, no stash. The parent did not move anything, so hotfix.md's existing rule (`reset --hard` only when this run moved `<default>`) already forbids it; this class restates it.
- **Preserves the hotfix worktree and branch** for inspection. This deviates from the pre-land cleanup block on purpose: the worktree is the evidence of what the child did where.
- **Report**, by kind:
  - `read`: the failing command and its stderr; the worktree path and `hotfix/<slug>` tip SHA. No drift claim is made.
  - `drift`: for each moved ref, `<ref> moved from <old> to <new>` and `git --no-pager log --oneline <old>..<new>` (branch switch: `checked-out branch changed from <orig-branch> to <branch>`); for tracked dirt, the **path fields only** from the porcelain output (no `XY` status codes); the full `git status --porcelain` delta against the step 3 baseline file; the worktree path and `hotfix/<slug>` tip SHA. The non-executed repair line `git checkout <ref> && git reset --hard <old-sha>` is printed **only when tracked dirt is empty** - with dirt present the parent cannot tell whose edits `reset --hard` would destroy, and the ticket's dirty-drift rule (paths only, no reset advice) wins.
- The menu re-renders **without** the hotfix row (the worktree and branch exist, so a second run would hit the step 3 collision abort anyway).

Step 8's own two land guards stay as they are; they cover the window between the last implementer return and the squash.

Companion text edits in hotfix.md:

- "Abort" section opening: "Both classes end with the baseline re-check" becomes "All three classes ...", and a `**Binding**` paragraph describes the class as above.
- Step 9 "Cleanup evidence" gains a third bucket: "Binding aborts: worktree and `hotfix/<slug>` both present; no removal command is run."
- Red Flags gains: "Reading an implementer's status line before `binding_check`" and "Resetting or checking out any primary ref from `binding_abort`".
- "Harness fallback": with no child the binding block is moot; `binding_check` runs after the initial inline implementation commit and after each inline retry, conformance fix, or review fix, before tests continue.

### 5. `scripts/ci.mjs` assertions

Rows appended to the existing `tokenChecks` table (`scripts/ci.mjs:156-205`, shape `[file, token, want]`), all against `skills/chase-bug/hotfix.md`:

| token | want | proves |
|---|---|---|
| `context: "fresh"` | true | the dispatch parameter, not just an adjective, overrides the persona's fork default |
| `fork context` | false | the old dispatch wording cannot return |
| `git -C <WORKTREE>` | true | mutating commands are path-addressed |

Plus one scoped assertion for ticket AC 4, placed next to the table in the same error-accumulating block: slice `hotfix.md` between the `4. **Implement.**` and `5. **Test.**` headings and require that slice to contain both `Your first command, before any` and `git rev-parse --show-toplevel`. Whole-file substring rows cannot prove the guard lives in step 4 or that the first-command wording survives; the slice check does, at the cost of one `indexOf` pair. Both headings already exist verbatim in hotfix.md; a missing heading is itself a failure.

### 6. CHANGELOG

`## Unreleased` gains one flat bullet (the file has no `### Fixed` subsections): `- chase-bug hotfix: the implementer proves its worktree binding first, addresses every mutating git command with `git -C`, runs with a fresh context, and the parent aborts non-destructively on any primary-checkout drift after each implementer return; `ci.mjs` asserts the guard text ([#36](https://github.com/jjuraszek/pi-gauntlet/issues/36))`.

### 7. Predecessor banner

`doc/specs/2026-09-03-chase-bug-hotfix.md` gets, after its title line and a blank line:

```markdown
> **Superseded by:** [doc/specs/2026-09-17-gh-36-hotfix-worktree-binding.md](./2026-09-17-gh-36-hotfix-worktree-binding.md) - decision 5 "Self-containment" only (the `ci.mjs` exclusion)
```

## Out of scope

- The equivalent first-command guard in `subagent-driven-development` and the other stage skills - assigned to #37.
- Any change to pi-cohort (a fork wrapper that states the effective cwd to the child, or a completion-guard exemption) - reopen only if a fresh-context implementer still drifts.
- Structural prevention at the git layer (a pre-commit hook in the primary checkout, a detached primary) - hotfix.md's boundaries forbid writing to the primary checkout during setup.
- Auto-repair of a stray commit on any primary ref.
- `git -C` hardening of the parent's step 8 land sequence - it runs from `PRIMARY_ROOT` after `cd` by design and is unchanged.
- A live runtime test of the hotfix path.

## Testing

`npm test` (`scripts/ci.mjs`) is the regression: the three new `tokenChecks` rows and the step 4 slice assertion fail against the current `hotfix.md` (`fork context` present, `context: "fresh"` and `git -C <WORKTREE>` absent, no first-command wording in step 4) and pass after the edit. Skill lint, the `pi.settings` ban, and the pack-contents check keep passing. Before commit: `rg -ni "jjuraszek|/Users/[^/]+" skills/ | rg -v "github.com/jjuraszek/pi-cohort"` returns nothing (the ticket link lives in CHANGELOG, not the skill).

## Documentation impact
- Feature / user-facing docs introduced: none
- Materially amended existing docs: `CHANGELOG.md` `## Unreleased` (one bullet linking #36); `doc/specs/2026-09-03-chase-bug-hotfix.md` (supersession banner, decision 5 only)
- Derived / memory docs invalidated: none

Materiality bar: `brainstorming/reference/documentation-impact.md`. `hotfix.md` and `ci.mjs` are implementation surface.

## Open questions

None.
