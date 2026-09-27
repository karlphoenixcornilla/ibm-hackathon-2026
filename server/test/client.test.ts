import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockApp } from './helpers/app';
import { ApiError, RepriseApi } from '../src/api/client';

test('typed client talks to the mock server', async () => {
  const app = await mockApp();
  const base = await app.listen({ port: 0, host: '127.0.0.1' });
  // Node's fetch has no cookie jar; the browser handles this via credentials: 'same-origin'.
  let cookie = '';
  const cookieFetch: typeof fetch = async (input, init) => {
    const headers = { ...(init?.headers as Record<string, string>), ...(cookie ? { cookie } : {}) };
    const res = await fetch(input, { ...init, headers });
    const set = res.headers.get('set-cookie');
    if (set) { cookie = set.split(';')[0]!; }
    return res;
  };
  try {
    const api = new RepriseApi(base, cookieFetch);
    await assert.rejects(api.whoAmI(), (e: unknown) => e instanceof ApiError && e.status === 401);
    assert.deepEqual(await api.signIn('t'), { login: 'mock-user' });
    const issues = await api.listIssues('demo-owner', 'demo-app');
    assert.ok(issues.length > 0);
    const { runId } = await api.propose('demo-owner', 'demo-app', 7);
    assert.equal((await api.getRun(runId)).kind, 'propose');
    const pr = await api.createPr('demo-owner', 'demo-app', 7, { diff: 'd', title: 't', body: 'b', draft: true });
    assert.equal(pr.number, 999);
    await api.signOut();
    await assert.rejects(api.whoAmI(), ApiError);
  } finally {
    await app.close();
  }
});
