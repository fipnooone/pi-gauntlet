# Handoff brief contract (gauntlet-resume supplementary)

Consumed only by `SKILL.md` in this directory. This file is the single concentration
point for text coupled to pi-cohort's `/handoff` template (`doc/handoff-template.md`
in pi-cohort; baseline inlined from its `prune-prompts` branch, commit `d737eb9`).
Cohort drift is reconciled here and nowhere else.

## Brief grammar

Headings, fixed order. A consumer keys on headings, never prose.

```markdown
# Handoff: <one line>
## Intent
## Repo state
## Decisions
## Open questions
## Skills loaded
## Process state
```

| Section | Content | Presence |
|---|---|---|
| `## Repo state` | one field per line: `toplevel`, `worktree: yes <path>` or `worktree: no`, `branch` (`detached` when none), `HEAD`, `base` (`unknown` when no remote resolves), `dirty: <porcelain>` or `dirty: clean`, `diff-stat` (`unavailable` when base unknown), `test cmd`; any field `unavailable` when its command failed; heading `## Repo state: not a git repo` outside git | always |
| `## Decisions` | bullets; rejected alternatives marked `rejected:` | always |
| `## Skills loaded` | frontmatter `name`s; `## Skills loaded: none` when none | always |
| `## Process state` | `phase_tracker status` then `plan_tracker status` verbatim; `Active task: <name|none>`; the line `Gate history not restored - re-validate before advancing.` | only when both tracker tools exist and a phase is `in_progress` |

Consumer rules (cohort): process state absent -> plain handoff (the consumer starts its
own process from `## Intent`); present with `No plan active.` -> phase-only, restore no
plan; loading named skills is the consumer's job.

A brief is any text whose first line starts `# Handoff:` - a file on disk or pasted
inline. `## Repo state` is matched by prefix: `## Repo state` or
`## Repo state: not a git repo`.

## Tracker output grammar

Must match `formatStatus` in the phase-tracker and plan-tracker extensions.

```
Phases:
  ✓ brainstorm
  → implement(W2)
  ○ verify (reason)
```

Glyphs `✓` complete, `→` in_progress, `⊘` skipped, `○` pending; `(reason)` suffix when
set; `name(substep)` only on the in-progress phase.

```
Plan: 2/5 done (1 in progress, 2 pending)

  ✓ [0] <name>
  → [1] <name>
```

or `No plan active.`. Task glyphs `✓` complete, `→` in_progress, `✗` failed, `⊘` skipped,
`○` pending, mapping 1:1 onto `plan_tracker init` `{name, status}` statuses.

Parse stops (print the offending line, make no tracker call):

- a task line not matching `^\s*[✓→✗⊘○] \[\d+\] .+$` - the "unparsable process-state
  task line" stop;
- a process-state section whose phase block shows all `○` - contradictory (the producer
  emits the section only with an in-progress phase);
- a phase block with more than one `→` line - contradictory (the tracker holds one active
  phase; print both lines).

## Process-state restore

Facts that fix the order (from the extensions):

- Arming happens only on `start brainstorm`; `reset` disarms; `skip` and `complete`
  preserve it.
- `plan_check` stamps only inside an armed flow; unarmed it returns
  `PASS (no flow to stamp)`.
- `start implement` is rejected without a current `plan_check` stamp.
- `skip` has no state precondition and takes a `reason`; one phase is active at a time.
- `complete verify` is blocked without a fresh `conformance-reviewer` dispatch when
  closure review is enforced.
- `plan_tracker init` on an in-progress implement with every task `complete`/`skipped`
  auto-completes implement.

Per-stage call table, keyed by the brief's active phase (`→`). `R` is the reason string
`resume: <brief file or "pasted brief">`.

| Active | Calls, in order |
|---|---|
| brainstorm | `start brainstorm`; `substep` if the brief shows one |
| plan | `start brainstorm`; `skip brainstorm R`; `start plan`; `substep` if shown |
| implement | `start brainstorm`; `skip brainstorm R`; `start plan`; `plan_check({ planPath })`; on FAIL print findings and stop with plan in_progress, no init; on PASS `skip plan R`; `start implement`; `substep` if shown; `plan_tracker init` |
| verify | as implement through `skip plan R`, then `skip implement R`; `start verify`; `substep` if shown; `plan_tracker init` |
| ship | as verify. Restoration stops at verify in_progress: `complete verify` needs a fresh conformance dispatch and `skip verify` would bypass a real gate. Announce that the closure review re-runs before ship |

`planPath`: the brief carries none. Resolve as reconstruction does
(`reconstruction.md`, "Candidates", including its `flowGuards.specDirs` resolution): the
single spec/plan pair added after base in the worktree, paired by identical basename
(`<specDir>/<name>.md` <-> `<sibling plans dir>/<name>.md`, the writing-plans contract);
resolve the selected plan to an absolute path under the worktree before `plan_check`.
Zero pairs -> stop; more than one -> human picks.

"Exact" restoration binds: the active phase identity and substep, and the plan task list
(names, order, statuses) verbatim. Prior phases show `⊘ (resume: ...)` regardless of the
brief's glyph - skip-arming is the mechanism and completing priors would fabricate gated
history. `No plan active.` -> no `init` call.

Before `init`, validate feasibility against the tracker's own rules:

- pending-suffix order - every `○` task must trail every non-pending task;
- the implement auto-complete edge - an implement brief whose tasks are all
  complete/skipped is infeasible as stated; propose verify as the target and ask.

Every restore ends with:

```
Gate history not restored; re-validating `<task>` before any stage advance
```

where `<task>` is the brief's `Active task`, else the first in-progress task, else `none`
(whole-deliverable re-validation). Gate history, closure-review evidence, and fix rounds
are never inferred or restored; a ship-stage brief resumes at verify.
