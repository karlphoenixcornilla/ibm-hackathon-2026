import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockApp, signIn, waitForRun } from './helpers/app';
import { assertMatches } from './helpers/openapi';
import { RunRegistry } from '../src/runs';
import type { RunStreamEvent } from '../src/api/types';

const STATUS = { remote: 'https://github.com/o/r.git', head: 'f'.repeat(40), busy: false };

function parseSse(body: string): RunStreamEvent[] {
  return body.split('\n\n').filter((b) => b.startsWith('data: ')).map((b) => JSON.parse(b.slice(6)) as RunStreamEvent);
}

test('SSE replays a finished run and closes', async () => {
  const app = await mockApp();
  const cookie = await signIn(app);
  const ack = await app.inject({ method: 'POST', url: '/api/repos/o/r/issues/7/acknowledge', headers: { cookie }, payload: {} });
  const runId = ack.json().runId as string;
  await waitForRun(app, cookie, runId);

  const res = await app.inject({ method: 'GET', url: `/api/runs/${runId}/events`, headers: { cookie } });
  assert.equal(res.statusCode, 200);
  assert.match(String(res.headers['content-type']), /text\/event-stream/);
  const events = parseSse(res.body);
  for (const e of events) { assertMatches('RunStreamEvent', e); }
  assert.equal(events.at(-1)!.type, 'run.done');
  assert.ok(events.some((e) => e.type === 'core' && e.event.type === 'status'));
  assert.ok(events.some((e) => e.type === 'core' && e.event.type === 'record.updated'));
});

test('relay round trip over real HTTP: exec.request → POST result → run finishes', async () => {
  const app = await mockApp({}, { relay: true });
  const base = await app.listen({ port: 0, host: '127.0.0.1' });
  try {
    const login = await fetch(`${base}/api/session`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 't' }),
    });
    const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
    const json = { cookie, 'content-type': 'application/json' };
    const ack = await fetch(`${base}/api/repos/o/r/issues/7/acknowledge`, { method: 'POST', headers: json, body: '{}' });
    const { runId } = (await ack.json()) as { runId: string };

    const stream = await fetch(`${base}/api/runs/${runId}/events`, { headers: { cookie } });
    const reader = stream.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    const seen: RunStreamEvent[] = [];
    for (;;) {
      const { value, done } = await reader.read();
      if (done) { break; }
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        if (!block.startsWith('data: ')) { continue; }
        const e = JSON.parse(block.slice(6)) as RunStreamEvent;
        assertMatches('RunStreamEvent', e);
        seen.push(e);
        if (e.type === 'runner.request') {
          assert.deepEqual(e.call, { method: 'GET', path: '/status' });
          const url = `${base}/api/runs/${runId}/exec/${e.reqId}`;
          const wrongKind = await fetch(url, { method: 'POST', headers: json, body: JSON.stringify({ ok: true, results: [] }) });
          assert.equal(wrongKind.status, 400, 'a runner.request needs { ok, status, body }');
          const post = await fetch(url, { method: 'POST', headers: json, body: JSON.stringify({ ok: true, status: 200, body: STATUS }) });
          assert.equal(post.status, 204);
        }
        if (e.type === 'exec.request') {
          assert.deepEqual(e.request.ref, { head: STATUS.head }, 'nothing staged → HEAD worktree');
          const url = `${base}/api/runs/${runId}/exec/${e.reqId}`;
          const post = await fetch(url, { method: 'POST', headers: json, body: JSON.stringify({ ok: true, results: [] }) });
          assert.equal(post.status, 204);
          const again = await fetch(url, { method: 'POST', headers: json, body: JSON.stringify({ ok: true, results: [] }) });
          assert.equal(again.status, 404, 'already settled');
        }
      }
    }
    assert.deepEqual(seen.filter((e) => e.type.endsWith('.request')).map((e) => e.type), ['runner.request', 'exec.request']);
    assert.equal(seen.at(-1)!.type, 'run.done');
  } finally {
    await app.close();
  }
});

test('relay error result fails the run', async () => {
  const runs = new RunRegistry();
  const app = await mockApp({ runs }, { relay: true });
  const cookie = await signIn(app);
  const sessionId = cookie.split('=')[1]!;
  const ack = await app.inject({ method: 'POST', url: '/api/repos/o/r/issues/7/acknowledge', headers: { cookie }, payload: {} });
  const runId = ack.json().runId as string;

  // Stand in for the browser: answer the runner connection, then fail the test run.
  const reqId = await new Promise<string>((resolve) => {
    const run = runs.get(runId, sessionId)!;
    run.subscribe((e) => {
      if (e.type === 'runner.request') { run.settleExec(e.reqId, { ok: true, status: 200, body: STATUS }); }
      if (e.type === 'exec.request') { resolve(e.reqId); }
    });
  });
  const post = await app.inject({
    method: 'POST', url: `/api/runs/${runId}/exec/${reqId}`, headers: { cookie }, payload: { ok: false, error: 'runner offline' },
  });
  assert.equal(post.statusCode, 204);
  const st = await waitForRun(app, cookie, runId);
  assert.equal(st.state, 'failed');
  assert.match(st.error ?? '', /runner offline/);
});

test('unknown run → 404; malformed exec result → 400', async () => {
  const app = await mockApp();
  const cookie = await signIn(app);
  const res = await app.inject({ method: 'GET', url: '/api/runs/nope', headers: { cookie } });
  assert.equal(res.statusCode, 404);
  const ev = await app.inject({ method: 'GET', url: '/api/runs/nope/events', headers: { cookie } });
  assert.equal(ev.statusCode, 404);
  const bad = await app.inject({ method: 'POST', url: '/api/runs/nope/exec/r', headers: { cookie }, payload: { ok: 'yes' } });
  assert.equal(bad.statusCode, 400);
});
