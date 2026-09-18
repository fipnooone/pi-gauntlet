#!/usr/bin/env node
// Restore a gauntlet telemetry record that a plan strip or a gate fix commit removed
// from the branch. The recorder pathspec-commits the record at every checkpoint, so the
// newest copy is always in the deleting commit's parent. An in_progress record with no
// ship phase is stamped shipped at landing. Exit 0 on every outcome: the callers are ship
// paths and this script never blocks one.
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { mergeGauntlet, resolveTelemetry } from "../extensions/lib/gauntlet-settings.ts";
import { isSpecPath, recordPathFor } from "../extensions/lib/telemetry-paths.ts";
import { BASE_REFS } from "../extensions/lib/telemetry-ship.ts";
import { parseRecord, serializeRecord } from "../extensions/lib/telemetry-record.ts";

const GIT_TIMEOUT_MS = 10_000;
const COMMIT_TIMEOUT_MS = Number(process.env.GAUNTLET_SALVAGE_COMMIT_TIMEOUT_MS) || 30_000;
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_EDITOR: "true" };

const usage = () => {
  process.stderr.write("usage: gauntlet-telemetry-salvage --worktree <abs path> [--base <ref>] [--dir <telemetry dir>] [--check]\n");
  process.exit(1);
};

function parseArgs(argv) {
  const opts = { worktree: undefined, base: undefined, dir: undefined, check: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--worktree" && argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) opts.worktree = argv[++i];
    else if (a === "--base" && argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) opts.base = argv[++i];
    else if (a === "--dir" && argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) opts.dir = argv[++i];
    else if (a === "--check") opts.check = true;
    else usage();
  }
  if (!opts.worktree || !isAbsolute(opts.worktree)) usage();
  return opts;
}

function git(cwd, args, timeout = GIT_TIMEOUT_MS) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV, timeout });
  const timedOut = r.error?.code === "ETIMEDOUT";
  const stderr = timedOut ? "timed out" : (r.stderr ?? "").trim().split("\n")[0] || r.error?.message || `git exited ${r.status}`;
  return { ok: !timedOut && r.status === 0, stdout: (r.stdout ?? "").trim(), stderr, timedOut };
}

function readLayer(file) {
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    process.stderr.write(`warning: ${file}: ${e.message}; using {} for this layer\n`);
    return {};
  }
}

// Same two layers the recorder reads (gauntlet-settings-loader.ts), without the pi import.
function telemetrySettings(root) {
  const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
  const preset = readLayer(join(agentDir, "settings.json"));
  const repo = readLayer(join(root, ".pi", "settings.json"));
  return resolveTelemetry(mergeGauntlet(preset?.piGauntlet, repo?.piGauntlet));
}

function resolveBase(root, explicit) {
  for (const ref of explicit ? [explicit] : BASE_REFS) {
    if (git(root, ["rev-parse", "--verify", "-q", `${ref}^{commit}`]).ok) return ref;
  }
  return undefined;
}

// in_progress with no ship phase: the recorder lost its binding before the ship, so the
// landing finishes the record instead of leaving it in_progress on main forever.
const unfinished = (rec) => {
  const phases = rec?.derived?.phases;
  return rec?.status === "in_progress" && (phases === null || typeof phases !== "object" || !("ship" in phases));
};
const stamped = (rec, now) => serializeRecord({ ...rec, status: "shipped", shipped_at: now });

function stampPresent(root, rec, check) {
  const line = `present ${rec}`;
  const abs = join(root, rec);
  // Only a copy identical to HEAD in both worktree and index is script-owned.
  if (!existsSync(abs) || !git(root, ["diff", "--quiet", "HEAD", "--", rec]).ok || !git(root, ["diff", "--quiet", "--cached", "HEAD", "--", rec]).ok) return line;
  const parsed = parseRecord(readFileSync(abs, "utf8"));
  if (!unfinished(parsed)) return line;
  if (check) return `unfinished ${rec}`;
  const prior = readFileSync(abs);
  const failed = (reason) => {
    writeFileSync(abs, prior);
    git(root, ["reset", "-q", "--", rec]);
    return `restore failed ${rec}: ${reason}`;
  };
  writeFileSync(abs, stamped(parsed, new Date().toISOString()));
  const add = git(root, ["add", "-f", "--", rec]);
  if (!add.ok) return failed(add.stderr);
  const commit = git(root, ["commit", "-q", "-m", `telemetry: mark ${rec} shipped at landing`, "--", rec], COMMIT_TIMEOUT_MS);
  if (!commit.ok) return failed(commit.stderr);
  return `${line} (marked shipped)`;
}

