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
