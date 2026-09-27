import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../src/args.mjs';

test('runner trusts no deployment origin implicitly', () => {
  assert.deepEqual(parseArgs(['--root', '/repo']).allowOrigins, []);
});
test('host explicitly configures all trusted origins', () => {
  assert.deepEqual(parseArgs(['--root', '/repo', '--allow-origin', 'https://app.example.com', '--allow-origin', 'http://localhost:8080']).allowOrigins, ['https://app.example.com', 'http://localhost:8080']);
});
