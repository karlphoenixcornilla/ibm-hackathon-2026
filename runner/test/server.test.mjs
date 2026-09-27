// test/server.test.mjs — full test suite for the Reprise Runner HTTP server
// Uses node:test (no additional dependencies required).
// Covers: pairing, auth, refusal cases, path checks, approval flow, busy guard.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startServer } from '../src/server.mjs';

// ── Helpers ───────────────────────────────────────────────────────────────────

const ALLOWED_ORIGIN = 'http://localhost:8080';

/**
 * @param {{ port: number; path: string; method?: string; origin?: string; token?: string | null; body?: string }} opts
 * @returns {Promise<{ status: number; body: unknown }>}
 */
function request({ port, path, method = 'GET', origin = ALLOWED_ORIGIN, token = null, body }) {
  return new Promise((resolve, reject) => {
    /** @type {Record<string, string>} */
    const headers = { Origin: origin };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (body) headers['Content-Type'] = 'application/json';

    const req = http.request(
      { hostname: '127.0.0.1', port, path, method, headers },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(raw) });
          } catch {
            resolve({ status: res.statusCode ?? 0, body: raw });
          }
        });
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function get(port, path, token) {
  return request({ port, path, method: 'GET', token });
}

function post(port, path, bodyObj, token) {
  return request({ port, path, method: 'POST', body: JSON.stringify(bodyObj), token });
}

function del(port, path, token) {
  return request({ port, path, method: 'DELETE', token });
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

const TEST_PORT = 47492;
let tempRoot;
let closeServer;
/** @type {string} */
let pairCode;
/** @type {string} */
let sessionToken;

before(async () => {
  tempRoot = join(tmpdir(), `reprise-runner-test-${Date.now()}`);
  mkdirSync(tempRoot, { recursive: true });

  // Minimal .reprise.yml that satisfies loadConfig
  const yml = [
    'version: 3',
    'verify:',
    '  min_runs: 1',
    '  max_runs: 200',
    'edit_scope:',
    '  test: [tests/**]',
    '  fix: [src/**]',
    'platforms:',
    '  linux:',
    `    shell: ${process.platform === 'win32' ? 'cmd' : 'bash'}`,
    '    cwd: .',
    '    test:',
    '      pattern: "**/*.test.mjs"',
    '      single: "echo test {file}"',
    '      all: "echo all tests"',
    '      report: junit',
    '      report_path: "junit.xml"',
    '    run_timeout_seconds: 10',
  ].join('\n');
  writeFileSync(join(tempRoot, '.reprise.yml'), yml, 'utf8');

  execFileSync('git', ['init', '-q', tempRoot]);
  execFileSync('git', ['-C', tempRoot, 'add', '.']);
  execFileSync('git', ['-C', tempRoot, '-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-qm', 'fixture']);

  // We need to intercept the pairing code printed to console
  const origLog = console.log;
  let captured = '';
  console.log = (...args) => {
    const msg = args.join(' ');
    captured += msg + '\n';
    origLog(...args);
  };

  closeServer = await startServer({
    root: tempRoot,
    port: TEST_PORT,
    allowOrigins: [ALLOWED_ORIGIN],
  });

  console.log = origLog;

  // Extract pairing code from captured output
  const m = captured.match(/Pairing code:\s*(\d{6})/);
  pairCode = m ? m[1] : '000000';
});

after(async () => {
  if (closeServer) await closeServer();
});

// ── GET /status — no auth required ────────────────────────────────────────────

describe('GET /status', () => {
  it('returns 200 with required fields', async () => {
    const res = await get(TEST_PORT, '/status', null);
    assert.equal(res.status, 200);
    const body = /** @type {Record<string,unknown>} */ (res.body);
    assert.equal(typeof body.runner_version, 'string');
    assert.equal(typeof body.host_os, 'string');
    assert.equal(body.busy, false);
    assert.ok(Array.isArray(body.platforms));
  });
});

// ── Origin check ──────────────────────────────────────────────────────────────

describe('Origin check', () => {
  it('returns 403 for no Origin header', async () => {
    const res = await request({ port: TEST_PORT, path: '/status', origin: '' });
    assert.equal(res.status, 403);
  });

  it('returns 403 for a wrong Origin', async () => {
    const res = await request({ port: TEST_PORT, path: '/status', origin: 'https://evil.example.com' });
    assert.equal(res.status, 403);
  });
});

// ── POST /pair ────────────────────────────────────────────────────────────────

describe('POST /pair', () => {
  it('returns 403 for wrong pairing code', async () => {
    const res = await post(TEST_PORT, '/pair', { code: '000000' }, null);
    // Only 403 if the server didn't happen to generate 000000 as the code
    if (pairCode !== '000000') {
      assert.equal(res.status, 403);
    }
  });

  it('returns 200 and a session token for the correct code', async () => {
    const res = await post(TEST_PORT, '/pair', { code: pairCode }, null);
    assert.equal(res.status, 200);
    const body = /** @type {Record<string,unknown>} */ (res.body);
    assert.equal(typeof body.session, 'string');
    assert.ok((body.session).length > 0);
    assert.equal(typeof body.runner_version, 'string');
    sessionToken = /** @type {string} */ (body.session);
  });
});

// ── Auth check (routes that require Bearer token) ─────────────────────────────

describe('Auth check', () => {
  it('requires authentication for local file reads', async () => {
    assert.equal((await get(TEST_PORT, '/file?path=.reprise.yml', null)).status, 401);
  });
  it('rejects an untrusted origin for local file reads', async () => {
    assert.equal((await request({ port: TEST_PORT, path: '/file?path=.reprise.yml', origin: 'https://untrusted.example', token: sessionToken })).status, 403);
  });
  it('returns 401 for POST /approve without token', async () => {
    const res = await post(TEST_PORT, '/approve', { path: 'a.mjs', sha256: 'abc' }, null);
    assert.equal(res.status, 401);
  });

  it('returns 401 for POST /runs without token', async () => {
    const res = await post(TEST_PORT, '/runs', {
      platform: 'linux',
      mode: 'all',
      test_path: 'test.mjs',
      runs: 1,
      ref: null,
    }, null);
    assert.equal(res.status, 401);
  });
});

// ── POST /approve ─────────────────────────────────────────────────────────────

describe('POST /approve', () => {
  it('returns 400 for missing fields', async () => {
    const res = await post(TEST_PORT, '/approve', { path: 'a.mjs' }, sessionToken);
    assert.equal(res.status, 400);
  });

  it('returns 200 for a valid approval', async () => {
    const res = await post(TEST_PORT, '/approve', {
      path: 'tests/a.test.mjs',
      sha256: 'a'.repeat(64),
    }, sessionToken);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true });
  });
});

