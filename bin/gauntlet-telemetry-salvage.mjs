#!/usr/bin/env node

// src/bins/gauntlet-telemetry-salvage.mjs
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";

// extensions/lib/gauntlet-settings.ts
import path from "node:path";
function mergeGauntlet(preset, repo) {
  return { ...preset ?? {}, ...repo ?? {} };
}
var nonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;
var joinWarn = (ws) => ws.length ? ws.join("; ") : void 0;
var DEFAULT_TELEMETRY_DIR = ".pi/gauntlet/telemetry";
var DEFAULT_TELEMETRY_BUCKETS = [
  ["test", ["**/test/**", "**/tests/**", "**/__tests__/**", "**/*.test.*", "**/*.spec.*", "**/*_test.*"]],
  ["docs", ["**/*.md"]],
  ["config", ["**/*.json", "**/*.yaml", "**/*.yml", "**/*.toml", "**/*.lock", "**/*-lock.*"]]
];
function resolveTelemetry(g) {
  const t = g.telemetry;
  const warnings = [];
  const enabled = t?.enabled !== false;
  let dir = DEFAULT_TELEMETRY_DIR;
  if (t?.dir !== void 0) {
    const value = nonEmptyString(t.dir) ? t.dir.trim().replace(/\/+$/, "") : "";
    const canonical = value.replace(/\\/g, "/");
    const normalized = path.posix.normalize(canonical);
    if (value && path.win32.parse(canonical).root === "" && normalized !== ".." && !normalized.startsWith("../")) dir = normalized;
    else warnings.push("telemetry.dir must be a non-empty path relative to the git toplevel; using the default");
  }
  let buckets = DEFAULT_TELEMETRY_BUCKETS;
  if (t?.buckets !== void 0) {
    const b = t.buckets;
    const valid = b !== null && typeof b === "object" && !Array.isArray(b) && Object.keys(b).length > 0 && Object.values(b).every((v) => Array.isArray(v) && v.length > 0 && v.every(nonEmptyString));
    if (valid) buckets = Object.entries(b).map(([name, globs]) => [name, [...globs]]);
    else warnings.push("telemetry.buckets is not an object of non-empty glob arrays; using the defaults");
  }
  return { enabled, dir, buckets, warning: joinWarn(warnings) };
}

// extensions/lib/phase-tracker-helpers.ts
var STMT_START = "(?:^|[\\n;&|(])\\s*";

// extensions/lib/telemetry-paths.ts
var isSpecPath = (rel) => /(^|\/)doc\/specs\/[^/]+\.md$/.test(rel);
var recordPathFor = (dir, specRel) => `${dir}/${specRel.replace(/\.md$/, ".yaml")}`;
var GIT_FLAGS = "git\\s+(?:-\\S+(?:\\s+\\S+)?\\s+)*";
var SHIP_RE = new RegExp(STMT_START + "(" + GIT_FLAGS + "(?:merge\\s+--squash|push)(?=\\s|$)|gh\\s+pr\\s+create)");
var DISCARD_RE = new RegExp(STMT_START + "(" + GIT_FLAGS + "(?:worktree\\s+remove|branch\\s+-D)(?=\\s|$))");
var SQUASH_RE = new RegExp("^" + GIT_FLAGS + "merge\\s+--squash");

// extensions/lib/telemetry-ship.ts
var BASE_REFS = ["origin/HEAD", "main", "master"];

