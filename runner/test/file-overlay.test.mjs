// test/file-overlay.test.mjs — GET /file, POST /overlays rules and run completion ordering,
// against a real git repository (issue #31).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { startServer } from '../src/server.mjs';

const ORIGIN = 'http://localhost:8080';
const PORT = 47470;
const BASE = `http://127.0.0.1:${PORT}`;

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

let root;
let closeServer;
let token;
let head;

/** fetch with the allowed Origin and the session token. */
async function call(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { Origin: ORIGIN };
  if (auth) headers['Authorization'] = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

async function approve(path, content) {
  return call('/approve', { method: 'POST', body: { path, sha256: sha256(content) } });
}

/** Read a run's SSE stream until the `done` event (not the end of the stream); return the event types seen. */
async function waitForDone(runId) {
  const res = await fetch(`${BASE}/runs/${runId}/events`, { headers: { Origin: ORIGIN, Authorization: `Bearer ${token}` } });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const types = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (block.startsWith('data: ')) types.push(JSON.parse(block.slice(6)).type);
      if (types.at(-1) === 'done') {
        await reader.cancel();
        return types;
      }
    }
  }
  return types;
}

before(async () => {
  root = join(tmpdir(), `reprise-file-overlay-${Date.now()}`);
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'test'), { recursive: true });
  writeFileSync(join(root, 'src', 'a.js'), 'exports.a = 1;\n');
  writeFileSync(join(root, 'test', 'ok.test.js'), '// ok\n');
  writeFileSync(join(root, '.reprise.yml'), [
    'version: 3',
    'edit_scope:',
    '  test:',
    '    - "test/**"',
    '  fix:',
    '    - "src/**"',
    'verify:',
    '  max_runs: 20',
    'platforms:',
    '  linux:',
    `    shell: ${process.platform === 'win32' ? 'cmd' : 'bash'}`,
    '    test:',
    '      pattern: "test/**"',
    '      single: "node --version"',
    '      all: "node --version"',
    '      report: junit',
    '      report_path: "junit.xml"',
    '    run_timeout_seconds: 30',
  ].join('\n') + '\n');
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Test');
  git(root, 'config', 'commit.gpgsign', 'false');
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'init');
  git(root, 'remote', 'add', 'origin', 'https://github.com/acme/calc.git');
  head = git(root, 'rev-parse', 'HEAD');

  const origLog = console.log;
  let captured = '';
  console.log = (...args) => { captured += args.join(' ') + '\n'; };
  try {
    closeServer = await startServer({ root, port: PORT, allowOrigins: [ORIGIN] });
  } finally {
    console.log = origLog;
  }
  const code = captured.match(/Pairing code:\s*(\d{6})/)?.[1];
  const paired = await call('/pair', { method: 'POST', body: { code }, auth: false });
  assert.equal(paired.status, 200, 'paired');
  token = paired.body.session;
});

after(async () => {
  if (closeServer) await closeServer();
  try { rmSync(root, { recursive: true, force: true }); } catch { /* Windows may hold handles briefly */ }
});

describe('GET /file', () => {
  it('returns a tracked file at HEAD with its sha256', async () => {
    const res = await call('/file?path=src/a.js');
    assert.equal(res.status, 200);
    assert.equal(res.body.path, 'src/a.js');
    assert.equal(res.body.content, 'exports.a = 1;\n');
    assert.equal(res.body.sha256, sha256('exports.a = 1;\n'));
    assert.equal(res.body.ref, head);
  });

  it('accepts an explicit ref', async () => {
    const res = await call(`/file?path=src/a.js&ref=${head}`);
    assert.equal(res.status, 200);
  });

  it('refuses untracked files, directories and unknown refs with 404', async () => {
    writeFileSync(join(root, 'src', 'untracked.js'), 'secret\n');
    assert.equal((await call('/file?path=src/untracked.js')).status, 404);
    assert.equal((await call('/file?path=src')).status, 404);
    assert.equal((await call('/file?path=src/a.js&ref=deadbeef')).status, 404);
  });

  it('refuses paths outside the repository with 400', async () => {
    for (const p of ['../x', 'src/../../x', '.git/config', '/etc/passwd', 'C:/x', 'src\\a.js', '']) {
      assert.equal((await call(`/file?path=${encodeURIComponent(p)}`)).status, 400, p);
    }
  });

  it('requires the session', async () => {
    assert.equal((await call('/file?path=src/a.js', { auth: false })).status, 401);
  });
});

describe('POST /overlays', () => {
  it('accepts a file in edit_scope.test', async () => {
    const content = 'test("x", () => {});\n';
    await approve('test/new.test.js', content);
    const res = await call('/overlays', { method: 'POST', body: { base: head, files: [{ path: 'test/new.test.js', content }] } });
    assert.equal(res.status, 200);
    assert.match(res.body.overlay_id, /^[0-9a-f]+$/);
  });

  it('refuses edit_scope.never (default) with 403', async () => {
    await approve('.reprise.yml', 'x');
    const res = await call('/overlays', { method: 'POST', body: { base: head, files: [{ path: '.reprise.yml', content: 'x' }] } });
    assert.equal(res.status, 403);
  });

  it('refuses content that does not match the approved sha256 with 409', async () => {
    await approve('src/a.js', 'approved content\n');
    const res = await call('/overlays', { method: 'POST', body: { base: head, files: [{ path: 'src/a.js', content: 'other content\n' }] } });
    assert.equal(res.status, 409);
    assert.match(res.body.error, /does not match/);
  });

  it('refuses paths that escape the worktree with 400', async () => {
    const res = await call('/overlays', { method: 'POST', body: { base: head, files: [{ path: 'src/../../x.js', content: 'x' }] } });
    assert.equal(res.status, 400);
  });
});

describe('run completion', () => {
  it('accepts a new run as soon as the previous one reports done', async () => {
    const content = '// overlay\n';
    await approve('src/b.js', content);
    const overlay = await call('/overlays', { method: 'POST', body: { base: head, files: [{ path: 'src/b.js', content }] } });
    assert.equal(overlay.status, 200);
    const run = { platform: 'linux', mode: 'all', test_path: '', runs: 1, ref: { overlay: overlay.body.overlay_id } };
    const first = await call('/runs', { method: 'POST', body: run });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const types = await waitForDone(first.body.run_id);
    assert.equal(types.at(-1), 'done');
    const second = await call('/runs', { method: 'POST', body: run });
    assert.equal(second.status, 200, JSON.stringify(second.body));
    await waitForDone(second.body.run_id);
  });
});
