# Process in primary, work by path

**Ticket:** jjuraszek/pi-gauntlet#37
**Goal:** The pi process stays in the primary checkout (root or any subdirectory); the linked `.worktrees/<name>` checkout is addressed by an explicit absolute path everywhere - runtime extensions derive the checkout from the artifact they act on, skills carry the path as a value and never change the process cwd.

## Problem

Runtime and skills assume the session cwd is the worktree or the repo root. Verified against the code in this worktree:

| # | Defect | Evidence |
|---|---|---|
| 1 | `plan_check` resolves the plan, its `**Spec:**` path, and every `Modify:` probe against `ctx.cwd` | `extensions/phase-tracker.ts:800,823,832-833` |
| 2 | Project settings load from `<ctx.cwd>/.pi/settings.json`; pi's `SettingsManager` does no upward search; telemetry's `realSettings` builds a second `SettingsManager` at `ctx.cwd` for `agentOverrides` | `extensions/lib/gauntlet-settings-loader.ts:16-17`; pi `dist/core/settings-manager.js:55`; `extensions/telemetry.ts:105` |
| 3 | `inPrimaryCheckout` runs `git rev-parse --git-dir --git-common-dir` at the **process** cwd once at load and compares raw strings; from a subdirectory the two spellings differ and Guard 2 goes silent. `BRANCH_SWITCH`/`BRANCH_CHECKOUT` require `git` immediately before the subcommand, so `git -C <path> switch` is never classified at all | `extensions/phase-tracker.ts:162-163,397-410,641` |
| 4 | Stage skills say `cd`/"switch into"/"from there", or derive dispatch `cwd` from `git rev-parse --show-toplevel`; SDD and finishing gate on "session cwd is the worktree" | brainstorming/SKILL.md:95,293,324; using-git-worktrees/SKILL.md:23-24,90-97; finishing-a-development-branch/SKILL.md:24,52-60,169-170,244-278,312,347; subagent-driven-development/SKILL.md:42,186,196,206,237; writing-plans/reference/plan-contract.md:30; roasting-the-spec/SKILL.md:57; verification-before-completion/reference/conformance-check.md:374 |
| 5 | `SHIP_RE`/`DISCARD_RE` accept `git merge --squash` / `git push` / `git worktree remove` only immediately after the statement start; `matchShipStatement` classifies squash with `/^git\s+merge\s+--squash/`; `verify-before-ship.ts` owns a separate `SHIP_CMD` (`git push`, `gh pr create`, no flags, no squash) | `extensions/lib/telemetry-paths.ts:43-44,62`; `extensions/verify-before-ship.ts:36` |
| 6 | gauntlet-resume computes `<primary>` as `dirname $(git rev-parse --git-common-dir)`, which is relative from a subdirectory | `skills/gauntlet-resume/SKILL.md:44` |
| 7 | Telemetry caches `git rev-parse --show-toplevel` of `ctx.cwd` (with an `inGit` flag) and adds/commits there; a worktree spec keys as `.worktrees/<n>/doc/specs/x.md` and the record lands on `main` | `extensions/telemetry.ts:162,183-188,231,235-239,305,350,416,446-447,460,606` |
| 8 | `brief-contract.md` cites pi-cohort `d737eb9`, which is not in pi-cohort; `812de45` is the reachable squash successor | `skills/gauntlet-resume/reference/brief-contract.md:5` |

Guard 2 is a real block (`{ block: true }`), so the issue's "blocked" wording is accurate.

## Design

### Decision: derive the checkout from the artifact

No new runtime state, no cache, no new tool parameter. Every extension that needs a checkout derives it from an absolute path it already holds - the plan file, the spec/plan being recorded, the command's `-C`/`cd` target, or `ctx.cwd` itself. Skills obtain the worktree path once, from `using-git-worktrees`' Step 4 report, and pass it as dispatch `cwd:`, as `git -C <path>`, or as the subshell form below. A fresh session re-enters through the handoff brief's `worktree: yes <path>` row or the explicit `<worktree>` argument of `gauntlet-resume` - the mechanism that exists today; nothing is inferred.

