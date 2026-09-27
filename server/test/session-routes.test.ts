import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { mockApp, signIn } from './helpers/app';
import { assertMatches } from './helpers/openapi';

test('sign in → whoami → sign out', async () => {
  const app = await mockApp();
  const login = await app.inject({ method: 'POST', url: '/api/session', payload: { token: 'ghp_secret123' } });
  assert.equal(login.statusCode, 200);
  assertMatches('SessionInfo', login.json());
  assert.ok(!login.body.includes('ghp_secret123'), 'token never echoed');
  const cookie = login.cookies.find((c) => c.name === 'reprise_sid')!;
  assert.equal(cookie.httpOnly, true);
  assert.equal(cookie.sameSite, 'Strict');
  assert.equal(cookie.path, '/api');

  const headers = { cookie: `reprise_sid=${cookie.value}` };
  const me = await app.inject({ method: 'GET', url: '/api/session', headers });
  assert.deepEqual(me.json(), { login: 'mock-user' });

  const out = await app.inject({ method: 'DELETE', url: '/api/session', headers });
  assert.equal(out.statusCode, 204);
  const after = await app.inject({ method: 'GET', url: '/api/session', headers });
  assert.equal(after.statusCode, 401);
});

test('rejected token → 401; missing token → 400', async () => {
  const app = await mockApp({ validateToken: async () => null });
  const bad = await app.inject({ method: 'POST', url: '/api/session', payload: { token: 'x' } });
  assert.equal(bad.statusCode, 401);
  assertMatches('ApiError', bad.json());
  const missing = await app.inject({ method: 'POST', url: '/api/session', payload: {} });
  assert.equal(missing.statusCode, 400);
});

test('protected endpoints require a session', async () => {
  const app = await mockApp();
  for (const [method, url] of [
    ['GET', '/api/session'],
    ['DELETE', '/api/session'],
    ['GET', '/api/repos/o/r/issues'],
    ['POST', '/api/repos/o/r/issues/1/acknowledge'],
    ['GET', '/api/runs/x'],
  ] as const) {
    const res = await app.inject({ method, url });
    assert.equal(res.statusCode, 401, `${method} ${url}`);
  }
});

test('the token and session id never reach the logs', async () => {
  let logs = '';
  const stream = new Writable({ write(chunk, _enc, cb) { logs += chunk.toString(); cb(); } });
  const app = await mockApp({ logger: { level: 'trace', stream } });
  const cookie = await signIn(app, 'ghp_supersecret');
  await app.inject({ method: 'GET', url: '/api/session', headers: { cookie } });
  assert.ok(logs.length > 0, 'something was logged');
  assert.ok(!logs.includes('ghp_supersecret'));
  assert.ok(!logs.includes(cookie.split('=')[1]!), 'session id not logged');
});
