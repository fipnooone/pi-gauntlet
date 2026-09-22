#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const expect = (source, token, message) => assert.ok(source.includes(token), message);

const brainstormingPath = "skills/brainstorming/SKILL.md";
const roastingPath = "skills/roasting-the-spec/SKILL.md";
const amendmentPath = "skills/brainstorming/reference/amendment-surface.md";
const guidelinePath = "skills/brainstorming/reference/documentation-impact.md";
const ciPath = "scripts/ci.mjs";
const portableCitation = "`reference/documentation-impact.md`";
const authorMapping = "The resolved path is the author guideline cited by that portable reference, not a document in the consumer repository.";
const contextInstruction = `Documentation guideline: portable citation ${portableCitation}; resolved author guideline: <DOCUMENTATION_IMPACT_GUIDELINE>. ${authorMapping}`;
const guidelineReadFailure = "If a requested read of the resolved documentation guideline fails, report the error; do not search for or substitute another document.";
const guidelineNoLeak = "When using the resolved documentation guideline, never copy its absolute package path or content into the spec; this does not prohibit repairing an unrelated external reference required by the task.";
const workerPortableCitation = "Preserve the spec's portable citation `reference/documentation-impact.md`; do not remove it as redundant or replace it with the resolved absolute path.";
const retryReuse = "Reuse the complete initial task verbatim, including the documentation guideline mapping, guideline-only read-failure handling, and guideline-only no-leak rule. Only change the permitted retry output path or model.";
const brainstormingResolution = "Before dispatching the council or worker, resolve `reference/documentation-impact.md` relative to this loaded skill as one absolute `<DOCUMENTATION_IMPACT_GUIDELINE>` path value.";
const roastingResolution = "Resolve `../brainstorming/reference/documentation-impact.md` relative to this loaded skill as one absolute `<DOCUMENTATION_IMPACT_GUIDELINE>` path value.";
const amendmentResolution = "Resolve `reference/documentation-impact.md` relative to the loaded brainstorming SKILL directory as one absolute `<DOCUMENTATION_IMPACT_GUIDELINE>` path value before this dispatch.";
const undesiredChildTaskCommands = ["Read the documentation guideline before every review.", "Conduct a documentation audit."];
const harmlessDocumentationNegations = ["This is not a documentation audit.", "Do not conduct a documentation audit."];

const taskBetween = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const assertChildTask = (source, name) => {
  for (const token of [contextInstruction, guidelineReadFailure, guidelineNoLeak]) {
    expect(source, token, `${name} must retain ${token}`);
  }
  for (const command of undesiredChildTaskCommands) {
    assert.ok(!source.includes(command), `${name} must not contain an unconditional command: ${command}`);
  }
};
const validateContracts = ({ brainstorming, roasting, amendment }) => {
  assert.ok(existsSync(resolve(root, guidelinePath)), "the author guideline must exist");
  assert.equal(resolve(dirname(resolve(root, brainstormingPath)), "reference/documentation-impact.md"), resolve(root, guidelinePath), "brainstorming must resolve its sibling author guideline");
  assert.equal(resolve(dirname(resolve(root, roastingPath)), "../brainstorming/reference/documentation-impact.md"), resolve(root, guidelinePath), "roasting-the-spec must resolve brainstorming's sibling author guideline");

  const memberTask = taskBetween(roasting, 'task: "Problem statement:', 'output: "<tmpdir>/member-');
  const chairTask = taskBetween(roasting, 'task: "Problem statement: <paste>. Spec:', "A chair synthesis is usable");
  const workerTask = taskBetween(brainstorming, 'When `verdict` is `"worker"`, dispatch', "## User Review Gate");
  const amendmentTask = taskBetween(amendment, 'task: "Mode: amendment-review', "Expected reply");
  for (const [name, task] of [["initial council-member task", memberTask], ["initial chair task", chairTask], ["worker fallback task", workerTask], ["amendment-review task", amendmentTask]]) {
    assertChildTask(task, name);
  }
  expect(workerTask, workerPortableCitation, "worker must preserve the spec's portable citation inside the dispatched task");

  const retrySection = taskBetween(roasting, "**Targeted retry.**", "**Quorum.**");
  const chairRetries = taskBetween(roasting, "A chair synthesis is usable", "### 3 — Decide and apply");
  for (const [name, section] of [["member retry", retrySection], ["chair retries", chairRetries]]) {
    expect(section, retryReuse, `${name} must reuse the complete initial task verbatim`);
  }

  const amendmentDispatch = taskBetween(amendment, "## 3. Reviewer - one dispatch per batch", "Expected reply");
  expect(brainstorming, brainstormingResolution, "brainstorming must resolve its loaded-skill documentation guideline");
  expect(roasting, roastingResolution, "roasting must resolve its loaded-skill documentation guideline");
  expect(amendmentDispatch, amendmentResolution, "amendment dispatch must resolve the exact reference path from the brainstorming skill directory");
  expect(workerTask, "flag it (do NOT fetch)", "worker must retain ordinary external-reference routing");
};