### Shared helper: `extensions/lib/checkout.ts`

```ts
export type GitResult = { code: number; stdout: string };
export type Checkout = { toplevel: string; isPrimary: boolean };

// Pure: parses the three-line output of
// `git rev-parse --path-format=absolute --show-toplevel --git-dir --git-common-dir`.
export function parseCheckout(r: GitResult): Checkout | undefined;

// Runs the rev-parse in the nearest existing ancestor of absPath (the path itself when it
// is an existing directory, else dirname, walking up) and parses it.
export function checkoutOf(absPath: string, git: (args: string[], cwd: string) => GitResult | Promise<GitResult>): Promise<Checkout | undefined>;

// execFileSync wrapper with the GitResult shape; never throws (nonzero code on failure).
export const gitSync: (args: string[], cwd: string) => GitResult;
```

- `isPrimary = gitDir === commonDir` (both absolute, so the subdirectory false-negative disappears).
- `parseCheckout` returns `undefined` on nonzero code or fewer than three lines (not a repo, deleted worktree, git < 2.31 rejecting `--path-format`).
- Async callers (plan_check, Guard 2, telemetry) `await checkoutOf(path, runner)`; telemetry passes its existing `Deps.git`, phase-tracker passes `gitSync`. The synchronous settings loader calls `parseCheckout(gitSync([...], cwd))` directly.
- Telemetry's `GitResult` (`telemetry.ts:35-52`) already has `code`/`stdout`; it satisfies the helper's shape structurally, no adapter.

Git floor: 2.31 (`--path-format`), documented in `doc/configuration.md`. No version sniffing.

### Call site 1: `plan_check`

`planAbs` still resolves a relative `planPath` against `ctx.cwd` (a caller choice). Then `root = (await checkoutOf(planAbs, gitSync))?.toplevel`. The `**Spec:**` path, `FsPort.exists`, and `FsPort.glob` resolve against `root`. `undefined` root produces an `input` finding "plan is not inside a git checkout" and no further checks. Existing `plan_check` tests build fixtures in bare temp dirs (`phase-tracker.test.ts:19-27`); they migrate to `git init` temp repos (one helper in the test file). `plan_check` uses real git; the injected runner is exercised only in `checkout.test.ts`.

### Call site 2: settings

`loadGauntletSettings(cwd, agentDir)` computes `root = parseCheckout(gitSync(["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-dir", "--git-common-dir"], cwd))?.toplevel ?? cwd`, calls `SettingsManager.create(root, agentDir)`, and returns `root` alongside `gauntlet`/`errors`. Telemetry's `realSettings` uses that returned `root` for its own `SettingsManager.create` instead of `cwd`, so `agentOverrides` and `piGauntlet.*` resolve from the same file. Callers keep passing `ctx.cwd`. One `.pi/settings.json` per checkout; a session inside a worktree reads the worktree's, a session in the primary reads the primary's; no cross-checkout merge. The per-tool-call cost is one extra synchronous `git rev-parse`; accepted (no cache is a stated constraint).

### Call site 3: Guard 2 (branch switch in the primary)

The module-level `inPrimaryCheckout` is deleted. `parseGitCommit` in `phase-tracker-helpers.ts:49-68` is generalised to `parseGitCommand(command, subcommandRe)`, returning the same form (`-C <path>` from the flags span, or the last leading `cd`); `parseGitCommit` becomes `parseGitCommand(command, /commit\b/)`. `BRANCH_SWITCH`/`BRANCH_CHECKOUT` adopt the flags-span grammar (`git` + global flags + `switch` / `checkout -[bB]`). Per matching command: `target = resolveRepoDir(form, ctx.cwd)` (`ctx.cwd` when the form names neither `-C` nor `cd`), and the block fires only when `(await checkoutOf(target, gitSync))?.isPrimary === true`. `undefined` (unresolvable target) lets the command through - the guard protects the primary, and an unresolvable target is not it.

