import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neverCancelled } from '@reprise/core';
import type { RunEvent, RunRequest, RunResult } from '@reprise/core';
import { RunRegistry } from '../src/runs';
import { RelayExecutor } from '../src/relay-executor';

const REQ: RunRequest = { platform: 'windows', mode: 'single', test_path: 't.test.js', runs: 2, ref: null };

test('unavailable until a browser is subscribed to the run', async () => {
  const run = new RunRegistry().create('s', 'acknowledge', 'o/r', 1);
  const relay = new RelayExecutor(run, 1000);
  assert.equal(relay.id, 'local');
  assert.equal((await relay.available()).available, false);
  run.subscribe(() => undefined);
  assert.deepEqual(await relay.available(), { available: true });
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
