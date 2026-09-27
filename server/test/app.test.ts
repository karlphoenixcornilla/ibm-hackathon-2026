import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockApp } from './helpers/app';
import { assertMatches } from './helpers/openapi';
import { loadConfig } from '../src/config';

test('GET /api/health is public', async () => {
  const app = await mockApp();
  const res = await app.inject({ method: 'GET', url: '/api/health' });
  assert.equal(res.statusCode, 200);
  assertMatches('Health', res.json());
  assert.deepEqual(res.json(), { ok: true, mode: 'mock' });
});

test('GET /api/openapi.json serves the spec', async () => {
  const app = await mockApp();
  const res = await app.inject({ method: 'GET', url: '/api/openapi.json' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().openapi, '3.1.0');
});

test('unknown /api path → JSON 404; other paths → UI index', async () => {
  const app = await mockApp();
  const api = await app.inject({ method: 'GET', url: '/api/nope' });
  assert.equal(api.statusCode, 404);
  assertMatches('ApiError', api.json());
  const root = await app.inject({ method: 'GET', url: '/' });
  assert.equal(root.statusCode, 200);
  assert.match(root.body, /<title>Reprise<\/title>/);
  const deep = await app.inject({ method: 'GET', url: '/issues/7' });
  assert.equal(deep.statusCode, 200);
  assert.match(deep.body, /<title>Reprise<\/title>/);
});

test('cross-origin POST is rejected; the allowed origin passes', async () => {
  const app = await mockApp();
  const evil = await app.inject({
    method: 'POST', url: '/api/session', payload: { token: 't' }, headers: { origin: 'https://evil.example' },
  });
  assert.equal(evil.statusCode, 403);
  const ok = await app.inject({
    method: 'POST', url: '/api/session', payload: { token: 't' }, headers: { origin: 'http://localhost:8787' },
  });
  assert.equal(ok.statusCode, 200);
});

test('config: Render URL becomes the public origin and enables Secure cookies', () => {
  const c = loadConfig({ RENDER_EXTERNAL_URL: 'https://reprise-x.onrender.com/', EXTRA_ORIGINS: 'http://localhost:5173' });
  assert.deepEqual(c.allowedOrigins, ['https://reprise-x.onrender.com', 'http://localhost:5173']);
  assert.equal(c.secureCookies, true);
  assert.equal(c.mode, 'real');
  assert.equal(loadConfig({}).secureCookies, false);
});
