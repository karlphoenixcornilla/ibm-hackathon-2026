import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import { MockWorld, mockRecord } from '../src/mock';
import { mockCoreFactory, realCoreFactory } from '../src/core-factory';
import { RelayExecutor } from '../src/relay-executor';
import { RunRegistry } from '../src/runs';
import type { RunStreamEvent } from '../src/api/types';

// core's JSON Schema for records; tests run from out/test.
const RECORD_SCHEMA = path.resolve(__dirname, '../../../core/src/contracts/schemas/issue-record.schema.json');
const recordSchema = JSON.parse(fs.readFileSync(RECORD_SCHEMA, 'utf8')) as object;

test('the mock record satisfies core\'s issue-record schema', () => {
  const validate = new Ajv2020({ strict: false, validateFormats: false }).compile(recordSchema);
  const ok = validate(mockRecord('demo-owner/demo-app', 7, 'x'));
  assert.ok(ok, JSON.stringify(validate.errors));
});

test('real factory wires the token and swaps in the relay when given a run', () => {
  const run = new RunRegistry().create('s', 'acknowledge', 'o/r', 1);
  const core = realCoreFactory(1000)({ token: 'tok', repo: 'o/r', run });
  assert.equal(core.auth.getToken(), 'tok');
  assert.ok(core.executors.local instanceof RelayExecutor);
  const seen: RunStreamEvent[] = [];
  run.subscribe((e) => seen.push(e));
  core.notifier.emit({ type: 'info', message: 'hi' });
  assert.deepEqual(seen, [{ type: 'core', event: { type: 'info', message: 'hi' } }]);
});

test('mock acknowledge emits progress and stores a record', async () => {
  const world = new MockWorld({ stepMs: 0 });
  const run = new RunRegistry().create('s', 'acknowledge', 'demo-owner/demo-app', 7);
  const core = mockCoreFactory(world, 1000)({ token: 'x', repo: 'demo-owner/demo-app', run });
  const seen: RunStreamEvent[] = [];
  run.subscribe((e) => seen.push(e));
  const r = await core.pipeline.acknowledge('demo-owner/demo-app', 7);
  if (!r.ok) { assert.fail(r.error); }
  assert.equal(r.value.issue, 7);
  assert.equal(r.value.title, 'Login crashes on Android 14 with biometric enabled');
  assert.ok(seen.some((e) => e.type === 'core' && e.event.type === 'record.updated'));
  const later = mockCoreFactory(world, 1000)({ token: 'x', repo: 'demo-owner/demo-app' });
  const again = await later.store.load('demo-owner/demo-app', 7);
  assert.ok(again.ok && again.value, 'record visible to later requests');
});

test('with a runner context, core reads the local clone through the relay and stages writes', async () => {
  const { RunnerRelay } = await import('../src/runner-relay');
  const { StagedFiles } = await import('../src/staging');
  const { answerRelay } = await import('./helpers/fake-browser');
  const run = new RunRegistry().create('s', 'acknowledge', 'acme/calc', 1);
  const head = 'd'.repeat(40);
  const browser = answerRelay(run, {
    runner: () => ({ status: 200, body: { path: '.reprise.yml', ref: head, sha256: 'x', content: 'version: 3\nissues:\n  labels: [crash]\n' } }),
  });
  const stage = new StagedFiles();
  const core = realCoreFactory(1000)({
    token: 'tok', repo: 'acme/calc', run,
    runner: { relay: new RunnerRelay(run, 1000), head, remote: 'https://github.com/acme/calc', stage },
  });
  const cfg = await core.config.load();
  assert.ok(cfg.ok, cfg.ok ? '' : cfg.error);
  assert.deepEqual(cfg.value.issues.labels, ['crash']);
  assert.deepEqual(browser.log, [{ kind: 'runner', call: { method: 'GET', path: `/file?path=.reprise.yml&ref=${head}` } }]);

  const written = await core.workspace.writeFile('test/x.test.js', new TextEncoder().encode('T'));
  assert.ok(written.ok);
  assert.equal(stage.get('test/x.test.js'), 'T');
});