Behaviour: bare `git switch` from `<primary>/doc/` blocks exactly as from the root; `git -C <primary> switch -c y` from anywhere blocks (new, intended); `git -C .worktrees/x switch -c y` and `cd .worktrees/x && git checkout -b y` pass.

### Call site 4: telemetry

`ensureToplevel`, the session-level `toplevel` field, and the `inGit` flag are deleted. Every derivation starts from an artifact path:

- Path keying uses `(await checkoutOf(candidateAbs, deps.git))` of the candidate path: the record identity is `(toplevel, specRel)`, so a worktree spec keys as `doc/specs/x.md` under the worktree toplevel and never collides with a same-named primary spec.
- `bind(spec)` stores `toplevel` on the bound record; add/commit/mv/diff/ls-files run with that cwd, i.e. on the worktree branch. The former `inGit` gates become "the bound record has a `toplevel`".
- A candidate whose `toplevel` differs from the bound record's is a fresh bind, never a `git mv` rename; a same-toplevel path change keeps today's rename path.
- A candidate outside any checkout (`undefined`) is skipped through the existing warn path. `checkoutOf` walking to the nearest existing ancestor covers the first write into a not-yet-existing `doc/specs/`.
- The git calls that already operate on the bound record do not re-run `rev-parse`; the record owns its toplevel.

### Ship/discard matching

`SHIP_RE` and `DISCARD_RE` in `telemetry-paths.ts` adopt the flags-span grammar; group 1 stays the full `git ...` statement so `statementAt` is unchanged. `matchShipStatement` classifies from the subcommand after the flags span: `git -C <p> merge --squash x` -> `option: "squash"`, `git -C <p> push` -> `"pr"`. `verify-before-ship.ts` deletes `SHIP_CMD` and calls `matchShipStatement`; as a consequence `git merge --squash` becomes a ship event there too, which is what AC 5 asks for.

### Skills

The worktree path is a value from the `using-git-worktrees` Step 4 report. Three carriers, and no others:

| Need | Form |
|---|---|
| subagent work | `cwd: "<abs worktree path>"` on the dispatch |
| git | `git -C <abs worktree path> ...` |
| any other cwd-bound command (install, test, verification) | `(cd "<abs worktree path>" && <cmd>)` - a subshell; the process cwd never changes |

Per-file changes:

| File | Change |
|---|---|
| `skills/using-git-worktrees/SKILL.md` | Step 0 runs `git rev-parse --path-format=absolute --git-dir --git-common-dir`; inside a linked worktree it reports that worktree as the Step 4 path and creates nothing. `ROOT` (the primary) = `dirname "$(git rev-parse --path-format=absolute --git-common-dir)"`. Step 2b: `git -C "$ROOT" check-ignore`, `>> "$ROOT/.gitignore"`, `git -C "$ROOT" worktree add "$ROOT/.worktrees/$BRANCH" -b "$BRANCH"`; no `cd`. Re-entry: if `git -C "$ROOT" worktree list --porcelain` already lists the intended path, emit the Step 4 report and add nothing. Step 2c installs use the subshell form |
| `skills/brainstorming/SKILL.md`, `gatherer.md` | "Switch into the worktree" -> "carry the worktree path"; spec path and all dispatch `cwd:` are the reported absolute path |
| `skills/writing-plans/SKILL.md`, `reference/plan-contract.md` | plan path is absolute under the worktree; `plan_check` is called with it; "Commands run from the repo root" -> `**Verification:**` commands run in the worktree via the subshell form |
| `skills/subagent-driven-development/SKILL.md` | the line-42 prerequisite becomes "the worktree path is known (report or handoff) and is passed as dispatch `cwd`"; wave test gate and full verification use the subshell form; commit snippets are `git -C <worktree> ...` |
| `skills/finishing-a-development-branch/SKILL.md` | frontmatter `argument-hint: "<worktree-path>"`; the path is mandatory - absent, stop and name it. `<primary>` = `dirname "$(git -C <worktree> rev-parse --path-format=absolute --git-common-dir)"`. Step 1 verification: subshell form in the worktree. Step 2's `GIT_DIR`/`GIT_COMMON` menu is deleted. Operation targets: inspect/push -> `git -C <worktree>`; base checkout, pull, `merge --squash <feature>`, plan `git rm`, base commit, merged-result verification -> `git -C <primary>` / subshell in the primary; then `git -C <primary> worktree remove <worktree>`, then `git -C <primary> branch -D <feature>`. In-place (non-worktree) finishing is no longer this skill's path; using-git-worktrees Step 2d says so |
| `skills/roasting-the-spec/SKILL.md` | "run from inside the worktree" -> dispatch `cwd:` is the worktree path |
| `skills/verification-before-completion/reference/conformance-check.md` | `ROOT=$(git rev-parse --show-toplevel)` -> the worktree path passed in |
| `skills/gauntlet-resume/SKILL.md` | `<primary>` = `dirname "$(git rev-parse --path-format=absolute --git-common-dir)"` from the session cwd (absolute from any primary subdirectory and from inside a linked worktree); bare `<name>` then resolves as `<primary>/.worktrees/<name>`; the existing same-repository check at :64-66 stays |
| `skills/gauntlet-resume/reference/brief-contract.md` | cite pi-cohort `812de45` instead of `d737eb9` |

