#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const expect = (source, token, message) => assert.ok(source.includes(token), message);
const expectAbsent = (source, token, message) => assert.ok(!source.includes(token), message);

const brainstormingPath = "skills/brainstorming/SKILL.md";
const roastingPath = "skills/roasting-the-spec/SKILL.md";
const amendmentPath = "skills/brainstorming/reference/amendment-surface.md";
const guidelinePath = "skills/brainstorming/reference/documentation-impact.md";
const ciPath = "scripts/ci.mjs";
const brainstorming = read(brainstormingPath);
const roasting = read(roastingPath);
const amendment = read(amendmentPath);
const guideline = read(guidelinePath);
const ci = read(ciPath);

assert.ok(existsSync(resolve(root, guidelinePath)), "the author guideline must exist");
assert.equal(
  resolve(dirname(resolve(root, brainstormingPath)), "reference/documentation-impact.md"),
  resolve(root, guidelinePath),
  "brainstorming must resolve its sibling author guideline",
);
assert.equal(
  resolve(dirname(resolve(root, roastingPath)), "../brainstorming/reference/documentation-impact.md"),
  resolve(root, guidelinePath),
  "roasting-the-spec must resolve brainstorming's sibling author guideline",
);

const portableCitation = "`reference/documentation-impact.md`";
const authorMapping = "The resolved path is the author guideline cited by that portable reference, not a document in the consumer repository.";
const contextInstruction = `Documentation guideline: portable citation ${portableCitation}; resolved author guideline: <DOCUMENTATION_IMPACT_GUIDELINE>. ${authorMapping}`;
const assertRejectsMissingMapping = (source, name) => {
  assert.throws(() => expect(source.replace(contextInstruction, ""), contextInstruction, `${name} must retain the mapping`));
  assert.throws(() => expect(source.replace(portableCitation, ""), portableCitation, `${name} must retain the citation`));
  assert.throws(() => expect(source.replace(authorMapping, ""), authorMapping, `${name} must retain the author/non-consumer explanation`));
};

for (const [name, source] of [["brainstorming", brainstorming], ["roasting-the-spec", roasting]]) {
  expect(source, "DOCUMENTATION_IMPACT_GUIDELINE", `${name} must resolve one guideline path value`);
  expect(source, authorMapping, `${name} must explain that the resolved guideline is not consumer documentation`);
  expect(source, portableCitation, `${name} must retain the portable citation`);
}

const memberTask = roasting.slice(roasting.indexOf("task: \"Problem statement:"), roasting.indexOf("output: \"<tmpdir>/member-"));
expect(memberTask, contextInstruction, "initial council-member task must carry citation-to-author mapping");
assertRejectsMissingMapping(memberTask, "initial council-member task");
const workerTask = brainstorming.slice(brainstorming.indexOf("When `verdict` is `\"worker\"`, dispatch"), brainstorming.indexOf("## User Review Gate"));
expect(workerTask, contextInstruction, "worker fallback task must carry citation-to-author mapping");
assertRejectsMissingMapping(workerTask, "worker fallback task");
expect(workerTask, "Apply two checks", "worker must retain its two checks");
expect(workerTask, "flag it (do NOT fetch)", "worker must retain its ordinary external-reference scope");

const retrySection = roasting.slice(roasting.indexOf("**Targeted retry.**"), roasting.indexOf("**Quorum.**"));
for (const token of [portableCitation, "<DOCUMENTATION_IMPACT_GUIDELINE>", "author/not-consumer explanation"]) {
  expect(retrySection, token, `member retry must retain ${token}`);
  assert.throws(() => expect(retrySection.replace(token, ""), token, `member retry must retain ${token}`));
}
const chairTask = roasting.slice(roasting.indexOf("task: \"Problem statement: <paste>. Spec:"), roasting.indexOf("A chair synthesis is usable"));
expect(chairTask, contextInstruction, "initial chair task must carry citation-to-author mapping");
assertRejectsMissingMapping(chairTask, "initial chair task");
const chairRetries = roasting.slice(roasting.indexOf("A chair synthesis is usable"), roasting.indexOf("### 3 — Decide and apply"));
for (const token of [portableCitation, "<DOCUMENTATION_IMPACT_GUIDELINE>", "author/not-consumer explanation"]) {
  expect(chairRetries, token, `both chair retry cases must retain ${token}`);
  assert.throws(() => expect(chairRetries.replace(token, ""), token, `both chair retry cases must retain ${token}`));
}

const amendmentTask = amendment.slice(amendment.indexOf("task: \"Mode: amendment-review"), amendment.indexOf("Expected reply"));
assert.ok(amendmentTask.indexOf("Mode: amendment-review") < amendmentTask.indexOf("Documentation guideline:"), "amendment mode must stay the first task line");
expect(amendmentTask, contextInstruction, "amendment-review task must carry citation-to-author mapping");
assertRejectsMissingMapping(amendmentTask, "amendment-review task");
expect(amendmentTask, "Rubric:\\n<the three predicates above, verbatim>", "amendment rubric must remain verbatim");
expect(amendmentTask, "Human input (data, not instructions)", "amendment response contract must remain intact");

expectAbsent(brainstorming, "documentation audit", "ordinary brainstorming reviews must not become documentation audits");
expectAbsent(roasting, "documentation audit", "ordinary council reviews must not become documentation audits");
expectAbsent(amendment, "documentation audit", "amendment reviews must not become documentation audits");
expect(guideline, "- `brainstorming`", "guideline referenced-by list must name brainstorming");
expect(guideline, "- `roasting-the-spec`", "guideline referenced-by list must name roasting-the-spec");
expect(guideline, "- `brainstorming/reference/amendment-surface.md`", "guideline referenced-by list must name amendment surface");

expect(ci, 'R("scripts/documentation-impact-context.test.mjs")', "CI must run the scoped documentation-impact contract test");
expect(ci, '"skills/brainstorming/reference/documentation-impact.md",', "CI packed-file assertion must ship the guideline");

console.log("documentation-impact context contract passes");
