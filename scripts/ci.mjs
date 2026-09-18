#!/usr/bin/env node
// Repo validator. Runs in CI on every push and as the release gate.
// The validator itself uses only Node built-ins; `npm install` must run first
// because the telemetry record module and its tests import the `yaml` dependency.
//
// Usage:
//   node scripts/ci.mjs                      # validate repo
//   node scripts/ci.mjs --expect-version X   # also assert package.json == X (tag gate)

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const R = (p) => join(root, p);

const errors = [];
const fail = (msg) => errors.push(msg);
const ok = (msg) => console.log(`  ok  ${msg}`);

const expectIdx = process.argv.indexOf("--expect-version");
const expectVersion = expectIdx !== -1 ? process.argv[expectIdx + 1] : null;

// ---- package.json ----------------------------------------------------------
const pkg = JSON.parse(readFileSync(R("package.json"), "utf8"));

if (!pkg.name) fail("package.json: missing name");
if (!/^\d+\.\d+\.\d+/.test(pkg.version || "")) fail(`package.json: bad version "${pkg.version}"`);
if (pkg.private) fail("package.json: private:true would block publish");
if (!pkg.license) fail("package.json: missing license field");
if (pkg.engines?.node !== ">=24.15.0") fail('package.json: engines.node must equal ">=24.15.0"');
if (pkg.bin?.["gauntlet-spec-index"] !== "bin/gauntlet-spec-index.mjs") fail("package.json: bin.gauntlet-spec-index must point at bin/gauntlet-spec-index.mjs");
if (pkg.bin?.["gauntlet-telemetry-salvage"] !== "bin/gauntlet-telemetry-salvage.mjs") fail("package.json: bin.gauntlet-telemetry-salvage must point at bin/gauntlet-telemetry-salvage.mjs");
const dependencyKeys = Object.keys(pkg.dependencies || {}).sort();
if (JSON.stringify(dependencyKeys) !== JSON.stringify(["yaml"])) {
  fail(`package.json: dependencies must contain exactly "yaml" (got ${dependencyKeys.join(", ") || "none"})`);
}
if (!existsSync(R("LICENSE"))) fail("LICENSE file missing");
if (!existsSync(R("README.md"))) fail("README.md missing (npm shows it on the package page)");

const keywords = pkg.keywords || [];
if (!keywords.includes("pi-package"))
  fail('package.json: keywords must include "pi-package" (drives pi.dev/packages discovery)');
else ok('keyword "pi-package" present');

// files allowlist must ship what the postinstall persona copy needs
const files = pkg.files || [];
if (files.length === 0) {
  fail("package.json: no files allowlist (tarball would ship everything)");
} else {
  for (const need of ["agents", "bin"]) {
    if (!files.includes(need))
      fail(`package.json: files allowlist missing "${need}" (postinstall persona copy would break on npm install)`);
  }
  if (files.includes("agents") && files.includes("bin")) ok("files allowlist ships agents/ + bin/");
}

