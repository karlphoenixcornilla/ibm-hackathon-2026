import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockApp, signIn, waitForRun } from './helpers/app';
import { assertMatches } from './helpers/openapi';
import { notImplementedPrHandler } from '../src/handlers';

const BASE = '/api/repos/demo-owner/demo-app/issues';
const PR = { diff: 'x', title: 'Fix', body: 'b', draft: true };

test('lists issues', async () => {
  const app = await mockApp();
  const cookie = await signIn(app);
  const res = await app.inject({ method: 'GET', url: BASE, headers: { cookie } });
  assert.equal(res.statusCode, 200);
  const issues = res.json() as unknown[];
  assert.ok(issues.length > 0);
  for (const i of issues) { assertMatches('GitHubIssue', i); }
});

test('bad params → 400', async () => {
  const app = await mockApp();
  const cookie = await signIn(app);
  for (const url of ['/api/repos/o/r/issues/abc/record', '/api/repos/o/r/issues/0/record', '/api/repos/o/r%20x/issues']) {
    const res = await app.inject({ method: 'GET', url, headers: { cookie } });
    assert.equal(res.statusCode, 400, url);
  }
});

test('record 404 → acknowledge → record 200', async () => {
  const app = await mockApp();
  const cookie = await signIn(app);
  const before = await app.inject({ method: 'GET', url: `${BASE}/7/record`, headers: { cookie } });
  assert.equal(before.statusCode, 404);

  const ack = await app.inject({ method: 'POST', url: `${BASE}/7/acknowledge`, headers: { cookie }, payload: {} });
  assert.equal(ack.statusCode, 202);
  assertMatches('RunAccepted', ack.json());
  const st = await waitForRun(app, cookie, ack.json().runId);
  assertMatches('RunStatus', st);
  assert.equal(st.state, 'succeeded');
  assert.equal(st.kind, 'acknowledge');
  assert.equal(st.record?.issue, 7);

  const after = await app.inject({ method: 'GET', url: `${BASE}/7/record`, headers: { cookie } });
  assert.equal(after.statusCode, 200);
  assertMatches('IssueRecord', after.json());
});

test('acknowledge accepts an empty body', async () => {
  const app = await mockApp();
  const cookie = await signIn(app);
  const ack = await app.inject({ method: 'POST', url: `${BASE}/7/acknowledge`, headers: { cookie } });
  assert.equal(ack.statusCode, 202);
});

test('propose returns a Proposal', async () => {
  const app = await mockApp();
  const cookie = await signIn(app);
  const res = await app.inject({ method: 'POST', url: `${BASE}/7/propose`, headers: { cookie } });
  assert.equal(res.statusCode, 202);
  const st = await waitForRun(app, cookie, res.json().runId);
  assertMatches('RunStatus', st);
  assert.equal(st.state, 'succeeded');
  assertMatches('Proposal', st.proposal);
  assert.match(st.proposal!.diff, /^--- a\//);
});

test('a failing propose handler fails the run with its message', async () => {
  const app = await mockApp({ propose: { propose: async () => { throw new Error('agent unavailable'); } } });
  const cookie = await signIn(app);
  const res = await app.inject({ method: 'POST', url: `${BASE}/7/propose`, headers: { cookie } });
  const st = await waitForRun(app, cookie, res.json().runId);
  assert.equal(st.state, 'failed');
  assert.equal(st.error, 'agent unavailable');
});

test('pr creates via the handler; 400 on a bad body; 501 when not implemented', async () => {
  const app = await mockApp();
  const cookie = await signIn(app);
  const ok = await app.inject({ method: 'POST', url: `${BASE}/7/pr`, headers: { cookie }, payload: PR });
  assert.equal(ok.statusCode, 201);
  assertMatches('PrCreated', ok.json());

  const bad = await app.inject({ method: 'POST', url: `${BASE}/7/pr`, headers: { cookie }, payload: { ...PR, title: '' } });
  assert.equal(bad.statusCode, 400);

  const app2 = await mockApp({ pr: notImplementedPrHandler });
  const cookie2 = await signIn(app2);
  const ni = await app2.inject({ method: 'POST', url: `${BASE}/7/pr`, headers: { cookie: cookie2 }, payload: PR });
  assert.equal(ni.statusCode, 501);
  assertMatches('ApiError', ni.json());
});

test('a run is invisible to another session', async () => {
  const app = await mockApp();
  const a = await signIn(app, 'a');
  const b = await signIn(app, 'b');
  const ack = await app.inject({ method: 'POST', url: `${BASE}/7/acknowledge`, headers: { cookie: a }, payload: {} });
  const res = await app.inject({ method: 'GET', url: `/api/runs/${ack.json().runId}`, headers: { cookie: b } });
  assert.equal(res.statusCode, 404);
});
