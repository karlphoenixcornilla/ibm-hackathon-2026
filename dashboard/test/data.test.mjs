import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDataSource, recordPath } from '../data.js';

test('host loaders can load reports without a static JSON deployment', async () => {
  const issue = { repo: 'team/app', issue: 29 };
  const source = createDataSource({ loadIndex: async () => ({ issues: [issue] }), loadRecord: async value => ({ ...value, state: 'CONFIRMED' }) });
  assert.deepEqual(await source.loadIndex(), { issues: [issue] });
  assert.equal((await source.loadRecord(issue)).state, 'CONFIRMED');
});

test('configurable endpoints and sample defaults', async t => {
  const urls = [];
  t.mock.method(globalThis, 'fetch', async url => { urls.push(url); return { ok: true, json: async () => ({}) }; });
  const source = createDataSource({ indexUrl: '/api/reports', baseUrl: '/api/records' });
  await source.loadIndex();
  await source.loadRecord({ repo: 'team/app', issue: 29 });
  await createDataSource().loadIndex();
  assert.deepEqual(urls, ['/api/reports', '/api/records/team/app/issues/29.json', 'data/index.json']);
  assert.throws(() => recordPath({ repo: '../app', issue: 29 }));
});
