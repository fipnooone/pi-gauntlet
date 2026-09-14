# Human overrule of the conformance fix-round cap

**Goal:** Give an explicit human approval of "N more fix rounds" an executable, replay-safe form: a `phase_tracker` action `grant_fix_rounds` that lets the conformance cap gate in `extensions/phase-tracker.ts` pass N further implementer waves. Rewrite the cap-block message to lead with that action and to describe the `enforce: false` escape correctly (exact file, applies immediately, whole-block precedence). Register `gauntlet_setting` as `executionMode: "sequential"` so a same-message write-then-verify reads post-write. Teach the conformance loop prose that an explicit approval re-enters the loop.

Supersedes `doc/specs/2026-09-13-conformance-dispatch-guard.md` for its cap-block escalation paths only: Decisions row "Switch" (escape enumeration), section 3.2 table row 2 (cap block text), section 4 final bullet (documented escapes). The round counter, wave counting, and shape guards defined there are unchanged.

## 1. Problem

The cap guard (`phase-tracker.ts:545-547`) blocks any implementer-containing `subagent` dispatch once `fixRounds >= closureReview.maxFixRounds` with the text at `:209-212`: "escalate to the human with the verdict trail instead of re-looping. To disable this gate, set piGauntlet.closureReview.enforce: false."

The escalation has no executable answer. When the human replies "one more round", the only state changes that clear the counter are `start implement` and `reset` (`:449-454`, `:915-916`, `:1081-1082`), both of which discard the verify phase, and `enforce: false`, which disables all three closure guards (cap, lone implementer, model match), not just the cap. The loop prose the model actually follows (`skills/verification-before-completion/reference/conformance-check.md` step 6, Convergence step c) declares escalation the sole terminal state, so even a model that knew about a grant would read the loop as over.

Observed in a consumer session on 2026-09-13: after wave 3 of 3, the human acked an extra round; the model reached for `enforce: false`, edited a worktree's `.pi/settings.json` instead of the session cwd's, then verified each write with a `gauntlet_setting` call batched in the same assistant message as the bash write. Pi executes a batch in parallel unless a tool in it declares `executionMode: "sequential"` (`phase_tracker` does at `:840`; `gauntlet_setting` at `:727-744` does not), so every read raced the write and returned the stale value. The model concluded a restart was needed and restored the file. The human's approval was never acted on.

