import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aggregateNumstat,
  classifyBucket,
  isPlanPath,
  isSpecPath,
  isSupersededByBanner,
  matchDiscardStatement,
  matchShipStatement,
  matchTestStatement,
  parseSpecLinks,
  planSpecHeader,
  recordPathFor,
  repoRelativeToolPath,
  truncateCommand,
} from "./telemetry-paths.ts";
import { DEFAULT_TELEMETRY_BUCKETS, DEFAULT_TEST_COMMANDS } from "./gauntlet-settings.ts";

test("recordPathFor maps <dir>/<spec .md -> .yaml> preserving nesting", () => {
  assert.equal(recordPathFor(".pi/gauntlet/telemetry", "doc/specs/x.md"), ".pi/gauntlet/telemetry/doc/specs/x.yaml");
  assert.equal(recordPathFor("t", "svc/doc/specs/2026-01-01-a.md"), "t/svc/doc/specs/2026-01-01-a.yaml");
});

test("repoRelativeToolPath resolves like pi tools: relative to cwd, then repo-relative", () => {
  assert.equal(repoRelativeToolPath("/repo", "/repo", "doc/specs/a.md"), "doc/specs/a.md");
  assert.equal(repoRelativeToolPath("/repo", "/repo/svc", "doc/specs/a.md"), "svc/doc/specs/a.md");
  assert.equal(repoRelativeToolPath("/repo", "/repo/svc", "/repo/doc/specs/a.md"), "doc/specs/a.md");
  assert.equal(repoRelativeToolPath("/repo", "/repo", "/elsewhere/x.md"), undefined);
});

test("isSpecPath / isPlanPath match **/doc/specs/*.md and **/doc/plans/*.md only", () => {
  assert.ok(isSpecPath("doc/specs/a.md"));
  assert.ok(isSpecPath("svc/doc/specs/a.md"));
  assert.equal(isSpecPath("doc/specs/sub/a.md"), false);
  assert.equal(isSpecPath("doc/plans/a.md"), false);
  assert.ok(isPlanPath("doc/plans/a.md"));
});

test("planSpecHeader extracts the **Spec:** path", () => {
  assert.equal(planSpecHeader("# P\n\n**Spec:** `doc/specs/a.md`\n"), "doc/specs/a.md");
  assert.equal(planSpecHeader("**Spec:** doc/specs/a.md"), "doc/specs/a.md");
  assert.equal(planSpecHeader("no header"), undefined);
});

test("matchShipStatement needs a statement start (STMT_START)", () => {
  assert.deepEqual(matchShipStatement("git merge --squash gh-33 && git commit"), { option: "squash", statement: "git merge --squash gh-33" });
  assert.deepEqual(matchShipStatement("cd x; git push -u origin HEAD"), { option: "pr", statement: "git push -u origin HEAD" });
  assert.equal(matchShipStatement('gh pr create --fill')?.option, "pr");
  assert.equal(matchShipStatement('rg "git push" skills/'), undefined);
  assert.equal(matchShipStatement("echo git push"), undefined);
});

test("matchDiscardStatement matches worktree remove and branch -D", () => {
  assert.equal(matchDiscardStatement("git worktree remove .worktrees/x"), "git worktree remove .worktrees/x");
  assert.equal(matchDiscardStatement("cd .. && git branch -D gh-33"), "git branch -D gh-33");
  assert.equal(matchDiscardStatement("git branch -d gh-33"), undefined);
});

test("matchShipStatement/matchDiscardStatement accept git -C <path> global flags", () => {
  assert.deepEqual(matchShipStatement("git -C /p merge --squash f"), { option: "squash", statement: "git -C /p merge --squash f" });
  assert.equal(matchShipStatement("git -C /p push -u origin HEAD")?.option, "pr");
  assert.equal(matchShipStatement("git -c user.name=t -C /p merge --squash f")?.option, "squash");
  assert.equal(matchShipStatement("git -C /p log"), undefined);
  assert.equal(matchDiscardStatement("git -C /p worktree remove x"), "git -C /p worktree remove x");
  assert.equal(matchDiscardStatement("git -C /p branch -D f"), "git -C /p branch -D f");
  assert.equal(matchDiscardStatement("git -C /p branch -d f"), undefined);
});

test("matchTestStatement returns the first statement matching a test fragment", () => {
  assert.equal(matchTestStatement("cd repo && npm test -- --grep x", DEFAULT_TEST_COMMANDS), "npm test -- --grep x");
  assert.equal(matchTestStatement("make test-smoke", DEFAULT_TEST_COMMANDS), undefined);
  assert.equal(matchTestStatement("ls", DEFAULT_TEST_COMMANDS), undefined);
});

test("truncateCommand cuts at 120 chars", () => {
  assert.equal(truncateCommand("a".repeat(200)).length, 120);
  assert.equal(truncateCommand("short"), "short");
});

test("classifyBucket: first match wins, else code", () => {
  assert.equal(classifyBucket("extensions/lib/telemetry-paths.test.ts", DEFAULT_TELEMETRY_BUCKETS), "test");
  assert.equal(classifyBucket("doc/configuration.md", DEFAULT_TELEMETRY_BUCKETS), "docs");
  assert.equal(classifyBucket("package.json", DEFAULT_TELEMETRY_BUCKETS), "config");
  assert.equal(classifyBucket("extensions/telemetry.ts", DEFAULT_TELEMETRY_BUCKETS), "code");
  assert.equal(classifyBucket("doc/specs/a.md", [["spec", ["doc/specs/**"]], ["docs", ["**/*.md"]]]), "spec");
});

test("aggregateNumstat sums per bucket over the given file set; binary rows count 0 lines", () => {
  const numstat = ["10\t2\textensions/telemetry.ts", "5\t0\textensions/lib/telemetry-paths.test.ts", "-\t-\timg.png", "3\t3\tdoc/specs/a.md", "1\t1\t{old => new}/x.ts"].join("\n");
  const files = new Set(["extensions/telemetry.ts", "extensions/lib/telemetry-paths.test.ts", "img.png", "new/x.ts"]);
  assert.deepEqual(aggregateNumstat(numstat, files, DEFAULT_TELEMETRY_BUCKETS), {
    code: { files: 3, insertions: 11, deletions: 3 },
    test: { files: 1, insertions: 5, deletions: 0 },
  });
});

test("parseSpecLinks reads Supersedes/Fixes banners as paths or markdown links", () => {
  const body = "# T\n\n> **Supersedes:** [doc/specs/a.md](./a.md), doc/specs/b.md\n> **Fixes:** [doc/specs/c.md](./c.md)\n";
  assert.deepEqual(parseSpecLinks(body), { supersedes: ["doc/specs/a.md", "doc/specs/b.md"], fixes: ["doc/specs/c.md"] });
  assert.deepEqual(parseSpecLinks("# T\n"), { supersedes: [], fixes: [] });
});

test("isSupersededByBanner detects the predecessor banner and its successor label", () => {
  assert.equal(isSupersededByBanner("> **Superseded by:** [doc/specs/new.md](./new.md) - fully", "doc/specs/new.md"), true);
  assert.equal(isSupersededByBanner("> **Superseded by:** [doc/specs/other.md](./other.md)", "doc/specs/new.md"), false);
  assert.equal(isSupersededByBanner("plain text", "doc/specs/new.md"), false);
});
