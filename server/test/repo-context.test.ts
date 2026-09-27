import { test } from 'node:test';
import assert from 'node:assert/strict';
import { remoteMatches } from '../src/api/remote';
import { connectRunner } from '../src/repo-context';
import { RunRegistry } from '../src/runs';
import { StagedFiles } from '../src/staging';
import { answerRelay } from './helpers/fake-browser';

const STATUS = { remote: 'https://github.com/acme/calc.git', head: 'a'.repeat(40), busy: false };

test('remoteMatches accepts the usual GitHub remote forms, case-insensitively', () => {
  for (const r of ['https://github.com/acme/calc', 'https://github.com/acme/calc.git', 'git@github.com:acme/calc.git',
    'ssh://git@github.com/acme/calc.git', 'https://github.com/ACME/Calc/']) {
    assert.ok(remoteMatches(r, 'acme/calc'), r);
  }
  for (const r of ['https://github.com/acme/calc2', 'https://github.com/other/calc', '', 'https://gitlab.com/acme/calc']) {
    assert.ok(!remoteMatches(r, 'acme/calc'), r);
  }
});

test('connectRunner fails fast when no browser attaches', async () => {
  const run = new RunRegistry().create('s', 'check', 'acme/calc', 1);
  await assert.rejects(
    connectRunner(run, 'acme/calc', new StagedFiles(), { graceMs: 5, timeoutMs: 1000, checkRepo: true }),
    /Open the Review UI/,
  );
});

test('connectRunner checks the runner serves the same repository', async () => {
  const run = new RunRegistry().create('s', 'check', 'acme/other', 1);
  answerRelay(run, { runner: () => ({ status: 200, body: STATUS }) });
  await assert.rejects(
    connectRunner(run, 'acme/other', new StagedFiles(), { graceMs: 100, timeoutMs: 1000, checkRepo: true }),
    /serving https:\/\/github\.com\/acme\/calc\.git, not acme\/other/,
  );
});

test('connectRunner resolves head/remote, and can skip the repo check', async () => {
  const run = new RunRegistry().create('s', 'check', 'acme/calc', 1);
  const browser = answerRelay(run, { runner: () => ({ status: 200, body: STATUS }) });
  const stage = new StagedFiles();
  const ctx = await connectRunner(run, 'acme/calc', stage, { graceMs: 100, timeoutMs: 1000, checkRepo: true });
  assert.equal(ctx.head, STATUS.head);
  assert.equal(ctx.remote, STATUS.remote);
  assert.equal(ctx.stage, stage);
  assert.deepEqual(browser.log, [{ kind: 'runner', call: { method: 'GET', path: '/status' } }]);

  const lenient = await connectRunner(run, 'someone/else', stage, { graceMs: 100, timeoutMs: 1000, checkRepo: false });
  assert.equal(lenient.head, STATUS.head);
});

test('a runner error surfaces with its message', async () => {
  const run = new RunRegistry().create('s', 'check', 'acme/calc', 1);
  answerRelay(run, { runner: () => ({ status: 500, body: { error: 'boom' } }) });
  await assert.rejects(
    connectRunner(run, 'acme/calc', new StagedFiles(), { graceMs: 100, timeoutMs: 1000, checkRepo: true }),
    /Runner GET \/status: boom/,
  );
});