function salvage(root, rec, base, check) {
  const presence = git(root, ["cat-file", "-e", `HEAD:${rec}`]);
  if (presence.timedOut) return `restore failed ${rec}: timed out`;
  if (presence.ok) return stampPresent(root, rec, check);
  const history = git(root, ["log", `${base}..HEAD`, "--grep=^telemetry: ", "-1", "--format=%H"]);
  if (history.timedOut) return `restore failed ${rec}: timed out`;
  if (!history.stdout) return `no telemetry run ${rec}`;
  const deletion = git(root, ["log", "-1", "--diff-filter=D", "--format=%H", `${base}..HEAD`, "--", rec]);
  if (deletion.timedOut) return `restore failed ${rec}: timed out`;
  const del = deletion.stdout;
  if (!del) return `never written ${rec}`;
  if (check) return `stripped ${rec} in ${del}`;

  const abs = join(root, rec);
  const onDisk = existsSync(abs);
  const preStaged = git(root, ["ls-files", "--", rec]).stdout !== "";
  // A pre-staged record is user-owned and can only be committed when the worktree matches it.
  if (preStaged && (!onDisk || !git(root, ["diff", "--quiet", "--", rec]).ok)) {
    return `restore failed ${rec}: staged copy differs from worktree`;
  }
  let created = false;
  let stagedByScript = false;
  let priorBytes;
  const rollback = () => {
    if (priorBytes !== undefined) {
      writeFileSync(abs, priorBytes);
      if (preStaged) git(root, ["add", "-f", "--", rec]);
    }
    if (stagedByScript) git(root, ["reset", "-q", "--", rec]);
    if (created) rmSync(abs, { force: true });
  };
  const failed = (reason) => {
    rollback();
    return `restore failed ${rec}: ${reason}`;
  };

  if (!onDisk) {
    const co = git(root, ["checkout", `${del}^`, "--", rec]);
    if (!co.ok) return `restore failed ${rec}: ${co.stderr}`;
    created = true;
  }
  stagedByScript = !preStaged;
  let suffix = "";
  const parsed = parseRecord(readFileSync(abs, "utf8"));
  if (unfinished(parsed)) {
    priorBytes = readFileSync(abs);
    writeFileSync(abs, stamped(parsed, new Date().toISOString()));
    suffix = " (marked shipped)";
  }
  const add = git(root, ["add", "-f", "--", rec]);
  if (!add.ok) return failed(add.stderr);
  const commit = git(root, ["commit", "-q", "-m", `telemetry: restore record stripped in ${del.slice(0, 10)}`, "--", rec], COMMIT_TIMEOUT_MS);
  if (!commit.ok) return failed(commit.stderr);
  return `restored ${rec} from ${del}${suffix}`;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const override = opts.dir === undefined
    ? undefined
    : resolveTelemetry({ telemetry: { enabled: true, dir: opts.dir } });
  if (override?.warning) usage();
  const top = git(opts.worktree, ["rev-parse", "--show-toplevel"]);
  if (!existsSync(opts.worktree) || !top.ok) {
    process.stderr.write(`not a git worktree: ${opts.worktree}\n`);
    return;
  }
  const root = top.stdout;
  const telemetry = telemetrySettings(root);
  if (telemetry.warning) process.stderr.write(`warning: ${telemetry.warning}\n`);
  if (!telemetry.enabled) return console.log("telemetry disabled");
  const dir = override?.dir ?? telemetry.dir;
  const base = resolveBase(root, opts.base);
  if (!base) return console.log("no base ref");
  const diff = git(root, ["diff", "--name-only", `${base}...HEAD`]);
  if (!diff.ok) return console.log("no base ref");
  const specs = diff.stdout.split("\n").filter((f) => f && isSpecPath(f) && git(root, ["cat-file", "-e", `HEAD:${f}`]).ok);
  if (specs.length === 0) return console.log("no spec on branch");
  for (const spec of specs) console.log(salvage(root, recordPathFor(dir, spec), base, opts.check));
}

main();