`skills/chase-bug/hotfix.md` belongs to #36 and is not touched.

### Lint

`scripts/ci.mjs` gains a check beside the `pi.settings` ban, scoped to every `.md` under the five stage-skill directories named by AC 7: `skills/brainstorming/`, `skills/writing-plans/`, `skills/subagent-driven-development/`, `skills/finishing-a-development-branch/`, `skills/using-git-worktrees/`. No allowlist.

Inside fenced code blocks, fail on:
- `cd` at statement start not opening a subshell: `(^|[;&|]\s*)cd\s` where the match is not immediately preceded by `(`; `$(cd ...)` fails, `(cd "$WT" && npm test)` passes;
- `\bgit\s+rev-parse\s+--show-toplevel` (any `git -C <p> rev-parse --show-toplevel` is a different token sequence and passes).

In prose, fail on the literal phrases `switch into the worktree` and `from inside the worktree` (case-insensitive).

Fixtures: a temp skill dir with each prohibited form fails; the subshell form and `git -C` form pass; the whole existing tree passes after the skill edits.

### Data flow

`using-git-worktrees` report -> absolute worktree path -> dispatch `cwd` / `git -C` / subshell -> artifact paths -> `checkoutOf` -> the checkout the runtime acts in. `ctx.cwd` is used only to resolve a relative input and to locate settings.

## Errors and edge cases