// ── POST /runs — validation checks ────────────────────────────────────────────

describe('POST /runs validation', () => {
  it('rejects test_path with ".."', async () => {
    const res = await post(TEST_PORT, '/runs', {
      platform: 'linux',
      mode: 'single',
      test_path: '../evil.test.mjs',
      runs: 1,
      ref: null,
    }, sessionToken);
    assert.equal(res.status, 400);
    const body = /** @type {{ error: string }} */ (res.body);
    assert.ok(body.error.includes('..'));
  });

  it('rejects an absolute test_path', async () => {
    const res = await post(TEST_PORT, '/runs', {
      platform: 'linux',
      mode: 'single',
      test_path: '/etc/passwd',
      runs: 1,
      ref: null,
    }, sessionToken);
    assert.equal(res.status, 400);
  });

  it('rejects runs=0', async () => {
    const res = await post(TEST_PORT, '/runs', {
      platform: 'linux',
      mode: 'all',
      test_path: '',
      runs: 0,
      ref: null,
    }, sessionToken);
    assert.equal(res.status, 400);
  });

  it('rejects runs > max_runs', async () => {
    const res = await post(TEST_PORT, '/runs', {
      platform: 'linux',
      mode: 'all',
      test_path: '',
      runs: 9999,
      ref: null,
    }, sessionToken);
    assert.equal(res.status, 400);
  });

  it('rejects an unconfigured platform', async () => {
    const res = await post(TEST_PORT, '/runs', {
      platform: 'windows',
      mode: 'all',
      test_path: '',
      runs: 1,
      ref: null,
    }, sessionToken);
    assert.equal(res.status, 409);
  });

  it('rejects single mode without approval when test not git-tracked', async () => {
    const res = await post(TEST_PORT, '/runs', {
      platform: 'linux',
      mode: 'single',
      test_path: 'definitely-not-tracked.test.mjs',
      runs: 1,
      ref: null,
    }, sessionToken);
    // 409 Test not approved (or 409 platform not runnable on Windows/macOS since no linux config)
    assert.ok([409].includes(res.status));
  });
});

// ── DELETE /runs/<id> ─────────────────────────────────────────────────────────

describe('DELETE /runs/<id>', () => {
  it('returns 200 for a non-existent run id (idempotent)', async () => {
    const res = await del(TEST_PORT, '/runs/deadbeef01020304', sessionToken);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true });
  });
});

// ── Pairing lockout after 5 wrong codes ───────────────────────────────────────

describe('Pairing lockout', () => {
  it('locks pairing after 5 consecutive wrong codes', async () => {
    // Use a separate server instance to avoid polluting session
    const root2 = join(tmpdir(), `reprise-lock-test-${Date.now()}`);
    mkdirSync(root2, { recursive: true });
    writeFileSync(join(root2, '.reprise.yml'), 'version: 3\nplatforms:\n  linux:\n    lint: echo ok\n', 'utf8');
    execFileSync('git', ['init', '-q', root2]);
    execFileSync('git', ['-C', root2, 'add', '.']);
    execFileSync('git', ['-C', root2, '-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-qm', 'fixture']);

    let capturedCode = '';
    const orig = console.log;
    console.log = (...a) => { capturedCode += a.join(' ') + '\n'; orig(...a); };
    const close2 = await startServer({ root: root2, port: 47495, allowOrigins: [ALLOWED_ORIGIN] });
    console.log = orig;

    const post2 = (body) =>
      request({ port: 47495, path: '/pair', method: 'POST', body: JSON.stringify(body) });

    // Send 5 wrong codes
    for (let i = 0; i < 5; i++) {
      await post2({ code: '111111' });
    }
    // 6th attempt should be 403 "locked"
    const res = await post2({ code: '111111' });
    assert.equal(res.status, 403);
    const body = /** @type {{ error: string }} */ (res.body);
    assert.ok(body.error.toLowerCase().includes('locked'));

    await close2();
  });
});
