import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkoutOf, parseCheckout, gitSync, type GitResult } from "./checkout.ts";

const tempDirs: string[] = [];
after(() => { for (const d of tempDirs) rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = realpathSync(mkdtempSync(join(tmpdir(), "checkout-test-"))); tempDirs.push(d); return d; };

const out = (lines: string[]): GitResult => ({ code: 0, stdout: lines.join("\n") + "\n" });

test("parseCheckout: primary checkout when git-dir equals common-dir", () => {
  assert.deepEqual(parseCheckout(out(["/repo", "/repo/.git", "/repo/.git"])), { toplevel: "/repo", isPrimary: true });
});

test("parseCheckout: linked worktree when the dirs differ", () => {
  assert.deepEqual(
    parseCheckout(out(["/repo/.worktrees/x", "/repo/.git/worktrees/x", "/repo/.git"])),
    { toplevel: "/repo/.worktrees/x", isPrimary: false },
  );
});

test("parseCheckout: nonzero code or fewer than three lines -> undefined", () => {
  assert.equal(parseCheckout({ code: 128, stdout: "" }), undefined);
  assert.equal(parseCheckout(out(["/repo", "/repo/.git"])), undefined);
});

test("checkoutOf: a file path runs git in its dirname", async () => {
  const dir = tmp();
  writeFileSync(join(dir, "spec.md"), "# s\n");
  const cwds: string[] = [];
  const git = (_args: string[], cwd: string): GitResult => { cwds.push(cwd); return out([dir, dir + "/.git", dir + "/.git"]); };
  assert.deepEqual(await checkoutOf(join(dir, "spec.md"), git), { toplevel: dir, isPrimary: true });
  assert.deepEqual(cwds, [dir]);
});

test("checkoutOf: a nonexistent leaf walks up to the nearest existing ancestor", async () => {
  const dir = tmp();
  mkdirSync(join(dir, "doc"));
  const cwds: string[] = [];
  const git = async (_args: string[], cwd: string): Promise<GitResult> => { cwds.push(cwd); return out([dir, dir + "/.git", dir + "/.git"]); };
  await checkoutOf(join(dir, "doc", "specs", "new.md"), git);
  assert.deepEqual(cwds, [join(dir, "doc")]);
});

test("checkoutOf: an existing directory is used as-is", async () => {
  const dir = tmp();
  const cwds: string[] = [];
  await checkoutOf(dir, (_a, cwd) => { cwds.push(cwd); return out([dir, dir + "/.git", dir + "/.git"]); });
  assert.deepEqual(cwds, [dir]);
});

test("gitSync: never throws; nonzero code outside a repo", () => {
  const r = gitSync(["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-dir", "--git-common-dir"], tmp());
  assert.notEqual(r.code, 0);
  assert.equal(typeof r.stdout, "string");
});
