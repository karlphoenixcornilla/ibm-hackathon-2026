import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RunRegistry } from '../src/runs';
import type { RunStreamEvent } from '../src/api/types';
import type { RunRequest, RunResult } from '@reprise/core';

const REQ: RunRequest = { platform: 'windows', mode: 'single', test_path: 't.test.js', runs: 1, ref: null };
const RESULT = { exit_code: 1 } as RunResult;

test('runs are scoped to the creating session', () => {
  const reg = new RunRegistry();
  const run = reg.create('s1', 'acknowledge', 'o/r', 7);
  assert.equal(reg.get(run.id, 's1'), run);
  assert.equal(reg.get(run.id, 's2'), undefined);
});

test('subscribe replays buffered events then streams live ones', () => {
  const reg = new RunRegistry();
  const run = reg.create('s', 'acknowledge', 'o/r', 7);
  run.emit({ type: 'core', event: { type: 'status', text: 'one' } });
  const seen: RunStreamEvent[] = [];
  const off = run.subscribe((e) => seen.push(e));
  run.emit({ type: 'core', event: { type: 'status', text: 'two' } });
  off();
  run.emit({ type: 'core', event: { type: 'status', text: 'three' } });
  assert.deepEqual(seen.map((e) => (e.type === 'core' && e.event.type === 'status' ? e.event.text : '?')), ['one', 'two']);
  assert.equal(run.subscriberCount, 0);
});

test('succeed/fail set status and emit a terminal event once', () => {
  const reg = new RunRegistry();
  const run = reg.create('s', 'propose', 'o/r', 7);
  const seen: RunStreamEvent[] = [];
  run.subscribe((e) => seen.push(e));
  run.fail('boom');
  run.succeed({});
  const st = run.status();
  assert.equal(st.state, 'failed');
  assert.equal(st.error, 'boom');
  assert.ok(st.finished_at);
  assert.deepEqual(seen.map((e) => e.type), ['run.failed']);
});

test('requestExec emits exec.request and resolves on settleExec', async () => {
  const reg = new RunRegistry();
  const run = reg.create('s', 'acknowledge', 'o/r', 7);
  let reqId = '';
  run.subscribe((e) => { if (e.type === 'exec.request') { reqId = e.reqId; } });
  const p = run.requestExec(REQ, 1000);
  assert.ok(reqId);
  assert.equal(run.settleExec(reqId, { ok: true, results: [RESULT] }), 'ok');
  assert.deepEqual(await p, [RESULT]);
  assert.equal(run.settleExec(reqId, { ok: true, results: [] }), 'unknown', 'second settle is rejected');
});

test('requestExec rejects on an error result, on timeout, and on cancel', async () => {
  const reg = new RunRegistry();
  const run = reg.create('s', 'acknowledge', 'o/r', 7);
  const ids: string[] = [];
  run.subscribe((e) => { if (e.type === 'exec.request') { ids.push(e.reqId); } });

  const a = run.requestExec(REQ, 1000);
  run.settleExec(ids[0]!, { ok: false, error: 'runner down' });
  await assert.rejects(a, /runner down/);

  await assert.rejects(run.requestExec(REQ, 10), /timed out/);

  const c = run.requestExec(REQ, 1000);
  run.cancel();
  await assert.rejects(c, /cancelled/);
});

test('finishing a run rejects pending relay requests', async () => {
  const run = new RunRegistry().create('s', 'acknowledge', 'o/r', 7);
  const p = run.requestExec(REQ, 1000);
  run.fail('stopped');
  await assert.rejects(p, /cancelled/);
});

test('sweep drops finished runs older than the retention window', () => {
  let t = 0;
  const reg = new RunRegistry({ retainMs: 1000, now: () => t });
  const done = reg.create('s', 'propose', 'o/r', 1);
  const live = reg.create('s', 'propose', 'o/r', 2);
  done.succeed({});
  t = 2000;
  reg.sweep();
  assert.equal(reg.get(done.id, 's'), undefined);
  assert.equal(reg.get(live.id, 's'), live);
});

test('requestRunner emits runner.request and resolves with the runner response', async () => {
  const run = new RunRegistry().create('s', 'check', 'o/r', 7);
  const calls: RunStreamEvent[] = [];
  run.subscribe((e) => calls.push(e));
  const p = run.requestRunner({ method: 'GET', path: '/status' }, 1000);
  const ev = calls.find((e) => e.type === 'runner.request');
  if (ev?.type !== 'runner.request') { assert.fail('no runner.request'); }
  assert.deepEqual(ev.call, { method: 'GET', path: '/status' });
  assert.equal(run.settleExec(ev.reqId, { ok: true, status: 404, body: { error: 'nope' } }), 'ok');
  assert.deepEqual(await p, { status: 404, body: { error: 'nope' } });
});

test('an answer of the wrong kind is invalid and leaves the request pending', async () => {
  const run = new RunRegistry().create('s', 'check', 'o/r', 7);
  const ids: Record<string, string> = {};
  run.subscribe((e) => { if (e.type === 'exec.request' || e.type === 'runner.request') { ids[e.type] = e.reqId; } });
  const exec = run.requestExec(REQ, 1000);
  const call = run.requestRunner({ method: 'GET', path: '/status' }, 1000);
  assert.equal(run.settleExec(ids['exec.request']!, { ok: true, status: 200, body: {} }), 'invalid');
  assert.equal(run.settleExec(ids['runner.request']!, { ok: true, results: [] }), 'invalid');
  assert.equal(run.settleExec(ids['exec.request']!, { ok: true, results: [RESULT] }), 'ok');
  assert.equal(run.settleExec(ids['runner.request']!, { ok: false, error: 'runner offline' }), 'ok');
  assert.deepEqual(await exec, [RESULT]);
  await assert.rejects(call, /runner offline/);
});

test('succeed records a local check', () => {
  const run = new RunRegistry().create('s', 'check', 'o/r', 7);
  const check = {
    base_sha: 'abc', overlay_id: 'ov', files: [], regression: null, verdict: 'FIX_VERIFIED' as const,
    repro: { test_file: 't', runs: 1, failed: 0, fixed: true },
  };
  run.succeed({ check });
  assert.deepEqual(run.status().check, check);
});
