  import { test } from "node:test";
  import assert from "node:assert/strict";
  import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, chmodSync } from "node:fs";
  import { join, dirname } from "node:path";
  import { tmpdir } from "node:os";
  import { spawnSync } from "node:child_process";
  import { fileURLToPath } from "node:url";

  const CLI = join(dirname(fileURLToPath(import.meta.url)), "gauntlet-telemetry-salvage.mjs");
  const SPEC = "doc/specs/x.md";
  const REC = ".pi/gauntlet/telemetry/doc/specs/x.yaml";
  const RECORD_V1 = "schema: 1\nspec: doc/specs/x.md\nstatus: in_progress\n";
  const RECORD_V2 = "schema: 1\nspec: doc/specs/x.md\nstatus: shipped\n";

  const git = (cwd, args, env = {}) =>
    spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], {
      cwd, encoding: "utf8", env: { ...process.env, ...env },
    });
  const out = (cwd, args) => git(cwd, args).stdout.trim();
  const write = (root, rel, text) => {
    mkdirSync(join(root, dirname(rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  };
  const commit = (root, msg, ...paths) => {
    git(root, ["add", "-f", "--", ...paths]);
    git(root, ["commit", "-q", "-m", msg, "--", ...paths]);
    return out(root, ["rev-parse", "HEAD"]);
  };
  const rmCommit = (root, msg, ...paths) => {
    git(root, ["rm", "-q", "--", ...paths]);
    git(root, ["commit", "-q", "-m", msg, "--", ...paths]);
    return out(root, ["rev-parse", "HEAD"]);
  };
  // main: README only. feat: spec (+ record when withRecord).
  const repo = ({ withRecord = true } = {}) => {
    const root = mkdtempSync(join(tmpdir(), "gts-"));
    git(root, ["init", "-q", "-b", "main"]);
    write(root, "README.md", "# fixture\n");
    commit(root, "init", "README.md");
    git(root, ["checkout", "-q", "-b", "feat"]);
    write(root, SPEC, "# Spec X\n\n**Goal:** g.\n");
    commit(root, "Add spec", SPEC);
    if (withRecord) {
      write(root, REC, RECORD_V1);
      commit(root, "telemetry: doc/specs/x.md", REC);
    }
    return root;
  };
  // An empty preset dir by default: the developer's real ~/.pi/agent/settings.json must never leak into fixtures.
  const EMPTY_AGENT = mkdtempSync(join(tmpdir(), "gts-empty-agent-"));
  process.on("exit", () => rmSync(EMPTY_AGENT, { recursive: true, force: true }));
  const invoke = (args, env = {}, options = {}) => {
    const r = spawnSync(process.execPath, [CLI, ...args], {
      encoding: "utf8", env: { ...process.env, PI_CODING_AGENT_DIR: EMPTY_AGENT, ...env }, timeout: options.timeout,
    });
    return { status: r.status, stdout: r.stdout.trim(), stderr: r.stderr.trim(), lines: r.stdout.split("\n").filter(Boolean) };
  };
  const run = (root, args = [], env = {}) => invoke(["--worktree", root, "--base", "main", ...args], env);
  const head = (root) => out(root, ["rev-parse", "HEAD"]);
  const commitCount = (root) => Number(out(root, ["rev-list", "--count", "HEAD"]));
  const headSubject = (root) => out(root, ["log", "-1", "--format=%s"]);
  const headFiles = (root) => out(root, ["show", "--name-only", "--format=", "HEAD"]).split("\n").filter(Boolean);
  const porcelain = (root) => out(root, ["status", "--porcelain"]);
  const cleanup = (t, ...roots) => t.after(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

  test("present: record in HEAD tree -> present, no commit", (t) => {
    const root = repo(); cleanup(t, root);
    const before = head(root);
    const r = run(root);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.lines, [`present ${REC}`]);
    assert.equal(head(root), before);
  });

  test("deleted once -> restored from <sha>, byte-identical, one telemetry: commit touching only the record", (t) => {
    const root = repo(); cleanup(t, root);
    const del = rmCommit(root, "Strip ephemeral plan and telemetry scaffolding", REC);
    const n = commitCount(root);
    const r = run(root);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.lines, [`restored ${REC} from ${del}`]);
    assert.equal(readFileSync(join(root, REC), "utf8"), RECORD_V1);
    assert.equal(commitCount(root), n + 1);
    assert.equal(headSubject(root), `telemetry: restore record stripped in ${del.slice(0, 10)}`);
    assert.deepEqual(headFiles(root), [REC]);
    assert.equal(porcelain(root), "");
  });

  test("deleted twice -> restores the newest (second) content", (t) => {
    const root = repo(); cleanup(t, root);
    rmCommit(root, "strip 1", REC);
    write(root, REC, RECORD_V2);
    commit(root, "telemetry: doc/specs/x.md", REC);
    const del2 = rmCommit(root, "strip 2", REC);
    const r = run(root);
    assert.deepEqual(r.lines, [`restored ${REC} from ${del2}`]);
    assert.equal(readFileSync(join(root, REC), "utf8"), RECORD_V2);
  });

  test("deleted, then rewritten on disk untracked -> on-disk copy committed, not DEL^", (t) => {
    const root = repo(); cleanup(t, root);
    const del = rmCommit(root, "strip", REC);
    write(root, REC, RECORD_V2);
    const r = run(root);
    assert.deepEqual(r.lines, [`restored ${REC} from ${del}`]);
    assert.equal(out(root, ["show", `HEAD:${REC}`]), RECORD_V2.trim());
    assert.equal(porcelain(root), "");
  });

  test("deleted and staged again uncommitted -> not present; staged copy committed", (t) => {
    const root = repo(); cleanup(t, root);
    const del = rmCommit(root, "strip", REC);
    write(root, REC, RECORD_V2);
    git(root, ["add", "-f", "--", REC]);
    const r = run(root);
    assert.deepEqual(r.lines, [`restored ${REC} from ${del}`]);
    assert.equal(out(root, ["show", `HEAD:${REC}`]), RECORD_V2.trim());
    assert.equal(porcelain(root), "");
  });

  test("pre-staged record missing from worktree -> failure preserves index and HEAD", (t) => {
    const root = repo(); cleanup(t, root);
    rmCommit(root, "strip", REC);
    write(root, REC, RECORD_V2);
    git(root, ["add", "-f", "--", REC]);
    rmSync(join(root, REC));
    const before = head(root);
    const r = run(root);
    assert.equal(r.stdout, `restore failed ${REC}: staged copy differs from worktree`);
    assert.equal(out(root, ["show", `:${REC}`]), RECORD_V2.trim());
    assert.equal(head(root), before);
    assert.equal(existsSync(join(root, REC)), false);
  });

  test("pre-staged record differing from worktree -> failure preserves both copies and HEAD", (t) => {
    const root = repo(); cleanup(t, root);
    rmCommit(root, "strip", REC);
    write(root, REC, RECORD_V2);
    git(root, ["add", "-f", "--", REC]);
    write(root, REC, RECORD_V1);
    const before = head(root);
    const r = run(root);
    assert.equal(r.stdout, `restore failed ${REC}: staged copy differs from worktree`);
    assert.equal(out(root, ["show", `:${REC}`]), RECORD_V2.trim());
    assert.equal(readFileSync(join(root, REC), "utf8"), RECORD_V1);
    assert.equal(head(root), before);
  });

  test("deleted in its introducing commit (amended away) -> nothing to restore, no file, clean index", (t) => {
    const root = repo(); cleanup(t, root);
    // The record's only commit is rewritten without it: git records no D entry whose parent lacks the blob,
    // so the spec's "introducing commit" limitation surfaces as `never written` and the script leaves nothing behind.
    git(root, ["rm", "-q", "--", REC]);
    git(root, ["commit", "-q", "--amend", "--allow-empty", "-m", "telemetry: doc/specs/x.md"]);
    const before = head(root);
    const r = run(root);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.lines, [`never written ${REC}`]);
    assert.equal(head(root), before);
    assert.equal(existsSync(join(root, REC)), false);
    assert.equal(porcelain(root), "");
  });

  test("no telemetry: commit on branch -> no telemetry run, no commit", (t) => {
    const root = repo({ withRecord: false }); cleanup(t, root);
    const n = commitCount(root);
    const r = run(root);
    assert.deepEqual(r.lines, [`no telemetry run ${REC}`]);
    assert.equal(commitCount(root), n);
  });

  test("telemetry: commit for another path, no deletion of this one -> never written", (t) => {
    const root = repo({ withRecord: false }); cleanup(t, root);
    write(root, ".pi/gauntlet/telemetry/doc/specs/other.yaml", "x\n");
    commit(root, "telemetry: doc/specs/other.md", ".pi/gauntlet/telemetry/doc/specs/other.yaml");
    const r = run(root);
    assert.deepEqual(r.lines, [`never written ${REC}`]);
  });

  test("--check on a stripped record -> stripped ... in <sha>, no commit, no file", (t) => {
    const root = repo(); cleanup(t, root);
    const del = rmCommit(root, "strip", REC);
    const before = head(root);
    const r = run(root, ["--check"]);
    assert.deepEqual(r.lines, [`stripped ${REC} in ${del}`]);
    assert.equal(head(root), before);
    assert.equal(existsSync(join(root, REC)), false);
    assert.equal(porcelain(root), "");
  });

  test("repo .pi/settings.json telemetry.enabled false -> telemetry disabled only", (t) => {
    const root = repo(); cleanup(t, root);
    write(root, ".pi/settings.json", JSON.stringify({ piGauntlet: { telemetry: { enabled: false } } }));
    commit(root, "settings", ".pi/settings.json");
    rmCommit(root, "strip", REC);
    const r = run(root);
    assert.equal(r.stdout, "telemetry disabled");
  });

  test("preset-only telemetry.dir via PI_CODING_AGENT_DIR resolves; --dir overrides both layers", (t) => {
    const root = repo({ withRecord: false });
    const agent = mkdtempSync(join(tmpdir(), "gts-agent-"));
    cleanup(t, root, agent);
    writeFileSync(join(agent, "settings.json"), JSON.stringify({ piGauntlet: { telemetry: { dir: "custom/dir" } } }));
    const custom = "custom/dir/doc/specs/x.yaml";
    write(root, custom, RECORD_V1);
    commit(root, "telemetry: doc/specs/x.md", custom);
    const del = rmCommit(root, "strip", custom);
    const r = run(root, [], { PI_CODING_AGENT_DIR: agent });
    assert.deepEqual(r.lines, [`restored ${custom} from ${del}`]);
    const r2 = run(root, ["--dir", "elsewhere"], { PI_CODING_AGENT_DIR: agent });
    assert.deepEqual(r2.lines, [`never written elsewhere/doc/specs/x.yaml`]);
  });

  test("rejecting pre-commit hook -> restore failed, index and worktree identical to before", (t) => {
    const root = repo(); cleanup(t, root);
    const del = rmCommit(root, "strip", REC);
    write(root, ".git/hooks/pre-commit", "#!/bin/sh\nexit 1\n");
    chmodSync(join(root, ".git/hooks/pre-commit"), 0o755);
    const before = head(root);
    const r = run(root);
    assert.equal(r.status, 0);
    assert.match(r.stdout, new RegExp(`^restore failed ${REC.replace(/\./g, "\\.")}: `));
    assert.equal(head(root), before);
    assert.equal(existsSync(join(root, REC)), false);
    assert.equal(porcelain(root), "");
  });

  test("hanging pre-commit hook -> restore failed ... timed out within the bound, state rolled back", (t) => {
    const root = repo(); cleanup(t, root);
    rmCommit(root, "strip", REC);
    write(root, ".git/hooks/pre-commit", "#!/bin/sh\nsleep 60\n");
    chmodSync(join(root, ".git/hooks/pre-commit"), 0o755);
    const before = head(root);
    const r = invoke(["--worktree", root, "--base", "main"], { GAUNTLET_SALVAGE_COMMIT_TIMEOUT_MS: "2000" }, { timeout: 20_000 });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, `restore failed ${REC}: timed out`);
    assert.equal(head(root), before);
    assert.equal(existsSync(join(root, REC)), false);
    assert.equal(porcelain(root), "");
  });

  test("timed-out record presence query -> restore failed, no mutation", (t) => {
    const root = repo();
    const bin = mkdtempSync(join(tmpdir(), "gts-bin-"));
    cleanup(t, root, bin);
    const wrapper = join(bin, "git");
    writeFileSync(wrapper, `#!/bin/sh
case "$*" in
  *"cat-file -e HEAD:${REC}"*) sleep 60 ;;
esac
PATH="${process.env.PATH.split(":").filter((part) => part !== bin).join(":")}" exec git "$@"
`);
    chmodSync(wrapper, 0o755);
    const before = head(root);
    const r = invoke(["--worktree", root, "--base", "main"], { PATH: `${bin}:${process.env.PATH}` }, { timeout: 20_000 });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, `restore failed ${REC}: timed out`);
    assert.equal(head(root), before);
    assert.equal(porcelain(root), "");
  });

  test("two specs on the branch, one record stripped -> two lines, one restore", (t) => {
    const root = repo(); cleanup(t, root);
    const spec2 = "doc/specs/y.md"; const rec2 = ".pi/gauntlet/telemetry/doc/specs/y.yaml";
    write(root, spec2, "# Y\n"); commit(root, "Add y", spec2);
    write(root, rec2, RECORD_V1); commit(root, "telemetry: doc/specs/y.md", rec2);
    const del = rmCommit(root, "strip", REC);
    const n = commitCount(root);
    const r = run(root);
    assert.deepEqual(r.lines.sort(), [`present ${rec2}`, `restored ${REC} from ${del}`].sort());
    assert.equal(commitCount(root), n + 1);
  });

  test("spec deleted on the branch -> no spec on branch", (t) => {
    const root = repo(); cleanup(t, root);
    rmCommit(root, "reap superseded spec", SPEC, REC);
    const r = run(root);
    assert.equal(r.stdout, "no spec on branch");
  });

  test("unresolvable base without --base -> no base ref; --base main works", (t) => {
    const root = repo(); cleanup(t, root);
    git(root, ["branch", "-m", "main", "trunk"]);
    const bare = invoke(["--worktree", root]);
    assert.equal(bare.status, 0);
    assert.equal(bare.stdout, "no base ref");
    const r = invoke(["--worktree", root, "--base", "trunk"]);
    assert.equal(r.stdout, `present ${REC}`);
  });

  test("--worktree at a non-git directory -> stderr not a git worktree, empty stdout, exit 0", (t) => {
    const dir = mkdtempSync(join(tmpdir(), "gts-nogit-")); cleanup(t, dir);
    const r = invoke(["--worktree", dir]);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "");
    assert.match(r.stderr, /^not a git worktree: /);
  });

  test("relative --worktree -> usage on stderr, exit 1, empty stdout", () => {
    const r = invoke(["--worktree", "relative/path"]);
    assert.equal(r.status, 1);
    assert.equal(r.stdout, "");
    assert.match(r.stderr, /^usage: gauntlet-telemetry-salvage/);
  });

  test("escaping --dir -> usage on stderr, exit 1", (t) => {
    const root = repo(); cleanup(t, root);
    const r = invoke(["--worktree", root, "--dir", "../outside"]);
    assert.equal(r.status, 1);
    assert.equal(r.stdout, "");
    assert.match(r.stderr, /^usage: gauntlet-telemetry-salvage/);
  });

  test("trailing slash in --dir is normalized", (t) => {
    const root = repo({ withRecord: false }); cleanup(t, root);
    const custom = "custom/dir/doc/specs/x.yaml";
    write(root, custom, RECORD_V1);
    commit(root, "telemetry: doc/specs/x.md", custom);
    const del = rmCommit(root, "strip", custom);
    const r = run(root, ["--dir", "custom/dir/"]);
    assert.deepEqual(r.lines, [`restored ${custom} from ${del}`]);
  });

  test("value flag followed by another flag -> usage, exit 1, no git call", (t) => {
    const root = repo(); cleanup(t, root);
    const before = head(root);
    const r = invoke(["--worktree", root, "--base", "--check"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /^usage:/);
    assert.equal(head(root), before);
    assert.equal(invoke(["--worktree"]).status, 1);
  });

  test("never pushes: remote refs unchanged after a successful restore", (t) => {
    const root = repo();
    const remote = mkdtempSync(join(tmpdir(), "gts-remote-"));
    cleanup(t, root, remote);
    git(remote, ["init", "-q", "--bare"]);
    git(root, ["remote", "add", "origin", remote]);
    git(root, ["push", "-q", "origin", "main", "feat"]);
    const remoteBefore = out(remote, ["for-each-ref"]);
    rmCommit(root, "strip", REC);
    const r = run(root);
    assert.match(r.stdout, /^restored /);
    assert.equal(out(remote, ["for-each-ref"]), remoteBefore);
  });

  test("finishing Option 1 fixture: strip-on-branch + salvage + merge --squash leaves the record, not the plan, staged", (t) => {
    const root = repo(); cleanup(t, root);
    const plan = "doc/plans/x.md";
    write(root, plan, "# plan\n"); commit(root, "Add plan", plan);
    rmCommit(root, "Strip ephemeral plan and telemetry scaffolding", plan, REC);
    const r = run(root);
    assert.match(r.stdout, /^restored /);
    git(root, ["checkout", "-q", "main"]);
    git(root, ["merge", "--squash", "-q", "feat"]);
    const staged = out(root, ["diff", "--cached", "--name-only"]).split("\n");
    assert.ok(staged.includes(REC), "record staged");
    assert.ok(staged.includes(SPEC), "spec staged");
    assert.ok(!staged.includes(plan), "plan not staged");
  });