// pi skills resolve from a non-empty directory
const skillEntries = pkg.pi?.skills;
if (!Array.isArray(skillEntries) || skillEntries.length === 0) {
  fail("package.json: pi.skills missing");
} else {
  for (const rel of skillEntries) {
    const dir = R(rel.replace(/^\.\//, ""));
    if (!existsSync(dir) || !statSync(dir).isDirectory()) fail(`package.json: pi.skills points at missing dir ${rel}`);
    else if (readdirSync(dir).length === 0) fail(`package.json: pi.skills dir ${rel} is empty`);
  }
}

// Extension entrypoints are explicit so Pi never auto-discovers tests or helpers.
const expectedExtensions = [
  "./extensions/phase-tracker.ts",
  "./extensions/plan-tracker.ts",
  "./extensions/verify-before-ship.ts",
  "./extensions/telemetry.ts",
];
const extensionEntries = pkg.pi?.extensions;
if (!Array.isArray(extensionEntries) || extensionEntries.length === 0) {
  fail("package.json: pi.extensions missing");
} else {
  const actual = [...extensionEntries].sort();
  const expected = [...expectedExtensions].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`package.json: pi.extensions must be exactly ${expectedExtensions.join(", ")} (got ${extensionEntries.join(", ")})`);
  }
  for (const rel of extensionEntries) {
    const file = R(rel.replace(/^\.\//, ""));
    if (!/\.(ts|js)$/.test(rel) || !existsSync(file) || !statSync(file).isFile()) {
      fail(`package.json: pi.extensions points at invalid extension file ${rel}`);
    }
  }
}
ok("pi manifest resources resolve");

// ---- version consistency: package.json == CHANGELOG top ==------------------
const changelog = readFileSync(R("CHANGELOG.md"), "utf8");
const clMatch = changelog.match(/^##\s+v(\d+\.\d+\.\d+)/m);
if (!clMatch) fail("CHANGELOG.md: no `## vX.Y.Z` heading found");
else if (clMatch[1] !== pkg.version)
  fail(`version drift: package.json ${pkg.version} != CHANGELOG top v${clMatch[1]}`);
else ok(`version aligned: ${pkg.version} == CHANGELOG top`);

if (expectVersion && expectVersion !== pkg.version)
  fail(`tag/version drift: pushed tag v${expectVersion} != package.json ${pkg.version}`);
else if (expectVersion) ok(`tag matches package.json (${pkg.version})`);

// ---- shared AGENTS core: AGENTS.md region == AGENTS.core.md ----------------
{
  const norm = (s) => s.replace(/\r\n/g, "\n").trim();
  const core = norm(readFileSync(R("AGENTS.core.md"), "utf8"));
  const agents = readFileSync(R("AGENTS.md"), "utf8");
  const b = agents.indexOf("<!-- agents-core:begin");
  const e = agents.indexOf("<!-- agents-core:end");
  if (b === -1 || e === -1) fail("AGENTS.md: missing agents-core begin/end markers");
  else if (norm(agents.slice(agents.indexOf("\n", b) + 1, e)) !== core)
    fail("AGENTS.md shared core drifted from AGENTS.core.md (run: node scripts/check-agents-core.mjs --fix)");
  else ok("AGENTS.md shared core matches AGENTS.core.md");
}

// ---- frontmatter on every skill + agent ------------------------------------
const hasFrontmatter = (file, required) => {
  const txt = readFileSync(file, "utf8");
  const m = txt.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return `no YAML frontmatter`;
  for (const field of required) if (!new RegExp(`^${field}:`, "m").test(m[1])) return `missing "${field}"`;
  return null;
};

for (const d of readdirSync(R("skills"))) {
  const skill = R(`skills/${d}/SKILL.md`);
  if (!existsSync(skill)) { fail(`skills/${d}: no SKILL.md`); continue; }
  const err = hasFrontmatter(skill, ["name", "description"]);
  if (err) fail(`skills/${d}/SKILL.md: ${err}`);
}
ok(`${readdirSync(R("skills")).length} skills have frontmatter`);

const agents = readdirSync(R("agents")).filter((f) => f.endsWith(".md"));
for (const a of agents) {
  const err = hasFrontmatter(R(`agents/${a}`), ["name", "description"]);
  if (err) fail(`agents/${a}: ${err}`);
}
ok(`${agents.length} agents have frontmatter`);

// ---- stale rename tokens (post-v4 regression guard) ------------------------
// "superpowers" alone is legit lineage; these renamed identifiers are not.
const forbidden = ["piSuperpowers", "PI_SUPERPOWERS_AGENT_DIR", "superpowers-overrides", "@jjuraszek/pi-superpowers"];
const scanDirs = ["skills", "extensions", "agents", "bin"];
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = join(dir, e.name);
  return e.isDirectory() ? walk(p) : [p];
});
const hits = [];
for (const base of scanDirs) {
  for (const file of walk(R(base))) {
    const txt = readFileSync(file, "utf8");
    for (const tok of forbidden) if (txt.includes(tok)) hits.push(`${file.replace(root + "/", "")}: "${tok}"`);
  }
}
if (hits.length) fail("stale rename tokens found:\n    " + hits.join("\n    "));
else ok("no stale rename tokens in skills/extensions/agents/bin");

// ---- subtractive review pass (over-spec kind + closure removal) -------------
const subtractiveErrorsBefore = errors.length;
const txt = (p) => readFileSync(R(p), "utf8");
const tokenChecks = [
  // present
  ["agents/spec-council-member.md", "over-spec", true],
  ["agents/spec-council-member.md", "\nlean: nothing to cut | <N> over-spec findings above\n", true],
  ["agents/spec-council-synthesizer.md", "over-spec:", true],
  ["agents/spec-council-synthesizer.md", "\nlean: <k> of <n> members found nothing to cut\n", true],
  ["skills/roasting-the-spec/SKILL.md", "Human input (verbatim", true],
  ["skills/shape-ticket/SKILL.md", "`^lean:` line", true],
  ["agents/conformance-reviewer.md", "(over-spec)", true],
  // #25 SR/CR drift contracts
  ["skills/subagent-driven-development/spec-reviewer-prompt.md", "A plausible condition is not the specified condition", true],
  ["agents/spec-reviewer.md", "A plausible condition is not the specified condition", true],
  ["agents/spec-reviewer.md", "code-condition:", true],
  ["agents/code-reviewer.md", "`Behaviour-change:` on **every** report", true],
  ["skills/requesting-code-review/code-reviewer.md", "`Behaviour-change:` on **every** report", true],
  ["skills/subagent-driven-development/code-quality-reviewer-prompt.md", "`Behaviour-change:` on **every** report", true],
  ["skills/subagent-driven-development/SKILL.md", "never default to `no`", true],
  ["skills/writing-plans/SKILL.md", "is never waivable", true],
  // council provenance / probe-before-apply / standing amend approval
  ["agents/spec-council-member.md", "probed:", true],
  ["agents/spec-council-member.md", "End every finding with `probed:`", true],
  ["agents/spec-council-synthesizer.md", "grounded|hypothesis:", true],
  ["skills/roasting-the-spec/SKILL.md", "clusters that assert data shape, ordering, or semantics", true],
  ["skills/brainstorming/SKILL.md", "waives per-diff review", true],
  // #27 gate removal / amendment path
  ["skills/brainstorming/SKILL.md", "## Amending an approved spec", true],
  ["skills/writing-plans/SKILL.md", "#amending-an-approved-spec", true],
  ["skills/subagent-driven-development/SKILL.md", "#amending-an-approved-spec", true],
  ["skills/finishing-a-development-branch/SKILL.md", "#amending-an-approved-spec", true],
  ["skills/brainstorming/SKILL.md", "Ask once whether the design replaces", false],
  ["skills/brainstorming/SKILL.md", "get approval after each", false],
  ["skills/brainstorming/SKILL.md", "validate each", false],
  ["skills/brainstorming/SKILL.md", "Ask after each", false],
  ["skills/brainstorming/SKILL.md", "200-300-word sections", false],
  ["skills/brainstorming/SKILL.md", "## Marking superseded specs", false],
  ["skills/brainstorming/SKILL.md", "#marking-superseded-specs", false],
  ["skills/brainstorming/gatherer.md", "node <SPEC_INDEX> --query", true],
  ["skills/brainstorming/SKILL.md", "reference/superseding.md", true],
  ["skills/writing-plans/SKILL.md", "the spec is frozen once planning starts", false],
  // absent (retired rules)
  ["skills/verification-before-completion/reference/conformance-check.md", "always** defers to the finish gate", false],
  ["skills/verification-before-completion/reference/conformance-check.md", "`accept`/`rescope`/`UNAUTHORIZED`", false],
  ["agents/conformance-reviewer.md", "`accept`/`rescope`/`UNAUTHORIZED`", false],
  ["agents/conformance-reviewer.md", "harmless \u2192 `accept`", false],
  // absent (spec-in-hand resume path and pi-intercom are gone)
  ["skills/writing-plans/SKILL.md", "spec in hand", false],
  ["skills/writing-plans/SKILL.md", "Resuming with", false],
  ["skills/dispatching-parallel-agents/SKILL.md", "intercom", false],
  ["skills/brainstorming/SKILL.md", "intercom", false],
  ["doc/configuration.md", "intercom", false],
  // unchanged surface (must still be present)
  ["skills/verification-before-completion/reference/conformance-check.md", "keep `origin: none (scope creep)` verbatim", true],
  ["skills/verification-before-completion/reference/conformance-check.md", "Unavailable: scope creep has no origin requirement to defer", true],
  ["agents/conformance-reviewer.md", "use the literal `none (scope creep)`", true],
  // #36 hotfix worktree binding
  ["skills/chase-bug/hotfix.md", 'context: "fresh"', true],
  ["skills/chase-bug/hotfix.md", "fork context", false],
  ["skills/chase-bug/hotfix.md", "git -C <WORKTREE>", true],
];
for (const [file, tok, want] of tokenChecks) {
  const has = txt(file).includes(tok);
  if (has !== want) fail(`${file}: token "${tok.trim()}" ${want ? "missing" : "must be absent"}`);
}
// #36: the first-command toplevel guard must live inside hotfix.md step 4
{
  const hf = txt("skills/chase-bug/hotfix.md");
  const s = hf.indexOf("4. **Implement.**");
  const e = hf.indexOf("5. **Test.**");
  if (s < 0 || e < 0 || e < s) fail("skills/chase-bug/hotfix.md: step 4 / step 5 headings not found in order");
  else {
    const step4 = hf.slice(s, e);
    for (const tok of ["Your first command, before any", "git rev-parse --show-toplevel"]) {
      if (!step4.includes(tok)) fail(`skills/chase-bug/hotfix.md: step 4 lacks "${tok}"`);
    }
  }
}
// both probes in roasting-the-spec name ^lean:
const roastProbeHits = (txt("skills/roasting-the-spec/SKILL.md").match(/`\^lean:` line/g) || []).length;
if (roastProbeHits < 2) fail(`skills/roasting-the-spec/SKILL.md: expected ^lean: in both member and chair probes, found ${roastProbeHits}`);
if (!existsSync(R("skills/brainstorming/reference/superseding.md"))) {
  fail("skills/brainstorming/reference/superseding.md missing");
}
if (!existsSync(R("skills/brainstorming/../../bin/gauntlet-spec-index.mjs"))) {
  fail("gauntlet-spec-index: path from skills/brainstorming does not resolve");
}
for (const skill of ["skills/finishing-a-development-branch", "skills/gatekeep-pr"]) {
  if (!existsSync(R(`${skill}/../../bin/gauntlet-telemetry-salvage.mjs`))) fail(`gauntlet-telemetry-salvage: path from ${skill} does not resolve`);
}
// Telemetry record is a deliverable: the rule and the salvage call sites cannot be edited away silently.
{
  const worktreeFirst = txt("skills/brainstorming/SKILL.md").split(/^## /m).find((s) => s.startsWith("Worktree First")) ?? "";
  if (!worktreeFirst.includes("telemetry record")) fail("skills/brainstorming/SKILL.md: Worktree First must name the telemetry record as a deliverable");
  const finishing = txt("skills/finishing-a-development-branch/SKILL.md");
  if (!finishing.includes("gauntlet-telemetry-salvage.mjs")) fail("skills/finishing-a-development-branch/SKILL.md: missing the gauntlet-telemetry-salvage.mjs call");
  for (const opt of ["#### Option 1: Squash-merge to base", "#### Option 2: Push and Create PR"]) {
    const block = finishing.split(opt)[1]?.split(/^#### /m)[0] ?? "";
    if (!block.includes("telemetry record")) fail(`skills/finishing-a-development-branch/SKILL.md: "${opt}" must name the telemetry record`);
  }
  const gate = txt("skills/gatekeep-pr/SKILL.md");
  const postSelection = gate.split(/^## Post-selection loop/m)[1]?.split(/^## /m)[0] ?? "";
  if (!postSelection.includes("gauntlet-telemetry-salvage.mjs")) fail("skills/gatekeep-pr/SKILL.md: Post-selection loop must call gauntlet-telemetry-salvage.mjs");
  if (!/never delete[^\n]*telemetry/.test(postSelection)) fail("skills/gatekeep-pr/SKILL.md: Post-selection loop must forbid deleting the telemetry record");
}
// touched-files + over-spec in the same paragraph of conformance-check.md
const ccParas = txt("skills/verification-before-completion/reference/conformance-check.md").split(/\n\s*\n/);
if (!ccParas.some((p) => p.includes("touched-files") && p.includes("over-spec"))) fail("conformance-check.md: no paragraph carries both `touched-files` and `over-spec`");
if (errors.length === subtractiveErrorsBefore) ok("subtractive review pass tokens present/absent as specified");

// ---- gauntlet-resume worktree path discipline ------------------------------
{
  const resumeErrorsBefore = errors.length;
  const resumeSkill = txt("skills/gauntlet-resume/SKILL.md");
  const reconstruction = txt("skills/gauntlet-resume/reference/reconstruction.md");
  if (!resumeSkill.includes("git -C <worktree> rev-parse --path-format=absolute --git-common-dir")) {
    fail("gauntlet-resume: entry check 3 must compare the resolved worktree git-common-dir");
  }
  if (!resumeSkill.includes("git rev-parse --path-format=absolute --git-common-dir")) {
    fail("gauntlet-resume: entry check 3 must resolve the session git-common-dir absolutely");
  }
  if (resumeSkill.includes("restart pi in <worktree>")) {
    fail("gauntlet-resume: same-repo worktrees must not require restarting pi in the worktree");
  }
  if (/\bgit (?!-C <worktree>)/.test(reconstruction)) {
    fail("gauntlet-resume reconstruction: git commands must target the resolved worktree with -C");
  }
  if (errors.length === resumeErrorsBefore) ok("gauntlet-resume targets same-repo worktrees by path");
}

// ---- extension syntax (type-stripped parse) --------------------------------
for (const f of walk(R("extensions")).filter((f) => f.endsWith(".ts"))) {
  try {
    execFileSync(process.execPath, ["--experimental-strip-types", "--check", f], { stdio: "pipe" });
  } catch (e) {
    fail(`${f.replace(root + "/", "")}: syntax error\n    ${String(e.stderr || e).split("\n").slice(0, 3).join("\n    ")}`);
  }
}
ok("extensions parse clean (incl. lib/)");

// ---- resolver unit tests ---------------------------------------------------
try {
  execFileSync(
    process.execPath,
    [
      "--experimental-loader",
      R("extensions/test-support/pi-stubs.mjs"),
      "--test",
      R("extensions/lib/gauntlet-settings.test.ts"),
      R("extensions/lib/gauntlet-settings-loader.test.ts"),
      R("extensions/lib/checkout.test.ts"),
      R("extensions/lib/plan-check.test.ts"),
      R("extensions/lib/phase-tracker-helpers.test.ts"),
      R("extensions/plan-tracker.test.ts"),
      R("extensions/phase-tracker.test.ts"),
      R("extensions/verify-before-ship.test.ts"),
      R("extensions/lib/telemetry-paths.test.ts"),
      R("extensions/lib/telemetry-record.test.ts"),
      R("extensions/lib/telemetry-collect.test.ts"),
      R("extensions/lib/telemetry-ship.test.ts"),
      R("extensions/telemetry.test.ts"),
      R("bin/gauntlet-spec-index.test.mjs"),
      R("bin/gauntlet-telemetry-salvage.test.mjs"),
    ],
    { stdio: "pipe" },
  );
  ok("resolver and bin unit tests pass");
} catch (e) {
  fail(`resolver or bin unit tests failed:\n    ${String(e.stdout || e.stderr || e).split("\n").slice(0, 20).join("\n    ")}`);
}

// ---- executable skill examples --------------------------------------------
try {
  execFileSync(process.execPath, [R("scripts/linear-download-doc.test.mjs")], { stdio: "pipe" });
  ok("Linear download recovery example passes offline fixture test");
} catch (e) {
  fail(`Linear download recovery example failed:\n    ${String(e.stdout || e.stderr || e).split("\n").slice(0, 20).join("\n    ")}`);
}

try {
  execFileSync(process.execPath, [R("scripts/stage-skill-lint.test.mjs")], { stdio: "pipe" });
  ok("stage-skill lint fixtures pass");
} catch (e) {
  fail(`stage-skill lint fixtures failed:\n    ${String(e.stdout || e.stderr || e).split("\n").slice(0, 20).join("\n    ")}`);
}

// ---- no ad-hoc settings reads ----------------------------------------------
{
  const offenders = walk(R("extensions"))
    .filter((f) => f.endsWith(".ts"))
    .filter((f) => readFileSync(f, "utf8").includes("pi.settings"))
    .map((f) => f.replace(root + "/", ""));
  if (offenders.length) fail("pi.settings read found (route through the gauntlet-settings helper):\n    " + offenders.join("\n    "));
  else ok("no pi.settings reads in extensions");
}

// ---- stage skills: process in primary, work by path (#37) ---------------------
// Fenced `cd` that changes the process cwd, `git rev-parse --show-toplevel` derivation,
// and "switch into / from inside the worktree" prose are banned in the five stage skills.
{
  const { lintStageSkillDirs } = await import("./stage-skill-lint.mjs");
  const offenders = lintStageSkillDirs(root).map(
    (hit) => `${hit.file}:${hit.line} [${hit.rule}] ${hit.text}`,
  );
  if (offenders.length) fail("stage skills must carry the worktree path, not cd into it:\n    " + offenders.join("\n    "));
  else ok("stage skills carry the worktree path by value");
}

// ---- Claude Code marketplace (.claude-plugin/) -------------------------------
// Guards the gh-11 allowlist: entries must be specific existing skill dirs with
// valid SKILL.md (existence-checked, not count-hardcoded); scan-leak paths
// (".", "./", "./skills", "./skills/") are banned; exclusivity rests on
// source:"./" + strict:false.
{
  const mpErrorsBefore = errors.length;
  const mpPath = R(".claude-plugin/marketplace.json");
  if (!existsSync(mpPath)) {
    fail(".claude-plugin/marketplace.json missing");
  } else {
    let mp = null;
    let parsed = false;
    try {
      mp = JSON.parse(readFileSync(mpPath, "utf8"));
      parsed = true;
    } catch (e) {
      fail(`.claude-plugin/marketplace.json: invalid JSON (${e.message})`);
    }
    if (parsed && (mp === null || typeof mp !== "object" || Array.isArray(mp))) {
      fail("marketplace.json: must be a JSON object");
      mp = null;
    }
    if (mp) {
      if (mp.name !== "pi-gauntlet") fail(`marketplace.json: name must be "pi-gauntlet" (got ${JSON.stringify(mp.name)})`);
      if (!mp.owner || !mp.owner.name) fail("marketplace.json: missing owner.name");
      if (!mp.description) fail("marketplace.json: missing description");
      const plugins = Array.isArray(mp.plugins) ? mp.plugins : [];
      if (plugins.length !== 1) fail(`marketplace.json: expected exactly 1 plugin, got ${plugins.length}`);
      const plugin = plugins[0] || {};
      if (plugin.name !== "gauntlet") fail(`marketplace.json: plugin name must be "gauntlet" (got ${JSON.stringify(plugin.name)})`);
      if (plugin.source !== "./") fail(`marketplace.json: plugin source must be "./" (got ${JSON.stringify(plugin.source)})`);
      if (plugin.strict !== false) fail("marketplace.json: plugin strict must be false");
      if (!Array.isArray(plugin.agents) || plugin.agents.length !== 0) fail("marketplace.json: plugin agents must be [] (suppresses the default agents/ scan - pi personas are not CC plugin agents)");
      const mpSkills = Array.isArray(plugin.skills) ? plugin.skills : [];
      if (mpSkills.length === 0) fail("marketplace.json: plugin skills must be a non-empty array");
      // These entries re-enable Claude Code's full scan and would leak all skills.
      const scanLeaks = new Set([".", "./", "./skills", "./skills/"]);
      const skillDirs = [];
      for (const entry of mpSkills) {
        if (scanLeaks.has(entry)) {
          fail(`marketplace.json: skills entry "${entry}" would re-enable the full scan (allowlist must name specific skill dirs)`);
          continue;
        }
        const dir = R(entry.replace(/^\.\//, ""));
        if (!existsSync(dir) || !statSync(dir).isDirectory()) {
          fail(`marketplace.json: skills path ${entry} is not a directory`);
          continue;
        }
        const skillFile = join(dir, "SKILL.md");
        if (!existsSync(skillFile)) {
          fail(`marketplace.json: ${entry} has no SKILL.md`);
          continue;
        }
        const err = hasFrontmatter(skillFile, ["name", "description"]);
        if (err) fail(`marketplace.json: ${entry}/SKILL.md: ${err}`);
        else skillDirs.push(dir);
      }
      // Bundle-local reference integrity: every .md path a bundled file mentions
      // must resolve against that file's own directory. Excluded: consumer-repo
      // placeholders that intentionally don't exist here.
      const refExcludedBasenames = new Set(["REVIEW.md", "AGENTS.md", "CLAUDE.md", "SKILL.md", "gauntlet-overrides.md", "linear.md"]);
      const brokenRefs = [];
      for (const dir of skillDirs) {
        for (const file of walk(dir).filter((f) => f.endsWith(".md"))) {
          const txt = readFileSync(file, "utf8");
          for (const m of txt.matchAll(/[A-Za-z0-9_.][A-Za-z0-9_./-]*\.md\b/g)) {
            const ref = m[0].replace(/^\.\//, "");
            const base = ref.split("/").at(-1);
            if (refExcludedBasenames.has(base)) continue;
            if (!existsSync(join(dirname(file), ref))) brokenRefs.push(`${file.replace(root + "/", "")}: "${ref}"`);
          }
        }
      }
      if (brokenRefs.length) fail("marketplace.json: broken bundle-local .md refs:\n    " + brokenRefs.join("\n    "));
      if (errors.length === mpErrorsBefore) {
        ok(`marketplace allowlist valid (${mpSkills.length} skills), bundle refs resolve`);
      }
    }
  }
}

// ---- npm pack contents -----------------------------------------------------
try {
  const out = execFileSync("npm", ["pack", "--dry-run", "--json"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const packed = JSON.parse(out)[0].files.map((f) => f.path);
  for (const need of [
    "extensions/lib/gauntlet-settings.ts",
    "extensions/lib/gauntlet-settings-loader.ts",
    "bin/gauntlet-spec-index.mjs",
    "bin/gauntlet-telemetry-salvage.mjs",
    "extensions/lib/telemetry-paths.ts",
    "extensions/lib/telemetry-ship.ts",
    "extensions/lib/phase-tracker-helpers.ts",
  ]) {
    if (!packed.includes(need)) fail(`npm pack: ${need} missing from tarball (runtime would fail)`);
  }
  if (!packed.some((f) => f.startsWith("agents/"))) fail("npm pack: no agents/ in tarball");
  if (packed.some((f) => f.startsWith("doc/"))) fail("npm pack: doc/ leaked into tarball");
  if (packed.some((f) => f.startsWith(".claude-plugin/"))) fail("npm pack: .claude-plugin/ leaked into tarball (Claude Code marketplace is source-only)");
  ok(`npm pack: ${packed.length} files, agents/ + bin/*.mjs and their extension imports present, no doc/ leak`);
} catch (e) {
  fail(`npm pack failed: ${String(e.stderr || e).split("\n")[0]}`);
}

// ---- report ----------------------------------------------------------------
if (errors.length) {
  console.error(`\nFAIL (${errors.length}):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`\nPASS: repo valid${expectVersion ? ` for release v${expectVersion}` : ""}`);