The block itself is correct and stays (the prose-only version of the cap was measured not to hold; see the predecessor spec's Problem section). What is missing is a binding form for the human's "yes".

## 2. Decisions

- A human approval is recorded by the model as a `phase_tracker` tool call, quoting the human. The extension never parses chat text. This mirrors the existing closure waiver (`skip verify` with a reason, `:124-131`).
- The approval is a credit pool of N rounds, not a cap increase. Each qualifying implementer wave spends one credit; `fixRounds` keeps counting, so history shows the true total and which waves the approval paid for.
- A grant is accepted only while the cap block is live in the parent session. No stockpiling ahead of the brake, no stacking on top of unspent credits.
- Credits exempt only countable waves. Shape guards (lone implementer, model match) and the async-at-cap block are untouched: a grant buys rounds that can be counted, never a shape waiver.
- Consumption reads no settings: while credits exist, every qualifying wave spends one. Grants are only possible at the cap and `fixRounds` only grows until reset, so this is equivalent to "spend when at cap" without depending on the cap value at replay time.
- Credits reset exactly where `fixRounds` resets: `start implement`, `reset`, and the start of a replay walk. `start verify` with `force` preserves both.
- Argument validation happens once, in the tool schema: `rounds` is `Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })`. The existing `reason` parameter is reused, not duplicated.
- No new tool, no new settings key, no config-shape change. The `enforce: false` escape stays, documented correctly, as the last resort.
- `gauntlet_setting` becomes `executionMode: "sequential"`. Pi runs a batch containing any sequential tool one call at a time in message order (`executeToolCallsSequential`), which is exactly what a `[bash write, gauntlet_setting verify]` batch needs.

## 3. Design

### 3.1 State

`let fixRoundCredits = 0;` beside `let fixRounds = 0;` (`:330`). Session-live, rebuilt by replay (3.5); nothing persisted elsewhere.

### 3.2 Action `grant_fix_rounds`

Schema changes to `PhaseTrackerParams`:

- `action` enum gains `"grant_fix_rounds"`.
- New `rounds: Type.Optional(Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER, description: "Extra fix rounds the human explicitly approved (grant_fix_rounds only)" }))`.
- Existing `reason` (`:266-270`) description becomes `"Reason (required for skip and grant_fix_rounds; for grant, the human's approval quoted)"`. `skip` validation is unchanged.

`PhaseTrackerDetails.action` (`:58-62`) gains `"grant_fix_rounds"`; the interface gains `rounds?: number` and `reason?: string`.

Execute-time validation, in order; the first failure returns an error result with `details: { action: "grant_fix_rounds", phases, error }` (no `rounds`) and changes no state:

| Check | Error text |
|---|---|
| `rounds === undefined` (pi's schema validation already rejects non-integers, `< 1`, and unsafe integers before `execute`) | `grant_fix_rounds requires rounds: a positive integer` |
| `reason` missing or empty after trim | `grant_fix_rounds requires reason: the human's approval, quoted` |
| cap block not live: `isSubagentChild`, flow not entered, `verify` not `in_progress`, `conformanceDispatched` false, `enforce` false, or `fixRounds < maxFixRounds` (settings via `loadGauntletSettings(ctx.cwd)`) | `grant_fix_rounds: no fix-round cap block is active (<fixRounds> used, cap <cap>); nothing to overrule` |
| `fixRoundCredits > 0` | `grant_fix_rounds: <fixRoundCredits> granted round(s) still unused; spend them before granting more` |

Success: `fixRoundCredits = rounds`. Result text: `Granted <rounds> extra fix round(s) - reason: "<reason>"` followed by the phase listing. `details: { action: "grant_fix_rounds", rounds, reason, phases }`. `renderResult` (`:1123-1165`) gains a `grant_fix_rounds` case rendering the granted count and the reason; today it would fall through to the dim `Done`.

### 3.3 Cap gate

The cap branch at `:547` becomes:

```ts
if (fixRounds >= cap) {
  const funded = fixRoundCredits > 0 && input.async !== true;
  if (!funded) return { block: true, reason: fixRoundCapBlockReason(fixRounds, cap, settingsPath) };
}
```

`settingsPath = join(ctx.cwd, ".pi", "settings.json")` is computed in the `tool_call` handler from its `ctx` argument. `async: true` implementer dispatches stay blocked at the cap regardless of credits: their results carry `results: []` and would never spend a credit (predecessor section 4). The lone-implementer check at `:542-543` and the model-match guard run as today. A blocked dispatch spends no credit.

### 3.4 Consumption

`observeFixWave` (`:335-345`) keeps its qualification predicate unchanged (top-level `subagent` result, flow entered, `verify` in progress, `conformanceDispatched`, enforcement on, non-error result carrying an `implementer` child). Its body becomes:

```ts
if (fixRoundCredits > 0) fixRoundCredits -= 1;
fixRounds += 1;
```

No cap read. Because a grant is only accepted at the cap and `fixRounds` only grows until a reset that also zeroes credits, "credits exist" implies "at cap" - so the rule is equivalent to spend-at-cap without making replay depend on the cap value on disk at replay time.

### 3.5 Replay

`reconstructState` (`:419-467`):

- walk start (`:420-424`): add `fixRoundCredits = 0;` beside `fixRounds = 0;`, so a switch onto a grant-free branch never keeps stale credits;
- inside the existing `if (details && !details.error)` block (`:445`), after `phases = details.phases`: `if (details.action === "grant_fix_rounds" && typeof details.rounds === "number") fixRoundCredits = details.rounds;` - rejected grants carry no `rounds` and are excluded by the error guard anyway;
- the existing `start implement` and `reset` branches (`:449-454`) also set `fixRoundCredits = 0`;
- `subagent` results flow through the same `observeFixWave` (`:466`), so credits are spent during replay as they were live.

A session recorded before this change contains no grant results and replays to `fixRoundCredits = 0`. Replay under a different `enforce` value than the live run diverges for credits exactly as it already does for `fixRounds` (the observer only counts enforced waves); that behaviour is inherited, not introduced.

### 3.6 Live resets

The live `start implement` path (`:915-916`) and `reset` (`:1081-1082`) set `fixRoundCredits = 0` alongside `fixRounds = 0`. `start verify` with `force` does not touch either.

### 3.7 Block message

`fixRoundCapBlockReason(used, cap, settingsPath)`. Text:

```
Conformance fix loop: <used> fix round(s) used against a cap of <cap> (granted rounds included); escalate to the human with the verdict trail instead of re-looping.
If the human explicitly approves more rounds, record it and retry as a tasks wave: phase_tracker({ action: "grant_fix_rounds", rounds: <N>, reason: "<their words>" }).
Last resort: set piGauntlet.closureReview.enforce: false in <settingsPath> (disables all closure guards; applies on the next tool call, no restart - a gauntlet_setting read in the same message sees the write; a repo closureReview block replaces the preset's whole block, so restate model and maxFixRounds alongside).
```

The lone-implementer message (`:204-207`) is unchanged.

### 3.8 `gauntlet_setting` registration

Add `executionMode: "sequential"` to the `registerTool` call at `:727`. Behaviour and payload unchanged.

### 3.9 Loop prose

`skills/verification-before-completion/reference/conformance-check.md`:

- step 6 (escalation at the cap): after the escalation sentence, add "If the human explicitly approves N more rounds, record `phase_tracker({ action: "grant_fix_rounds", rounds: N, reason: "<their words>" })` and re-enter step 2; without that approval, escalation stays terminal."
- Convergence step c "Any at the cap -> escalate per step 6": the same pointer, by reference to step 6.

## 4. Edge cases

| Situation | Behaviour |
|---|---|
| Session restart with credits unspent | Replay rebuilds the pool from the grant result and subsequent wave results (3.5) |
| Session switch onto a branch with no grant | Credits zero (walk-start reset) |
| `maxFixRounds` changed on disk between live run and replay | No effect on credits: consumption reads no settings (3.4) |
| `start implement` or `reset` with credits unspent | Credits forfeited, same as `fixRounds` |
| `start verify` `force` | Credits preserved, same as `fixRounds` |
| Lone implementer or model-match block with credits unspent | Blocked; pool untouched |
| `async: true` implementer dispatch at the cap with credits | Blocked (3.3) - it could never spend a credit |
| `enforce` flipped false with credits unspent | Gate and observer already no-op; grant rejected while off; existing credits wait unchanged |
| Grant at `fixRounds < cap` | Rejected; the paid round is dispatched first, the grant recorded when the block fires |
| Grant from a subagent child (`PI_SUBAGENT_DEPTH >= 1`), including `maxFixRounds: 0` | Rejected: the child's gate is dormant, credits there would be unusable |
| Two implementer-containing calls in one assistant message with one credit | Both pass the gate; both count. Inherited from result-time counting (predecessor: block at `tool_call`, count at `tool_result` - the same message at `cap - 1` overshoots today). The loop dispatches one wave per message, so the second call is already off-protocol; not addressed here |
| `rounds` at `Number.MAX_SAFE_INTEGER` | Accepted by schema, decrements correctly; larger values are rejected by the schema |
| `maxFixRounds: 0` | Cap fires on the first wave; a grant then works as for any other cap |

## 5. Tests

`extensions/phase-tracker.test.ts`, new `describe` beside the cap suite at `:1266`, reusing its branch and settings builders. TDD for the runtime change: the tests naming new behaviour are red before it lands; later coverage repairs assert behaviour already present and are green on arrival.

1. Cap at 3, `grant_fix_rounds(2, ...)` -> waves 4 and 5 pass the gate, wave 6 blocks; `fixRounds` reads 5.
2. Schema: `rounds` is `Type.Integer` with `minimum: 1` and `maximum: Number.MAX_SAFE_INTEGER` (assert the registered parameter schema); execute with `rounds` undefined or empty `reason` returns the table's error text, `details` has no `rounds`, state unchanged.
3. Grant rejected when cap not live: before the audit, in `implement`, at `fixRounds = cap - 1`, with `enforce: false`, and from a child (`PI_SUBAGENT_DEPTH=1`) at `maxFixRounds: 0`.
4. Grant rejected while credits unspent, with the count in the text.
5. Exactly one credit spent per qualifying wave; a non-implementer wave and a child result spend none.
6. Lone implementer still blocked with credits unspent; `async: true` implementer wave blocked at the cap with credits unspent; pool unchanged after both.
7. Replay: branch with audit, 3 waves, grant(2), 1 wave -> `session_start` reconstructs `fixRoundCredits = 1`, `fixRounds = 4`; next wave passes, the one after blocks (mirror `:1369-1420`). Same branch replayed with `maxFixRounds: 5` on disk yields the same credits. A branch with a rejected grant (error result) followed by nothing yields `0`.
8. `start implement` and `reset` zero credits (live and replay); `start verify` `force` preserves them.
9. Block reason contains `grant_fix_rounds`, the resolved `<cwd>/.pi/settings.json` path, and "no restart".
10. `gauntlet_setting` registration has `executionMode: "sequential"` (extend the assertion pattern at `:353-356`).
11. `renderResult` for a `grant_fix_rounds` details object includes the count and reason.

`npm test` (`scripts/ci.mjs`) stays green.

## 6. Out of scope

- Convergence-based (rather than round-count) cap heuristics - issue #7.
- Any change to the lone-implementer or model-match guards.
- Gate-time credit reservation for same-message parallel waves (inherited result-time counting; see section 4).
- Exposing `fixRoundCredits` in `phase_tracker status` output.
- A `settingsPath` field in the `gauntlet_setting` payload.
- Ordering guarantees across assistant messages (sequential execution orders calls within one batch only).

## 7. Rollback

Revert one commit. Credits exist only in session state; a session containing grant results replayed by pre-change code ignores the unknown `details.action` and reconstructs as before.

## Documentation impact
- Feature / user-facing docs introduced: none
- Materially amended existing docs: `doc/configuration.md` (line 69 `phase_tracker` contract gains `"grant_fix_rounds"` and `rounds?`; the `closureReview.maxFixRounds` paragraph and the "Fix-round cap" guard bullet gain the grant action and the rewritten block guidance; the `gauntlet_setting` paragraph notes sequential execution); `doc/specs/2026-09-13-conformance-dispatch-guard.md` (supersession banner only); `CHANGELOG.md` (new `## Unreleased` entry)
- Derived / memory docs invalidated: none
