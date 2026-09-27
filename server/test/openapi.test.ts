import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadOpenApi, schemaValidator } from './helpers/openapi';

test('openapi.yaml parses and compiles every component schema', () => {
  const doc = loadOpenApi();
  assert.equal(doc.openapi, '3.1.0');
  for (const name of Object.keys(doc.components.schemas)) {
    assert.doesNotThrow(() => schemaValidator(name), `schema ${name} compiles`);
  }
});

test('Proposal schema rejects a missing diff', () => {
  const validate = schemaValidator('Proposal');
  assert.equal(validate({ locations: [], root_cause: 'x', fix_direction: 'y', confidence: 'high', pr_draft: { title: 't', body: 'b' } }), false);
});
