// Real mode (realCoreFactory + core's GitHub client) against a stubbed api.github.com.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mockApp, signIn } from './helpers/app';
import { assertMatches } from './helpers/openapi';
import { realCoreFactory } from '../src/core-factory';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

interface Call { url: string; auth: string | null }

function stubGitHub(routes: Record<string, () => Response>): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const auth = new Headers(init?.headers).get('authorization');
    calls.push({ url, auth });
    for (const [prefix, respond] of Object.entries(routes)) {
      if (url.startsWith(prefix)) { return respond(); }
    }
    return new Response('{"message":"Not Found"}', { status: 404 });
  }) as typeof fetch;
  return calls;
}

const ISSUE = {
  number: 42, title: 'Crash on save', html_url: 'https://github.com/acme/app/issues/42', state: 'open',
  labels: [{ name: 'bug' }], created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-02T00:00:00Z',
};

test('GET issues uses the session token and the labels from .reprise.yml', async () => {
  const calls = stubGitHub({
    'https://api.github.com/repos/acme/app/contents/.reprise.yml': () => new Response('version: 3\nissues:\n  labels: [bug, crash]\n'),
    'https://api.github.com/repos/acme/app/issues': () => Response.json([ISSUE]),
  });
  const app = await mockApp({ coreFactory: realCoreFactory(1000) });
  const cookie = await signIn(app, 'ghp_real');
  const res = await app.inject({ method: 'GET', url: '/api/repos/acme/app/issues', headers: { cookie } });
  assert.equal(res.statusCode, 200, res.body);
  const issues = res.json() as unknown[];
  assert.equal(issues.length, 1);
  assertMatches('GitHubIssue', issues[0]);
  assert.deepEqual((issues[0] as { labels: string[] }).labels, ['bug']);

  const list = calls.find((c) => c.url.startsWith('https://api.github.com/repos/acme/app/issues'))!;
  assert.match(list.url, /labels=bug%2Ccrash/);
  assert.ok(calls.every((c) => c.auth === 'Bearer ghp_real'), 'every GitHub call carries the session token');
});

test('without .reprise.yml the default bug label is used', async () => {
  const calls = stubGitHub({ 'https://api.github.com/repos/acme/app/issues': () => Response.json([]) });
  const app = await mockApp({ coreFactory: realCoreFactory(1000) });
  const cookie = await signIn(app);
  const res = await app.inject({ method: 'GET', url: '/api/repos/acme/app/issues', headers: { cookie } });
  assert.equal(res.statusCode, 200, res.body);
  assert.match(calls.find((c) => c.url.includes('/issues?'))!.url, /labels=bug(&|$)/);
});

test('a GitHub failure surfaces as 502', async () => {
  stubGitHub({ 'https://api.github.com/repos/acme/app/issues': () => new Response('boom', { status: 500 }) });
  const app = await mockApp({ coreFactory: realCoreFactory(1000) });
  const cookie = await signIn(app);
  const res = await app.inject({ method: 'GET', url: '/api/repos/acme/app/issues', headers: { cookie } });
  assert.equal(res.statusCode, 502);
  assertMatches('ApiError', res.json());
});
