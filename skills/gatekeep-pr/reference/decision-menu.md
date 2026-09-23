# gatekeep-pr: decision menu

Read from SKILL.md `## Decide`. `## Decision` in the report has two parts: the
action vocabulary, then the numbered courses.

## Actions

```markdown
Actions (compose freely in the custom row):
  fix <P#s|all>    apply blocking fixes in worktree, re-run gate, push  (in-repo PRs only)
  push-docs        push already-applied doc-drift edits                 (only when uncommitted
                                                                        reviewed doc edits exist
                                                                        in the worktree)
  merge-squash | merge-commit                                          (preconditions per Verdict;
                                                                        never bundled with a push,
                                                                        except the telemetry: restore commit)
  request-changes | review-comment | approve                           (approve: never own PR)
  reply <C#s>      post drafted thread replies
  tracker <act>    tracker action                                      (only when a tracker tool resolved)
  stop             leave the PR as-is / report-only exit
```

A `+ tracker <act>` suffix is available on any mutation course when a tracker tool
resolved.

Selection grammar: ID sets accept `all`, ranges (`P1-P4`), comma lists
(`P1,P3`), and exclusions (`all but P2`).

## Consent table

Deterministic - this table is the golden-scenario oracle.

| Author | State | Offered rows (first = `[recommended]`) |
|---|---|---|
| you | clean / follow-ups only | merge (squash); merge (merge-commit); do not merge (leave it); post no-blockers comment |
| you | blocking | apply code fixes (named finding subset): skill edits in worktree, commits, re-runs gate, pushes - then merge re-offered; push applied doc fixes; do not act; post review-comment of findings |
| someone else | clean / follow-ups only | approve; merge (squash, offered-unrecommended); post no-blockers comment |
| someone else | blocking | post request-changes review; apply fixes on their branch (courtesy option 2); reply to existing threads; post comment |
| bot author | any | someone-else's rows for the same state, review actions recommended |
| fork (any) | any | post review (request-changes / comment / approve per state) - push and merge rows absent |
| any | draft PR | assessment rows only; merge and approve rows absent until ready-for-review |
| any | merged / closed | report-only; no mutation rows |

This table is the single oracle for what is offered; `## Courses` renders its
rows as actions and numbered courses. Rows GitHub would refuse (branch protection,
missing permissions, `viewerPermission` too low) render listed-but-unavailable with
the reason. Approving your own PR is never offered. Nothing executes until explicit
selection.

## Courses

A normative rendering of the consent table (never a second offer source): per
author x state cell, exactly one `[recommended]` course renders first, the custom
row renders last. Courses are atomic across pushes: no course, pre-composed or
custom, bundles a push-producing action (`fix`, `push-docs`) with `merge-*`; after
a fix wave the menu re-renders with merge as row 1.

| Author | State | Courses (first = `[recommended]`) |
|---|---|---|
| you | clean / follow-ups only | 1. merge-squash; 2. merge-commit; 3. stop; 4. review-comment (post no-blockers note) |
| you | blocking | 1. fix (worktree-fixable P#s only - `all` covers only those) [+ push-docs when uncommitted doc edits exist]; 2. push-docs (alone, when doc edits exist); 3. stop; 4. review-comment (post findings). When no P# is worktree-fixable (blocking is failing-check-only or L#-only), course 1 (fix) does not render: push-docs becomes first when doc edits exist, else stop is first |
| you | blocking, post-fix re-render (gate green, preconditions hold) | 1. merge-squash; 2. merge-commit; 3. stop; 4. review-comment |
| someone else | clean / follow-ups only | 1. approve; 2. merge-squash (offered-unrecommended); 3. review-comment (no-blockers note) |
| someone else | blocking | 1. request-changes; 2. fix all (courtesy, their branch - omitted when nothing is worktree-fixable); 3. reply <C#s> (omitted when the `C#` group is None); 4. review-comment |
| bot author | any | someone-else's rows for the same state; review actions recommended |
| any | draft | 1. request-changes / review-comment / reply <C#s> (omit the reply course when the `C#` group is None) / stop - `[recommended]` follows the same authorship rule as the non-draft cells, except on your own draft PR `request-changes` is never recommended (you cannot request changes on your own PR any more than you can approve it); the fallback recommendation there is `review-comment` when findings exist, else `stop`. Custom present but cannot compose `merge-*`/`approve`/`fix`/`push-docs` until ready-for-review |
| any | merged / closed | 1. stop; report-only, no other mutation courses at all; Custom present but cannot compose `merge-*`/`approve`/`fix`/`push-docs`/`request-changes`/`review-comment`/`reply`/`tracker` - nothing remains actionable |

## Fork overlay

The consent-table fork row renders as an overlay on the authorship cells
(push/merge/fix absent; approve also dropped when the viewer authored the PR) - it
is not a distinct authorship cell. It overlays the applicable authorship cell (you
or someone else), removing `fix`, `push-docs`, and `merge-*` (never available on a
fork). When you authored the fork PR, `approve` is also dropped (never offered on
your own PR) - fork|you|clean renders `review-comment`/`stop` only; fork|you|blocking
renders `request-changes`/`review-comment`/`stop` (the someone-else courtesy
fix-on-their-branch course is also absent, since it is your own PR). A fork PR
authored by someone else uses the someone-else cells with `fix`/`push-docs`/
`merge-*` removed.

## CI-check gate

An undispositioned failing check in the resolved set, or a pending required check,
withholds every pre-composed course containing `merge-*` (merge preconditions per
SKILL.md `## Verdict`) - none render, whatever the author/state cell says.
Disposition and pending-check definitions per `findings.md` `## Dispositions`.

| Disposition | Merge courses |
|---|---|
| Flaky | Not restored to a pre-composed course; merge proceeds only via the custom row naming the disposition explicitly |
| Real, or an unresolved pending check | Withheld until the check is green |
| CI-infrastructure-broken | Withheld until the triggered fallback run is green |

A pending-only render is not itself a blocking verdict (findings groups can all
read "None"); the recommended course falls to `stop` or `review-comment` in the
meantime. This never falls through to the clean cell's recommended `merge-squash` -
a failing resolved-set check or a pending required check means the PR is not in the
clean state to begin with.

## Fixtures

Refused rows render per `## Consent table`. Zero mutation courses is a legal
render (merged/closed) - the menu still appears, carrying findings and `stop`.

Example render (golden fixture 1 - own PR, blocking findings including committed
doc drift, so uncommitted reviewed doc edits exist):

```markdown
Pick one:
  1. fix all (P1-P10) + push-docs   [recommended]
  2. push-docs (docs only, hold code fixes)
  3. stop (leave as-is)
  4. review-comment (post findings, act later)
  5. Custom - compose: e.g. "fix P1-P8,P10 + push-docs" or "reply C1 + tracker comment"
```

Golden fixture 2 - the post-fix re-render after course 1's gate re-run passes:

```markdown
Pick one:
  1. merge-squash   [recommended]
  2. merge-commit
  3. stop (leave as-is)
  4. review-comment
  5. Custom
```