- `checkoutOf` returns `undefined`: plan_check `input` finding; settings fall back to `cwd`; Guard 2 does not block; telemetry skips the write with a warning.
- Git < 2.31: same `undefined` path; floor documented, not detected.
- Submodules also have `gitDir != commonDir`; already misclassified today, not raised by #37 - out of scope.
- `git merge -C x` is not a valid form, so the flags span is unambiguous; the grammar is bounded to the span before the subcommand.
- pi-cohort `/handoff` still emits `worktree: no` from a primary session (pi-cohort#17, open). gauntlet-resume's explicit `<worktree>` argument covers it; this spec assumes #17 lands `worktree: yes <absolute path>` without grammar change and does not depend on it.
- A brainstorm Guard 3 false positive on `> $SPEC` (variable redirect target) was observed this session; unrelated to cwd, out of scope.

## Testing

`node --test` files, registered in `scripts/ci.mjs:254-261`; the suite is `npm test`.

- `extensions/lib/checkout.test.ts` (new): `parseCheckout` - primary (`isPrimary: true`), linked worktree (`false`), nonzero code -> `undefined`, two lines -> `undefined`; `checkoutOf` with a stub runner - file path uses `dirname`, nonexistent leaf walks up to the existing ancestor.
- `phase-tracker-helpers.test.ts`: `parseGitCommand` for `git switch`, `git -C .worktrees/x switch -c y`, `git --no-pager -C p checkout -b y`, `cd .worktrees/x && git checkout -b y`; `parseGitCommit` unchanged results.
- `phase-tracker.test.ts`: Guard 2 in a `git init` primary with a linked worktree - `git switch -c y` from `<primary>/doc` blocks, `git -C <primary> switch -c y` blocks, `git -C <worktree> switch -c y` passes. `plan_check`: plan under `<primary>/.worktrees/x/doc/plans`, `Modify:` target present only in the worktree, `ctx.cwd` = `<primary>/doc` -> passes; plan in a non-git temp dir -> `input` finding.
- `gauntlet-settings-loader` test (new, `git init` fixture): `.pi/settings.json` at `<repo>` with `specCouncil`, `cwd` = `<repo>/doc` -> the value resolves; non-git dir -> falls back to `cwd`.
- `telemetry-paths.test.ts`: `matchShipStatement("git -C /p merge --squash f")` -> `{ option: "squash", statement: "git -C /p merge --squash f" }`; `git -C /p push` -> `pr`; `matchDiscardStatement` accepts `git -C /p worktree remove x`; `git -C /p log` -> `undefined`.
- `verify-before-ship.test.ts`: `git -C /p push` and `git -C /p merge --squash f` are ship events.
- `telemetry.test.ts` (`Deps` stub): bind `/repo/.worktrees/x/doc/specs/a.md` with `ctx.cwd` = `/repo`; assert add/commit cwd is `/repo/.worktrees/x` and the key is `doc/specs/a.md`; then observe `/repo/doc/specs/a.md` -> a fresh bind under `/repo`, no `git mv`.
- `ci.mjs` lint: fixtures per prohibited form fail; subshell and `git -C` forms pass; full tree passes.

## Documentation impact
- Feature / user-facing docs introduced: none
- Materially amended existing docs: `doc/configuration.md` (flow guards: Guard 2 evaluates the command's target checkout and is active from every primary subdirectory; `plan_check` roots at the plan's checkout; git 2.31 floor; one paragraph defining process-in-primary / work-by-path per AC 10), `README.md` (worktree contract paragraph: the three carriers), `skills/verification-before-completion/reference/settings-precedence.md` (settings resolve from the checkout toplevel of the session cwd), `CHANGELOG.md` Unreleased (names and links #37)
- Derived / memory docs invalidated: `AGENTS.md` Testing bullet gains the stage-skill lint clause

Skill bodies are implementation surface, not doc-impact entries.

## Out of scope

- pi-cohort#17 producer change; pi-gauntlet#36 hotfix implementer binding (`skills/chase-bug/hotfix.md` keeps its `cd "$PRIMARY_ROOT"` and is outside the lint scope).
- Submodule classification in `checkoutOf`.
- Any cache or session state recording the worktree.

## Acceptance criteria (from #37)

1. `plan_check` passes from `<primary>` and `<primary>/doc/` for a plan whose `Modify:` targets exist only in the worktree.
2. Pi launched from `<primary>/doc/` loads the repo `.pi/settings.json` `specCouncil` value.
3. Guard 2 behaves identically from `<primary>/doc/` and `<primary>`.
4. Finishing with a worktree path removes it before branch deletion; without one it stops and names the missing argument; re-entering worktree setup with an existing path creates nothing.
5. Ship verification (`verify-before-ship`) detects `git -C <worktree> push` and `git -C <worktree> merge --squash`.
6. An end-to-end run from `<primary>/doc/` carries the worktree as dispatch `cwd` through brainstorming, writing-plans, and subagent-driven-development; finishing removes it.
7. The five stage skills (brainstorming, writing-plans, subagent-driven-development, finishing-a-development-branch, using-git-worktrees) contain no non-subshell `cd`, no "switch into the worktree" prose, and no `--show-toplevel` derivation - enforced by the lint.
8. Telemetry for a worktree run commits on the worktree branch when the session cwd is the primary.
9. gauntlet-resume derives an absolute `<primary>` from a subdirectory; brief-contract cites a pi-cohort commit reachable from its `main`.
10. `doc/configuration.md` contains the process-in-primary / work-by-path paragraph and states guards are active from all primary subdirectories.
