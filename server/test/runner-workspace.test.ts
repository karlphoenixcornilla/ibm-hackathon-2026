import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRunnerWorkspace } from '../src/runner-workspace';
import { RunnerRelay } from '../src/runner-relay';
import { RunRegistry } from '../src/runs';
import { StagedFiles } from '../src/staging';
import { answerRelay } from './helpers/fake-browser';
import type { RunnerContext } from '../src/repo-context';

const HEAD = 'b'.repeat(40);
const decode = (b: Uint8Array) => new TextDecoder().decode(b);

function setup(files: Record<string, string>) {
  const run = new RunRegistry().create('s', 'check', 'acme/calc', 1);
  const browser = answerRelay(run, {
    runner: (call) => {
      const url = new URL(call.path, 'http://runner');
      const path = url.searchParams.get('path') ?? '';
      if (url.pathname !== '/file') { return { status: 500, body: { error: 'unexpected' } }; }
      if (!(path in files)) { return { status: 404, body: { error: `${path} is not a tracked file` } }; }
      return { status: 200, body: { path, ref: url.searchParams.get('ref'), sha256: 'x', content: files[path] } };
    },
  });
  const stage = new StagedFiles();
  const ctx: RunnerContext = { relay: new RunnerRelay(run, 1000), head: HEAD, remote: 'https://github.com/acme/calc', stage };
  return { fs: createRunnerWorkspace(ctx), browser, stage };
}

test('reads come from the runner at the paired HEAD', async () => {
  const { fs, browser } = setup({ 'src/a.js': 'A' });
  assert.equal(decode(await fs.readFile('src/a.js')), 'A');
  assert.deepEqual(browser.log, [{ kind: 'runner', call: { method: 'GET', path: `/file?path=src%2Fa.js&ref=${HEAD}` } }]);
  assert.match(fs.getRoot() ?? '', /^runner:/);
});

test('staged content wins and needs no runner call; writes are staged, not sent', async () => {
  const { fs, browser, stage } = setup({ 'src/a.js': 'A' });
  await fs.writeFile('test/new.test.js', new TextEncoder().encode('T'));
  assert.equal(stage.get('test/new.test.js'), 'T');
  assert.equal(decode(await fs.readFile('test/new.test.js')), 'T');
  assert.equal(browser.log.length, 0);
});

test('a file the runner does not have rejects', async () => {
  const { fs } = setup({});
  await assert.rejects(fs.readFile('missing.js'), /not a tracked file/);
});
