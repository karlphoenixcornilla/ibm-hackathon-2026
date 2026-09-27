import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFakeCore } from '@reprise/core';

test('@reprise/core resolves from the server package', () => {
  const core = buildFakeCore();
  assert.equal(typeof core.pipeline.acknowledge, 'function');
});
