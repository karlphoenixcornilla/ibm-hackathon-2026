import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StagedFiles, StagingStore } from '../src/staging';

test('writes go to the base layer; the fix layer wins and is replaced wholesale', () => {
  const s = new StagedFiles();
  const v0 = s.version;
  s.write('test/a.test.js', 'test');
  s.write('src/a.js', 'original-staged');
  assert.ok(s.version > v0);
  s.setFix([{ path: 'src/a.js', content: 'fix1' }, { path: 'src/b.js', content: 'b1' }]);
  assert.equal(s.get('src/a.js'), 'fix1');
  assert.deepEqual(s.files().sort((x, y) => x.path.localeCompare(y.path)), [
    { path: 'src/a.js', content: 'fix1' },
    { path: 'src/b.js', content: 'b1' },
    { path: 'test/a.test.js', content: 'test' },
  ]);
  const v1 = s.version;
  s.setFix([{ path: 'src/c.js', content: 'c' }]);
  assert.ok(s.version > v1);
  assert.equal(s.get('src/b.js'), undefined, 'previous fix dropped');
  assert.equal(s.get('src/a.js'), 'original-staged', 'base layer visible again');
  assert.ok(s.has('test/a.test.js'));
  assert.equal(s.get('nope'), undefined);
});

test('the store keeps one StagedFiles per repo#issue; reset starts empty', () => {
  const store = new StagingStore();
  const a = store.for('o/r', 1);
  a.write('x', 'y');
  assert.equal(store.for('o/r', 1), a);
  assert.notEqual(store.for('o/r', 2), a);
  const fresh = store.reset('o/r', 1);
  assert.notEqual(fresh, a);
  assert.equal(fresh.files().length, 0);
  assert.equal(store.for('o/r', 1), fresh);
});
