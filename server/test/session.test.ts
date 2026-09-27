import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionStore } from '../src/session';

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

test('create → get returns the session with the token', () => {
  const c = clock();
  const store = new SessionStore({ idleMs: 1000, absoluteMs: 5000, now: c.now });
  const s = store.create('tok', 'octocat');
  assert.match(s.id, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(store.get(s.id)?.token, 'tok');
  assert.equal(store.get(s.id)?.login, 'octocat');
});

test('idle expiry, and get() refreshes lastSeen', () => {
  const c = clock();
  const store = new SessionStore({ idleMs: 1000, absoluteMs: 60_000, now: c.now });
  const s = store.create('tok', 'u');
  c.advance(900); assert.ok(store.get(s.id));
  c.advance(900); assert.ok(store.get(s.id), 'refreshed by the previous get');
  c.advance(1001); assert.equal(store.get(s.id), undefined);
});

test('absolute expiry even when active', () => {
  const c = clock();
  const store = new SessionStore({ idleMs: 1000, absoluteMs: 2500, now: c.now });
  const s = store.create('tok', 'u');
  for (let i = 0; i < 3; i++) { c.advance(800); store.get(s.id); }
  c.advance(200);
  assert.equal(store.get(s.id), undefined);
});

test('delete and sweep drop sessions', () => {
  const c = clock();
  const store = new SessionStore({ idleMs: 1000, absoluteMs: 5000, now: c.now });
  const a = store.create('a', 'u');
  store.create('b', 'u');
  store.delete(a.id);
  assert.equal(store.size, 1);
  c.advance(2000);
  store.sweep();
  assert.equal(store.size, 0);
});

test('unknown or empty ids return undefined', () => {
  const store = new SessionStore({ idleMs: 1000, absoluteMs: 5000 });
  assert.equal(store.get(undefined), undefined);
  assert.equal(store.get('nope'), undefined);
});
