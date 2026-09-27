import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFakeServices } from '../src/index';
import { createRunnerClient } from '../src/runner-client/index';
import { createLocalExecutor } from '../src/exec/local/index';

const pairing = { session: 'session', runner_version: 'test', root_name: 'repo', remote: '', head: 'a'.repeat(40), platforms: [], host_os: 'linux' };
const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };

test('#19 scans configured port range and retains discovered port for subsequent requests', async t => {
  const requests: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string) => {
    requests.push(input);
    if (input.startsWith('http://127.0.0.1:48000')) throw new TypeError('fetch failed');
    if (input.startsWith('http://127.0.0.1:48001')) return new Response('', { status: 404 });
    return Response.json(input.endsWith('/pair') ? pairing : { ...pairing, busy: false });
  });
  const client = createRunnerClient(buildFakeServices(), 48000);
  t.after(() => client.disconnect());
  assert.ok((await client.pair('123456')).ok);
  assert.ok((await client.getStatus()).ok);
  assert.deepEqual(requests, ['http://127.0.0.1:48000/pair', 'http://127.0.0.1:48001/pair', 'http://127.0.0.1:48002/pair', 'http://127.0.0.1:48002/status']);
});

test('wrong pairing code stops discovery instead of contacting more runners', async t => {
  let attempts = 0;
  t.mock.method(globalThis, 'fetch', async () => { attempts++; return Response.json({ error: 'Wrong pairing code' }, { status: 403 }); });
  const client = createRunnerClient(buildFakeServices());
  assert.equal((await client.pair('bad')).ok, false);
  assert.equal(attempts, 1);
  assert.equal(client.isPaired(), false);
});

test('mismatched repository refuses pairing and remains disconnected', async t => {
  const services = buildFakeServices();
  await services.workspace.writeFile('.git/config', new TextEncoder().encode('[remote "origin"]\nurl = https://github.com/one/repo.git'));
  t.mock.method(globalThis, 'fetch', async () => Response.json({ ...pairing, remote: 'https://github.com/two/repo.git' }));
  const client = createRunnerClient(services);
  assert.equal((await client.pair('123456')).ok, false);
  assert.equal(client.isPaired(), false);
});

test('local executor rejects a truncated SSE stream instead of hanging', async t => {
  t.mock.method(globalThis, 'fetch', async (input: string) => {
    if (input.endsWith('/pair')) return Response.json(pairing);
    if (input.endsWith('/runs')) return Response.json({ run_id: 'run' });
    return new Response('data: {"type":"output","line":"partial"}\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  });
  const services = buildFakeServices();
  services.runnerClient = createRunnerClient(services);
  t.after(() => services.runnerClient.disconnect());
  await services.runnerClient.pair('123456');
  const executor = createLocalExecutor(services);
  await assert.rejects(executor.run({ platform: 'linux', mode: 'all', test_path: '', runs: 1, ref: null }, token, () => {}), /before completion/);
});

test('local executor supports synchronous completion and honours pre-cancellation', async () => {
  const services = buildFakeServices();
  let disposed = false;
  let starts = 0;
  services.runnerClient = {
    ...services.runnerClient,
    pair: async () => ({ ok: true, value: pairing }), disconnect: async () => {}, getStatus: async () => ({ ok: true, value: null }),
    isPaired: () => true,
    startRun: async () => { starts++; return { ok: true, value: { run_id: 'run' } }; },
    openEventStream: (_id, event) => { event({ type: 'done' }); return () => { disposed = true; }; },
    cancelRun: async () => {},
  };
  const executor = createLocalExecutor(services);
  assert.deepEqual(await executor.run({ platform: 'linux', mode: 'all', test_path: '', runs: 1, ref: null }, token, () => {}), []);
  assert.ok(disposed);
  await assert.rejects(executor.run({ platform: 'linux', mode: 'all', test_path: '', runs: 1, ref: null }, { ...token, isCancellationRequested: true }, () => {}), /cancelled/);
  assert.equal(starts, 1);
});
