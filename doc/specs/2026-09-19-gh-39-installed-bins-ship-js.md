# Installed bins ship bundled JavaScript: no runtime .ts imports under node_modules

**Goal:** Both shipped CLI entrypoints - `gauntlet-telemetry-salvage` and `gauntlet-performance` - run correctly from an npm-installed copy under `node_modules` on Node >= 22.6 with type stripping enabled. Their esbuild-bundled, self-contained JavaScript (with `yaml` external) is committed at the unchanged paths `bin/gauntlet-telemetry-salvage.mjs` and `bin/gauntlet-performance.mjs`; CI proves the packed artifact works from a scratch `node_modules` install, and the verify phase proves it from a real pi install layout.

Ticket: #39 (<https://github.com/jjuraszek/pi-gauntlet/issues/39>). The issue scopes the fix to `gauntlet-telemetry-salvage` because salvage was believed to be the only affected bin; the questionary established that `bin/gauntlet-performance.mjs:10` imports `extensions/lib/gauntlet-settings.ts` and crashes identically (bin added in 8724376, shipped in 5.12.0, after #39 was filed). The user approved covering both bins with one mechanism: "the sane issue class covered everywhere."

Supersedes: `doc/specs/2026-09-18-telemetry-record-deliverable.md` (the salvage bin's "plain `.mjs` importing `.ts` helpers" implementation convention and its pack/test assertions), `doc/specs/2026-09-18-gh-35-gauntlet-performance-telemetry-report.md` (the performance bin implementation and CI pack-check sections). Both predecessors' behavioral designs - record semantics, salvage verdicts, digest semantics - stay live; only the runtime-import and packaging decisions change.

## Problem

Fault story: an npm-installed copy runs `bin/gauntlet-telemetry-salvage.mjs` (or `bin/gauntlet-performance.mjs`) from under `node_modules` -> the bin imports `../extensions/lib/*.ts` directly -> Node's built-in type stripping refuses `.ts` files under `node_modules` -> startup crashes with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` before any work, on every installed copy with strip-types on (Node >= 22.6; reproduced on v26.5.1).

Verified facts the design depends on:

| Claim | Evidence |
|---|---|
| Salvage bin imports four `.ts` helpers directly | `bin/gauntlet-telemetry-salvage.mjs:12-15`: `gauntlet-settings.ts`, `telemetry-paths.ts`, `telemetry-ship.ts`, `telemetry-record.ts` |
| Performance bin imports one `.ts` helper directly | `bin/gauntlet-performance.mjs:10`: `gauntlet-settings.ts` |
| Installed copy crashes, source checkout does not | Reproduced 2026-09-19 from `~/.pi/agent.balanced/npm/node_modules/pi-gauntlet` on Node v26.5.1: both bins fail at the `gauntlet-settings.ts` import; repo-checkout invocation succeeds because the imports resolve outside `node_modules` |
| `yaml` is the only runtime dependency | `package.json:57-60`; performance imports it directly, salvage transitively via `telemetry-record.ts` |
| No build tooling exists in the repo | `package.json:52-60`: scripts are `postinstall`, `link-agents`, `test` only; no tsconfig or bundler config anywhere |
| Pi loads `extensions/*.ts` through its own extension runtime | `package.json:43-51` declares TypeScript extension entrypoints; that path was never broken and is out of scope |
| Existing pack assertions require the `.ts` helpers in the tarball | `scripts/ci.mjs:455-478` - the helpers remain runtime dependencies of the shipped Pi extensions (which import them), so the assertions stay; only their obsolete bin-runtime rationale changes |
| Bin tests invoke the CLI as a child process at `bin/*.mjs` | `bin/gauntlet-telemetry-salvage.test.mjs`, `bin/gauntlet-performance.test.mjs`; run by `scripts/ci.mjs:300-331` |
| The helper graph is pure and Pi-free by design | `extensions/lib/gauntlet-settings.ts:3-6` - bundling it needs no Pi runtime stubbing |
| Skills and users invoke the bins by path | `node bin/gauntlet-telemetry-salvage.mjs` is a documented contract (#39 hard constraint; `README.md:127`, `doc/configuration.md:133`) |

## Design

### Layout and build

1. **Bin sources move** (`git mv`) to a non-shipped directory: `src/bins/gauntlet-telemetry-salvage.mjs` and `src/bins/gauntlet-performance.mjs`. The five relative import specifiers (`src` is a new tree level) are rewritten from `../extensions/lib/*.ts` to `../../extensions/lib/*.ts` - salvage's four (`bin/gauntlet-telemetry-salvage.mjs:12-15`) and performance's one (`bin/gauntlet-performance.mjs:10`). Nothing else in the sources changes. `src/` is **not** added to the `package.json` `files` allowlist; the tarball contents keep today's shape.
2. **`esbuild` becomes the only devDependency, pinned to an exact version** (no caret). `package-lock.json` stays gitignored and CI runs `npm install`, so a ranged version would let a new esbuild release change the emitted bytes and trip the freshness check with no repo change. No tsconfig, no other build tooling.
3. **`scripts/build-bins.mjs`** (new) bundles each entrypoint with `--bundle --format=esm --platform=node --external:yaml` and writes output to exactly `bin/gauntlet-telemetry-salvage.mjs` / `bin/gauntlet-performance.mjs`, preserving the shebang and setting the executable bit. It sets esbuild's working directory to the repo root regardless of invocation cwd (generated path comments are cwd-relative, so a non-root invocation would produce different bytes and trip freshness). `yaml` stays external and remains the sole runtime dependency. The bundles are **committed**; nothing is generated at pack/publish/install time (a `prepack` lifecycle was rejected: `pi install -l` symlink installs bypass packing and would serve stale or missing bins, and correctness would depend on lifecycle ordering instead of a diffable file).
4. **`package.json`** gains `"build:bins": "node scripts/build-bins.mjs"`; the `bin` map, `files` allowlist, and `engines` floor are unchanged.

### Data flow

Edit a helper (`extensions/lib/*.ts`) or a bin source (`src/bins/*.mjs`) -> `npm run build:bins` regenerates both bundles -> sources and bundles are committed together -> `npm pack` ships `bin/` + `extensions/` as today -> the installed copy under `node_modules` runs a bundle that never asks Node to strip types. No shipped bin imports `.ts`, so `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` cannot fire.

### CI (`scripts/ci.mjs`)

1. **Freshness check:** run `node scripts/build-bins.mjs` before the bin unit-test block (so the tests exercise the rebuilt artifact), then fail on any output of `git status --porcelain -- bin/` (catches untracked bundles, which `git diff` alone misses); the failure message names `npm run build:bins` as the remedy. Runs inside `npm test`, so the release flow inherits it.
2. **Pack assertions, extended:** all existing assertions stay - the `extensions/lib/*.ts` helper-presence checks (re-labeled as Pi-extension packaging protection: the shipped extensions still import those helpers) and the leak checks (`agents/`, no `doc/`, no `.claude-plugin/`). Added alongside: the tarball must contain both bundles; **no** shipped file under `bin/` may contain a relative `.ts` import (class-wide - a future third bin added without a build entrypoint fails here even if `build-bins.mjs` was never updated); each bundle's first line is `#!/usr/bin/env node`.
3. **Packed-install smoke test** (no `npm install` of the tarball - its `postinstall` would re-point persona links in the real `~/.pi/agent*` dirs at the scratch copy): `npm pack --pack-destination <scratch>` (never the repo root), `tar xzf` the tarball into `<scratch>/node_modules/pi-gauntlet`, and satisfy the external `yaml` by symlinking the repo's `node_modules/yaml` to `<scratch>/node_modules/yaml` (sibling resolution, no network, no lifecycle scripts). Then, with `PI_CODING_AGENT_DIR` pointed at an empty scratch dir (ambient preset settings can disable telemetry and change the verdict), run from the scratch layout:
   - the #39 AC-1 literal invocation: `node node_modules/pi-gauntlet/bin/gauntlet-telemetry-salvage.mjs --worktree <empty non-git dir> --base origin/main` - expect exit 0 and stderr free of `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` (this invocation prints `not a git worktree`; that is a startup diagnostic, not a detect-only verdict, and does not satisfy AC 2 by itself);
   - the detect-only verdict run: same bin against a disposable git fixture (`git init` + one empty commit + `git update-ref refs/remotes/origin/main HEAD`) as `--worktree`, `--base origin/main` - expect exit 0 and stdout exactly `no spec on branch`;
   - `node node_modules/pi-gauntlet/bin/gauntlet-performance.mjs --dir <empty scratch dir>` - expect exit 0 and stdout containing `no records found` (without `--dir`, the bin derives its corpus from the cwd's git toplevel and would read the repo's real telemetry);
   - all three: stderr must not contain `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`.
4. **Existing bin tests** stay at `bin/*.test.mjs`, unchanged; they now exercise the exact shipped artifact, rebuilt by the freshness step just before they run.

### Sanity run (manual: verify phase, finish, post-release)

A linked install cannot reproduce the bug class - `pi install -l` registers the worktree path without copying, so the bins resolve outside `node_modules` and would have passed before this fix. The sanity run therefore uses a **copied** install: `npm pack --pack-destination <scratch>` from the worktree, then `npm install <tgz> --prefix ~/.pi/<profile>/npm --ignore-scripts` (or unpack over `~/.pi/<profile>/npm/node_modules/pi-gauntlet`), verify with `realpath` that the executed bin resolves beneath that profile's `node_modules/pi-gauntlet`, and run both bins there on Node v26.5.1.

The copied install then **stays in place through the finish phase**: finishing-a-development-branch's restore step invokes the installed salvage bin (`<bin>` resolves from the installed package's skill directory), and that finish-time invocation is the real-session exercise of the fix. Restoring the profile to a registry build is **out of scope for this workflow** (rescoped at the finish gate): the registry build at finish time is the unfixed 5.12.0, so an in-flow restore would reintroduce the bug the finish step depends on being fixed. The profile keeps the copied build until the user reinstalls at their discretion (`pi install npm:pi-gauntlet` once a release carries this fix).

### Out of scope

- `extensions/*.ts` keep shipping as TypeScript; Pi's extension loading contract is untouched.
- No conversion of `bin/gauntlet-spec-index.mjs` - it is already self-contained plain JS with no `.ts` imports (verified).
- No Node loader flags, no `engines` bump, no runtime dependency changes.

## Errors and edges

| Case | Handling |
|---|---|
| Fresh clone, `npm install` not run | `build-bins.mjs` fails fast with esbuild's resolution error; `npm test` surfaces it first |
| Stale, hand-edited, or untracked bundle | Freshness check (`git status --porcelain -- bin/`) fails with the remedy in the message; bundles are never edited by hand |
| esbuild release drift changes emitted bytes | Exact-version pin in `package.json`; regenerating on a pin bump is a deliberate commit |
| Tarball `postinstall` mutating the real agent dir during smoke | Smoke test never runs `npm install` on the tarball - `tar xzf` unpack only, `yaml` provided by sibling symlink |
| Ambient preset settings disabling telemetry during smoke | `PI_CODING_AGENT_DIR` points at an empty scratch dir for all three smoke runs |
| `yaml` wrongly inlined or dropped | Smoke test resolves `yaml` as a real sibling dependency, exactly as an installed copy does |
| New bin added without a build entrypoint | Class-wide pack assertion (no relative `.ts` import under `bin/`) fails the pack check |
| Shebang lost in a bundler upgrade | Pack assertion on line 1 of each bundle |

## Tests

- Unchanged: `bin/gauntlet-telemetry-salvage.test.mjs`, `bin/gauntlet-performance.test.mjs` (now run against the committed bundles).
- New in `scripts/ci.mjs`: freshness check (build before the bin tests, `git status --porcelain -- bin/`); extended pack assertions (bundles present, no relative `.ts` import under `bin/`, shebang intact - alongside the retained extension/leak assertions); packed-install smoke test for both bins as specified above.
- Verify phase: the copied-install sanity run of both bins from a real pi profile's `npm/node_modules/pi-gauntlet` on Node v26.5.1.

## Documentation impact

- Feature / user-facing docs introduced: none
- Materially amended existing docs: AGENTS.md (Testing bullet gains the bin-build step and the "new bins live in `src/bins/`, bundles are committed" convention); CHANGELOG.md (Unreleased entry, shipped in the same commit)
- Derived / memory docs invalidated: none (`README.md:127` and `doc/configuration.md:133` document the bins by their unchanged `bin/*.mjs` invocation paths and stay accurate)

## Open questions

None - all candidates from the gather were resolved in the questionary: scope covers both bins (Q1), the mechanism is a dev-only bundler with no manual JS migration (Q2), and the approach is committed esbuild bundles with CI freshness plus packed-install smoke coverage (approach round). Node versions: the automated smoke runs under whatever Node executes `npm test` (Node 24 in CI per `.github/workflows/test.yml` - type stripping is on by default there, so the bug class is still exercised); the Node v26.5.1 evidence for #39's AC 1 comes from the verify-phase sanity run, matching the original repro environment.
