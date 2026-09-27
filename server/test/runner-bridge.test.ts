import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RUNNER_PORTS, RunnerBridge, RunnerError, isAllowedRunnerCall } from '../src/api/runner-bridge';
import { RepriseApi } from '../src/api/client';
import { readSse } from '../src/api/sse';
import type { RunnerCall } from '../src/api/types';
import { mockApp } from './helpers/app';
import { closedPort, cookieFetch } from './helpers/http';
import { FAKE_CODE, FAKE_SESSION, FAKE_STATUS, startFakeRunner } from './helpers/fake-runner';

test('readSse splits events across chunks, skips comments, and awaits each handler in order', async () => {
  const chunks = ['data: {"n":1}\n', '\n: ping\n\ndata: {"n"', ':2}\n\ndata: {"n":3}\n\n'];
  const body = new ReadableStream<Uint8Array>({
    start(c) { for (const ch of chunks) { c.enqueue(new TextEncoder().encode(ch)); } c.close(); },
  });
  const seen: number[] = [];
  await readSse(body, async (data) => {
    const n = (JSON.parse(data) as { n: number }).n;
    await new Promise((r) => setTimeout(r, 3 - n));
    seen.push(n);
    return n < 2; // stop after the second event
  });
  assert.deepEqual(seen, [1, 2]);
});

test('the runner ports are 47410–47419', () => {
  assert.deepEqual([...RUNNER_PORTS], [47410, 47411, 47412, 47413, 47414, 47415, 47416, 47417, 47418, 47419]);
});

test('pair skips ports with nothing listening and remembers the session', async () => {
  const runner = await startFakeRunner();
  try {
    const bridge = new RunnerBridge({ ports: [await closedPort(), runner.port] });
    const info = await bridge.pair(FAKE_CODE);
    assert.equal(info.remote, FAKE_STATUS.remote);
    assert.ok(bridge.paired);
    assert.ok(bridge.sameRepo('acme', 'calc'));
    assert.ok(!bridge.sameRepo('acme', 'other'));
    const file = await bridge.readFile('src/a.js');
    assert.equal(file.content, 'content of src/a.js');
    assert.equal(runner.log.at(-1)!.auth, `Bearer ${FAKE_SESSION}`);
  } finally {
    await runner.close();
  }
});

test('pair reports wrong codes, lockouts and missing runners', async () => {
  const runner = await startFakeRunner();
  try {
    await assert.rejects(new RunnerBridge({ ports: [runner.port] }).pair('000000'), (e: unknown) => e instanceof RunnerError && e.code === 'wrong_code');
    await assert.rejects(new RunnerBridge({ ports: [runner.port] }).pair('locked'), (e: unknown) => e instanceof RunnerError && e.code === 'locked');
  } finally {
    await runner.close();
  }
  const port = await closedPort();
  await assert.rejects(new RunnerBridge({ ports: [port] }).pair(FAKE_CODE), (e: unknown) =>
    e instanceof RunnerError && e.code === 'not_found' && e.message.includes(`ports ${port}–${port}`) && e.message.includes('--allow-origin'));
  await assert.rejects(new RunnerBridge().readFile('x'), (e: unknown) => e instanceof RunnerError && e.code === 'not_paired');
});

test('only the allow-listed runner calls are relayed', () => {
  assert.ok(isAllowedRunnerCall({ method: 'GET', path: '/status' }));
  assert.ok(isAllowedRunnerCall({ method: 'GET', path: '/file?path=a' }));
  assert.ok(isAllowedRunnerCall({ method: 'POST', path: '/approve' }));
  assert.ok(isAllowedRunnerCall({ method: 'POST', path: '/overlays' }));
  for (const bad of [{ method: 'POST', path: '/pair' }, { method: 'POST', path: '/runs' }, { method: 'DELETE', path: '/runs/1' },
    { method: 'GET', path: '/status/../pair' }, { method: 'POST', path: '/status' }]) {
    assert.ok(!isAllowedRunnerCall(bad), `${bad.method} ${bad.path}`);
  }
});

async function withAppAndRunner(
  fn: (ctx: { api: RepriseApi; bridge: RunnerBridge; runner: Awaited<ReturnType<typeof startFakeRunner>> }) => Promise<void>,
  opts: Parameters<typeof mockApp>[0] = {},
  runnerOpts: Parameters<typeof startFakeRunner>[0] = {},
) {
  const runner = await startFakeRunner(runnerOpts);
  const app = await mockApp(opts, { relay: true });
  const base = await app.listen({ port: 0, host: '127.0.0.1' });
  try {
    const api = new RepriseApi(base, cookieFetch());
    await api.signIn('t');
    const bridge = new RunnerBridge({ ports: [runner.port] });
    await bridge.pair(FAKE_CODE);
    await fn({ api, bridge, runner });
  } finally {
    await app.close();
    await runner.close();
  }
}

test('attach services the run: runner status, then a local test run; resolves with the final status', async () => {
  await withAppAndRunner(async ({ api, bridge, runner }) => {
    const { runId } = await api.acknowledge('demo-owner', 'demo-app', 7);
    const output: string[] = [];
    const status = await bridge.attach(api, runId, { onOutput: (l) => output.push(l) });
    assert.equal(status?.state, 'succeeded', status?.error ?? '');
    assert.deepEqual(runner.log.slice(1).map((l) => `${l.method} ${l.url}`), ['GET /status', 'POST /runs', 'GET /runs/abc123/events']);
    assert.deepEqual(output, ['running…']);
  });
});

test('attach refuses runner calls outside the allow-list and processes requests one at a time', async () => {
  const answers: string[] = [];
  await withAppAndRunner(async ({ api, bridge, runner }) => {
    const { runId } = await api.acknowledge('demo-owner', 'demo-app', 7);
    await bridge.attach(api, runId);
    assert.match(answers[0] ?? '', /not allowed: POST \/pair/);
    const statusCalls = runner.log.filter((l) => l.url === '/status');
    assert.equal(statusCalls.length, 2);
    assert.ok(statusCalls[1]!.start >= statusCalls[0]!.end, 'second call started after the first finished');
  }, {
    // A connector that makes a forbidden call, then two concurrent status calls.
    connectRunner: async (run) => {
      const forbidden = { method: 'POST', path: '/pair', body: { code: FAKE_CODE } } as unknown as RunnerCall;
      await run.requestRunner(forbidden, 5000).catch((e: Error) => answers.push(e.message));
      await Promise.all([
        run.requestRunner({ method: 'GET', path: '/status' }, 5000),
        run.requestRunner({ method: 'GET', path: '/status' }, 5000),
      ]);
      return undefined;
    },
  }, { statusDelayMs: 40 });
});
