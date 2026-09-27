import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { neverCancelled } from '@reprise/core';
import type { RunEvent, RunRequest, RunResult } from '@reprise/core';
import { RunRegistry } from '../src/runs';
import { RelayExecutor } from '../src/relay-executor';
import { RunnerRelay } from '../src/runner-relay';
import { StagedFiles } from '../src/staging';
import type { RunnerContext } from '../src/repo-context';
import { answerRelay, result } from './helpers/fake-browser';

const REQ: RunRequest = { platform: 'windows', mode: 'single', test_path: 't.test.js', runs: 2, ref: null };
const HEAD = 'c'.repeat(40);
const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

test('unavailable when no browser subscribes within the grace period', async () => {
  const run = new RunRegistry().create('s', 'acknowledge', 'o/r', 1);
  const relay = new RelayExecutor(run, 1000, { connectGraceMs: 5 });
  assert.equal(relay.id, 'local');
  assert.equal((await relay.available()).available, false);
  run.subscribe(() => undefined);
  assert.deepEqual(await relay.available(), { available: true });
});

test('available() waits for a browser that subscribes during the grace period', async () => {
  const run = new RunRegistry().create('s', 'acknowledge', 'o/r', 1);
  const pending = new RelayExecutor(run, 1000, { connectGraceMs: 1000 }).available();
  setTimeout(() => run.subscribe(() => undefined), 10);
  assert.deepEqual(await pending, { available: true });
});

test('run() round-trips through the browser and replays results as events', async () => {
  const run = new RunRegistry().create('s', 'acknowledge', 'o/r', 1);
  const results = [{ exit_code: 1 }, { exit_code: 0 }] as RunResult[];
  run.subscribe((e) => {
    if (e.type === 'exec.request') {
      assert.deepEqual(e.request, REQ);
      queueMicrotask(() => run.settleExec(e.reqId, { ok: true, results }));
    }
  });
  const events: RunEvent[] = [];
  const out = await new RelayExecutor(run, 1000).run(REQ, neverCancelled, (ev) => events.push(ev));
  assert.deepEqual(out, results);
  assert.deepEqual(events.map((e) => e.type), ['result', 'result', 'done']);
});

function withRunner() {
  const run = new RunRegistry().create('s', 'check', 'acme/calc', 1);
  let overlays = 0;
  const browser = answerRelay(run, {
    runner: (call) => {
      if (call.path === '/approve') { return { status: 200, body: { ok: true } }; }
      if (call.path === '/overlays') { overlays++; return { status: 200, body: { overlay_id: `ov${overlays}` } }; }
      return { status: 500, body: { error: 'unexpected' } };
    },
    exec: () => [result()],
  });
  const stage = new StagedFiles();
  const runner: RunnerContext = { relay: new RunnerRelay(run, 1000), head: HEAD, remote: 'https://github.com/acme/calc', stage };
  return { executor: new RelayExecutor(run, 1000, { runner }), browser, stage };
}

test('staged files: approve each, create an overlay on HEAD, run with { overlay }', async () => {
  const { executor, browser, stage } = withRunner();
  stage.write('test/a.test.js', 'T');
  stage.setFix([{ path: 'src/a.js', content: 'F' }]);
  await executor.run(REQ, neverCancelled, () => undefined);
  assert.deepEqual(browser.log, [
    { kind: 'runner', call: { method: 'POST', path: '/approve', body: { path: 'test/a.test.js', sha256: sha256('T') } } },
    { kind: 'runner', call: { method: 'POST', path: '/approve', body: { path: 'src/a.js', sha256: sha256('F') } } },
    { kind: 'runner', call: { method: 'POST', path: '/overlays', body: { base: HEAD, files: [
      { path: 'test/a.test.js', content: 'T' }, { path: 'src/a.js', content: 'F' },
    ] } } },
    { kind: 'exec', request: { ...REQ, ref: { overlay: 'ov1' } } },
  ]);
  assert.equal(await executor.overlayId(), 'ov1');
});

test('the overlay is reused while the stage is unchanged, and rebuilt after it changes', async () => {
  const { executor, browser, stage } = withRunner();
  stage.write('test/a.test.js', 'T');
  await executor.run(REQ, neverCancelled, () => undefined);
  await executor.run(REQ, neverCancelled, () => undefined);
  assert.equal(browser.log.filter((l) => l.kind === 'runner' && l.call.path === '/overlays').length, 1);
  stage.setFix([{ path: 'src/a.js', content: 'F2' }]);
  await executor.run(REQ, neverCancelled, () => undefined);
  const execs = browser.log.filter((l) => l.kind === 'exec');
  assert.deepEqual(execs.map((l) => l.kind === 'exec' && l.request.ref), [{ overlay: 'ov1' }, { overlay: 'ov1' }, { overlay: 'ov2' }]);
});

test('nothing staged: ref null runs HEAD in a worktree; explicit refs pass through', async () => {
  const { executor, browser } = withRunner();
  await executor.run(REQ, neverCancelled, () => undefined);
  await executor.run({ ...REQ, ref: { base: 'abc' } }, neverCancelled, () => undefined);
  assert.deepEqual(browser.log.map((l) => l.kind === 'exec' && l.request.ref), [{ head: HEAD }, { base: 'abc' }]);
});

test('without a runner context ref null is left alone', async () => {
  const run = new RunRegistry().create('s', 'acknowledge', 'o/r', 1);
  const browser = answerRelay(run, { exec: () => [] });
  await new RelayExecutor(run, 1000).run(REQ, neverCancelled, () => undefined);
  assert.deepEqual(browser.log, [{ kind: 'exec', request: REQ }]);
});
