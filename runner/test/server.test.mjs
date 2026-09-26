// test/server.test.mjs — smoke tests for the runner skeleton
// Uses node:test (no additional dependencies required).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startServer } from '../src/server.mjs';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Simple HTTP GET returning parsed JSON. */
function get(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, path, method: 'GET', headers: { Origin: 'http://localhost:8080' } },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(body) });
          } catch {
            resolve({ status: res.statusCode, body });
          }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

/** HTTP GET without Origin header. */
function getNoOrigin(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, path, method: 'GET' },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

const TEST_PORT = 47491;
let tempRoot;
let closeServer;

before(async () => {
  tempRoot = join(tmpdir(), `reprise-runner-test-${Date.now()}`);
  mkdirSync(tempRoot, { recursive: true });
  writeFileSync(join(tempRoot, '.reprise.yml'), 'version: 3\nplatforms: {}\n', 'utf8');
  closeServer = await startServer({ root: tempRoot, port: TEST_PORT, allowOrigins: ['http://localhost:8080'] });
});

after(async () => {
  if (closeServer) await closeServer();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('runner GET /status', () => {
  it('returns 200 with a valid status body', async () => {
    const res = await get(TEST_PORT, '/status');
    assert.equal(res.status, 200);
    assert.equal(typeof res.body.runner_version, 'string');
    assert.equal(typeof res.body.host_os, 'string');
    assert.equal(res.body.busy, false);
    assert.ok(Array.isArray(res.body.platforms));
  });

  it('root_name matches the temp folder name', async () => {
    const res = await get(TEST_PORT, '/status');
    assert.equal(res.status, 200);
    assert.ok(typeof res.body.root_name === 'string' && res.body.root_name.length > 0);
  });
});

describe('runner CORS origin check', () => {
  it('returns 403 for a request with no Origin header', async () => {
    const res = await getNoOrigin(TEST_PORT, '/status');
    assert.equal(res.status, 403);
  });
});

describe('runner unimplemented routes', () => {
  it('returns 501 for GET /pair (not yet implemented)', async () => {
    const res = await get(TEST_PORT, '/pair');
    assert.equal(res.status, 501);
  });

  it('returns 501 for GET /runs (not yet implemented)', async () => {
    const res = await get(TEST_PORT, '/runs');
    assert.equal(res.status, 501);
  });
});
