import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyUnifiedDiff, PatchError } from '../src/patch';

const files: Record<string, string> = {
  'src/calc.js': 'exports.add = (a, b) => a - b;\nexports.sub = (a, b) => a - b;\n',
  'src/util.js': 'module.exports = 1;\n',
};
const read = async (p: string) => {
  if (!(p in files)) { throw new Error(`no ${p}`); }
  return files[p]!;
};

const FIX = `diff --git a/src/calc.js b/src/calc.js
--- a/src/calc.js
+++ b/src/calc.js
@@ -1,2 +1,2 @@
-exports.add = (a, b) => a - b;
+exports.add = (a, b) => a + b;
 exports.sub = (a, b) => a - b;
`;

test('applies a single-file change', async () => {
  assert.deepEqual(await applyUnifiedDiff(FIX, read), [
    { path: 'src/calc.js', content: 'exports.add = (a, b) => a + b;\nexports.sub = (a, b) => a - b;\n' },
  ]);
});

test('applies changes to several files and creates new ones', async () => {
  const diff = FIX + `--- a/src/util.js
+++ b/src/util.js
@@ -1 +1 @@
-module.exports = 1;
+module.exports = 2;
--- /dev/null
+++ b/src/new.js
@@ -0,0 +1,2 @@
+// new
+exports.x = 1;
`;
  const out = await applyUnifiedDiff(diff, read);
  assert.deepEqual(out.map((f) => f.path), ['src/calc.js', 'src/util.js', 'src/new.js']);
  assert.equal(out[1]!.content, 'module.exports = 2;\n');
  assert.equal(out[2]!.content, '// new\nexports.x = 1;\n');
});

test('rejects deletions, renames, unsafe paths and empty diffs', async () => {
  await assert.rejects(applyUnifiedDiff(`--- a/src/util.js\n+++ /dev/null\n@@ -1 +0,0 @@\n-module.exports = 1;\n`, read), /Deleting files is not supported/);
  await assert.rejects(applyUnifiedDiff(`--- a/src/util.js\n+++ b/src/other.js\n@@ -1 +1 @@\n-module.exports = 1;\n+module.exports = 2;\n`, read), /Renames are not supported/);
  await assert.rejects(applyUnifiedDiff(`--- a/../etc/x\n+++ b/../etc/x\n@@ -1 +1 @@\n-a\n+b\n`, read), PatchError);
  await assert.rejects(applyUnifiedDiff('not a diff at all\n', read), /no file changes/);
});

test('a hunk that does not match names the file', async () => {
  const stale = `--- a/src/calc.js\n+++ b/src/calc.js\n@@ -1 +1 @@\n-exports.add = (a, b) => a * b;\n+exports.add = (a, b) => a + b;\n`;
  await assert.rejects(applyUnifiedDiff(stale, read), (e: unknown) => e instanceof PatchError && e.file === 'src/calc.js' && /does not apply/.test(e.message));
});

test('a file the runner cannot read is a patch error', async () => {
  const diff = `--- a/src/missing.js\n+++ b/src/missing.js\n@@ -1 +1 @@\n-a\n+b\n`;
  await assert.rejects(applyUnifiedDiff(diff, read), (e: unknown) => e instanceof PatchError && e.file === 'src/missing.js');
});