const brainstorming = read(brainstormingPath);
const roasting = read(roastingPath);
const amendment = read(amendmentPath);
const guideline = read(guidelinePath);
const ci = read(ciPath);
validateContracts({ brainstorming, roasting, amendment });
for (const negation of harmlessDocumentationNegations) {
  assert.doesNotThrow(() => validateContracts({ brainstorming: brainstorming.replace(contextInstruction, `${contextInstruction} ${negation}`), roasting, amendment }), `allowed wording must not be rejected: ${negation}`);
}
assert.throws(() => validateContracts({ brainstorming: brainstorming.replace(brainstormingResolution, ""), roasting, amendment }), "removing brainstorming resolution must fail the shared validator");
assert.throws(() => validateContracts({ brainstorming, roasting: roasting.replace(roastingResolution, ""), amendment }), "removing roasting resolution must fail the shared validator");
assert.throws(() => validateContracts({ brainstorming, roasting, amendment: amendment.replace(amendmentResolution, "") }), "removing amendment resolution must fail the shared validator");
assert.throws(() => validateContracts({ brainstorming, roasting: roasting.replace(contextInstruction, ""), amendment }), "removing the mapping must fail the shared validator");
assert.throws(() => validateContracts({ brainstorming: brainstorming.replace(workerPortableCitation, ""), roasting, amendment }), "removing the worker portable-citation instruction must fail the shared validator");
assert.throws(() => validateContracts({ brainstorming: brainstorming.replace(workerPortableCitation, "") + workerPortableCitation, roasting, amendment }), "moving the worker portable-citation instruction out of the dispatched task must fail the shared validator");
assert.throws(() => validateContracts({ brainstorming, roasting: roasting.replace(retryReuse, ""), amendment }), "removing retry reuse must fail the shared validator");
assert.throws(() => validateContracts({ brainstorming: brainstorming.replace(contextInstruction, `${contextInstruction} Read the documentation guideline before every review.`), roasting, amendment }), "an unconditional guideline read in an actual child task must fail the shared validator");
assert.throws(() => validateContracts({ brainstorming: brainstorming.replace(contextInstruction, `${contextInstruction} Conduct a documentation audit.`), roasting, amendment }), "an unconditional documentation audit in an actual child task must fail the shared validator");
expect(guideline, "- `brainstorming`", "guideline referenced-by list must name brainstorming");
expect(guideline, "- `roasting-the-spec`", "guideline referenced-by list must name roasting-the-spec");
expect(guideline, "- `brainstorming/reference/amendment-surface.md`", "guideline referenced-by list must name amendment surface");
expect(ci, 'R("scripts/documentation-impact-context.test.mjs")', "CI must run the scoped documentation-impact contract test");
expect(ci, '"skills/brainstorming/reference/documentation-impact.md",', "CI packed-file assertion must ship the guideline");
console.log("documentation-impact context contract passes");