// extensions/lib/telemetry-record.ts
import { Document, isCollection, isMap, isSeq, parse as parseYaml, stringify as stringifyYaml } from "yaml";
var emptyAccumulators = () => ({ phases: {}, personas: {}, reviews: {}, spec_writes: {}, gates: { spec_rounds: 0, plan_rounds: 0, fix_round_grants: 0, task_reopens: 0 }, conformance_loops: 0, amendments: 0, spec_edits_after_ship: 0, events_dropped: 0 });
function newRecord(o) {
  return { schema: 1, spec: o.spec, run_id: o.runId, branch: o.branch, status: "in_progress", created_at: o.now, sessions: [o.session], derived: { duration_s: 0, phases: {}, personas: {}, conformance_loops: 0, gates: { spec_rounds: 0, plan_rounds: 0, fix_round_grants: 0, task_reopens: 0 }, amendments: 0, spec_edits_after_ship: 0, spec_writes: {}, events_dropped: 0 }, accumulators: {}, events: [] };
}
var stripUndefined = (v) => {
  if (Array.isArray(v)) return v.map(stripUndefined);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== void 0).map(([k, x]) => [k, stripUndefined(x)]));
  return v;
};
var flowLeafChildren = (map, blockLists = /* @__PURE__ */ new Set()) => {
  for (const pair of map.items) {
    const key = String(pair.key);
    const child = pair.value;
    if (!isCollection(child) || blockLists.has(key)) continue;
    if (isMap(child) && child.items.length > 0 && child.items.every((item) => isMap(item.value))) {
      for (const item of child.items) if (isCollection(item.value)) item.value.flow = true;
    } else {
      child.flow = true;
    }
  }
};
var flowModelLists = (node) => {
  if (isMap(node)) {
    for (const pair of node.items) {
      if (String(pair.key) === "models" && isSeq(pair.value)) pair.value.flow = true;
      flowModelLists(pair.value);
    }
  } else if (isSeq(node)) {
    for (const item of node.items) flowModelLists(item);
  }
};
function serializeRecord(rec) {
  const { derived, accumulators, events, ...head } = rec;
  const body = stripUndefined({ ...head, derived, accumulators });
  const doc = new Document(body);
  const derivedNode = doc.get("derived", true);
  if (isMap(derivedNode)) flowLeafChildren(derivedNode, /* @__PURE__ */ new Set(["modified_files"]));
  const accumulatorNode = doc.get("accumulators", true);
  if (isMap(accumulatorNode)) {
    for (const session of accumulatorNode.items) if (isMap(session.value)) flowLeafChildren(session.value);
  }
  flowModelLists(doc.contents);
  const bodyText = doc.toString({ lineWidth: 0 });
  const eventLines = events.map((e) => "  - " + stringifyYaml(stripUndefined(e), { collectionStyle: "flow", lineWidth: 0 }).trim());
  return bodyText + "events:\n" + (eventLines.length ? eventLines.join("\n") + "\n" : "");
}
function parseRecord(text) {
  let doc;
  try {
    doc = parseYaml(text);
  } catch {
    return void 0;
  }
  if (!doc || typeof doc !== "object") return void 0;
  const d = doc;
  if (d.schema !== 1 || typeof d.spec !== "string" || typeof d.run_id !== "string") return void 0;
  const accumulators = Object.fromEntries(Object.entries(d.accumulators ?? {}).flatMap(
    ([session, block]) => block && typeof block === "object" && !Array.isArray(block) ? [[session, { ...emptyAccumulators(), ...block }]] : []
  ));
  return { ...d, sessions: Array.isArray(d.sessions) ? d.sessions : [], derived: d.derived ?? newRecord({ spec: d.spec, session: "", now: d.created_at ?? "", runId: d.run_id }).derived, accumulators, events: Array.isArray(d.events) ? d.events : [] };
}

// src/bins/gauntlet-telemetry-salvage.mjs
var GIT_TIMEOUT_MS = 1e4;
var COMMIT_TIMEOUT_MS = Number(process.env.GAUNTLET_SALVAGE_COMMIT_TIMEOUT_MS) || 3e4;
var GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_EDITOR: "true" };
var usage = () => {
  process.stderr.write("usage: gauntlet-telemetry-salvage --worktree <abs path> [--base <ref>] [--dir <telemetry dir>] [--check]\n");
  process.exit(1);
};
function parseArgs(argv) {
  const opts = { worktree: void 0, base: void 0, dir: void 0, check: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--worktree" && argv[i + 1] !== void 0 && !argv[i + 1].startsWith("--")) opts.worktree = argv[++i];
    else if (a === "--base" && argv[i + 1] !== void 0 && !argv[i + 1].startsWith("--")) opts.base = argv[++i];
    else if (a === "--dir" && argv[i + 1] !== void 0 && !argv[i + 1].startsWith("--")) opts.dir = argv[++i];
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
    process.stderr.write(`warning: ${file}: ${e.message}; using {} for this layer
`);
    return {};
  }
}
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
  return void 0;
}
var unfinished = (rec) => {
  const phases = rec?.derived?.phases;
  return rec?.status === "in_progress" && (phases === null || typeof phases !== "object" || !("ship" in phases));
};
var stamped = (rec, now) => serializeRecord({ ...rec, status: "shipped", shipped_at: now });
function stampPresent(root, rec, check) {
  const line = `present ${rec}`;
  const abs = join(root, rec);
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
  writeFileSync(abs, stamped(parsed, (/* @__PURE__ */ new Date()).toISOString()));
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
  if (preStaged && (!onDisk || !git(root, ["diff", "--quiet", "--", rec]).ok)) {
    return `restore failed ${rec}: staged copy differs from worktree`;
  }
  let created = false;
  let stagedByScript = false;
  let priorBytes;
  const rollback = () => {
    if (priorBytes !== void 0) {
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
    writeFileSync(abs, stamped(parsed, (/* @__PURE__ */ new Date()).toISOString()));
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
  const override = opts.dir === void 0 ? void 0 : resolveTelemetry({ telemetry: { enabled: true, dir: opts.dir } });
  if (override?.warning) usage();
  const top = git(opts.worktree, ["rev-parse", "--show-toplevel"]);
  if (!existsSync(opts.worktree) || !top.ok) {
    process.stderr.write(`not a git worktree: ${opts.worktree}
`);
    return;
  }
  const root = top.stdout;
  const telemetry = telemetrySettings(root);
  if (telemetry.warning) process.stderr.write(`warning: ${telemetry.warning}
`);
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
