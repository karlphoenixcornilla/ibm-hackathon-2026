// test/bob.test.mjs — IBM Bob bridge (CR-1): argument building, output parsing,
// environment filtering, and POST /ai/run end to end against a fake `bob`.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  resolveBobOptions,
  buildBobArgs,
  parseBobOutput,
  bobEnv,
  detectBob,
  runBob,
  DISABLED_TOOL_GROUPS,
} from '../src/bob.mjs';
import { startServer } from '../src/server.mjs';

const here = dirname(fileURLToPath(import.meta.url));

/** Build a platform-appropriate launcher for test/fixtures/fake-bob.mjs. */
function makeFakeBob(dir) {
  const script = join(here, 'fixtures', 'fake-bob.mjs');
  if (process.platform === 'win32') {
    const p = join(dir, 'fake-bob.cmd');
    writeFileSync(p, `@"${process.execPath}" "${script}" %*\r\n`);
    return p;
  }
  const p = join(dir, 'fake-bob');
  writeFileSync(p, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`);
  chmodSync(p, 0o755);
  return p;
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

describe('resolveBobOptions', () => {
  it('uses safe defaults', () => {
    const o = resolveBobOptions({}, {});
    assert.equal(o.bin, 'bob');
    assert.equal(o.mode, 'agent');
    assert.equal(o.maxCost, 1);
    assert.equal(o.maxTurns, 30);
    assert.equal(o.timeoutMs, 600_000);
    assert.equal(o.acceptLicense, false);
    assert.equal(o.enabled, true);
  });

  it('reads the environment, and CLI wins over env', () => {
    const env = { REPRISE_BOB_BIN: '/opt/bob', REPRISE_BOB_MAX_COST: '2.5', REPRISE_BOB_TIMEOUT_SECONDS: '30', REPRISE_BOB_DISABLED: '1' };
    const o = resolveBobOptions({ maxCost: 4 }, env);
    assert.equal(o.bin, '/opt/bob');
    assert.equal(o.maxCost, 4);
    assert.equal(o.timeoutMs, 30_000);
    assert.equal(o.enabled, false);
  });

  it('ignores invalid numbers', () => {
    assert.equal(resolveBobOptions({}, { REPRISE_BOB_MAX_TURNS: 'abc' }).maxTurns, 30);
  });
});

describe('buildBobArgs', () => {
  it('runs headless with JSON output, caps, and only the read tool group', () => {
    const args = buildBobArgs(resolveBobOptions({}, {}), '/repo');
    assert.equal(args[0], 'run');
    const flag = (f) => args[args.indexOf(f) + 1];
    assert.equal(flag('--format'), 'json');
    assert.equal(flag('--max-cost'), '1');
    assert.equal(flag('--max-turns'), '30');
    assert.equal(flag('--workspace'), '/repo');
    const disabled = flag('--disable-tool-groups').split(',');
    for (const g of ['edit', 'execute', 'mcp']) assert.ok(disabled.includes(g), g);
    assert.ok(!disabled.includes('read'));
    assert.ok(args.includes('--disable-mcp'));
    assert.ok(!args.includes('--accept-license'));
  });

  it('adds --accept-license only when opted in', () => {
    assert.ok(buildBobArgs({ ...resolveBobOptions({}, {}), acceptLicense: true }, '/r').includes('--accept-license'));
  });

  it('never disables read', () => {
    assert.ok(!DISABLED_TOOL_GROUPS.includes('read'));
  });
});

describe('parseBobOutput', () => {
  const result = {
    type: 'result', status: 'success', last_message: '{"a":1}',
    stats: { task_id: 'x', input_tokens: 1, output_tokens: 2, total_tokens: 3, duration_ms: 4, session_costs: 0.2, tool_calls: 5 },
  };

  it('parses a bare result object', () => {
    const r = parseBobOutput(JSON.stringify(result));
    assert.equal(r.status, 'success');
    assert.equal(r.last_message, '{"a":1}');
    assert.equal(r.task_id, 'x');
    assert.equal(r.stats.session_costs, 0.2);
  });

  it('skips log lines before the result', () => {
    const r = parseBobOutput(`starting\n{"type":"message"}\n${JSON.stringify(result)}\n`);
    assert.equal(r.stats.tool_calls, 5);
  });

  it('maps any non-success status to error and fills missing stats', () => {
    const r = parseBobOutput(JSON.stringify({ type: 'result', status: 'failed', last_message: '' }));
    assert.equal(r.status, 'error');
    assert.equal(r.stats.total_tokens, 0);
    assert.equal(r.task_id, null);
  });

  it('throws when there is no result object', () => {
    assert.throws(() => parseBobOutput('hello'), /no result object/);
  });
});

describe('bobEnv', () => {
  it('strips GitHub tokens and other secrets but keeps BOB_API_KEY', () => {
    const env = bobEnv({ PATH: '/bin', GITHUB_TOKEN: 'ghp_x', GH_TOKEN: 'y', AWS_SECRET: 'z', BOB_API_KEY: 'k' });
    assert.equal(env.PATH, '/bin');
    assert.equal(env.BOB_API_KEY, 'k');
    assert.equal(env.GITHUB_TOKEN, undefined);
    assert.equal(env.GH_TOKEN, undefined);
    assert.equal(env.AWS_SECRET, undefined);
  });
});

// ── Against a fake bob executable ─────────────────────────────────────────────

describe('detectBob / runBob with a fake bob', () => {
  let dir;
  let bin;
  before(() => {
    dir = join(tmpdir(), `reprise-bob-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    bin = makeFakeBob(dir);
  });

  it('detects the version', () => {
    const cap = detectBob(resolveBobOptions({ bin }, {}), { ...process.env, BOB_API_KEY: 'k' });
    assert.equal(cap.available, true);
    assert.equal(cap.version, '0.0.0-fake');
    assert.equal(cap.reason, null);
  });

  it('reports a missing binary as unavailable', () => {
    const cap = detectBob(resolveBobOptions({ bin: join(dir, 'does-not-exist-bob') }, {}));
    assert.equal(cap.available, false);
    assert.ok(cap.reason);
  });

  it('reports a disabled bridge', () => {
    const cap = detectBob(resolveBobOptions({ enabled: false }, {}));
    assert.equal(cap.available, false);
    assert.match(cap.reason, /disabled/);
  });

  it('sends the prompt on stdin and never passes GitHub tokens', async () => {
    const prompt = 'Explain "this" & that; $(rm -rf /) `x`';
    const r = await runBob({
      opts: resolveBobOptions({ bin }, {}),
      root: dir,
      prompt,
      env: { ...process.env, GITHUB_TOKEN: 'ghp_secret', BOB_API_KEY: 'k' },
    });
    const echoed = JSON.parse(r.last_message);
    assert.equal(echoed.prompt, prompt);
    assert.equal(echoed.github_token_seen, false);
    assert.equal(echoed.bob_key_seen, true);
    assert.equal(echoed.argv[0], 'run');
    assert.ok(!echoed.argv.some((a) => a.includes('rm -rf')), 'prompt must not reach argv');
  });

  it('rejects unparseable output', async () => {
    await assert.rejects(
      runBob({ opts: resolveBobOptions({ bin }, {}), root: dir, prompt: 'GARBAGE' }),
      /no result object/,
    );
  });

  it('explains an unaccepted Bob license', async () => {
    await assert.rejects(
      runBob({ opts: resolveBobOptions({ bin }, {}), root: dir, prompt: 'NOLICENSE' }),
      /license has not been accepted.*--bob-accept-license/s,
    );
  });

  it('kills Bob after the timeout', async () => {
    await assert.rejects(
      runBob({ opts: { ...resolveBobOptions({ bin }, {}), timeoutMs: 1500 }, root: dir, prompt: 'SLEEP' }),
      /timed out/,
    );
  });

  it('stops on abort', async () => {
    const controller = new AbortController();
    const p = runBob({ opts: resolveBobOptions({ bin }, {}), root: dir, prompt: 'SLEEP', signal: controller.signal });
    setTimeout(() => controller.abort(), 300);
    await assert.rejects(p, /cancelled/);
  });
});

// ── POST /ai/run ──────────────────────────────────────────────────────────────

const ORIGIN = 'http://localhost:8080';
const PORT = 47520;

function request(path, { method = 'GET', body, token, origin = ORIGIN } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { Origin: origin };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body) headers['Content-Type'] = 'application/json';
    const req = http.request({ hostname: '127.0.0.1', port: PORT, path, method, headers }, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        let parsed = raw;
        try { parsed = JSON.parse(raw); } catch { /* text */ }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

describe('POST /ai/run', () => {
  let close;
  let session;

  before(async () => {
    const root = join(tmpdir(), `reprise-bob-server-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, '.reprise.yml'), 'version: 3\nplatforms: {}\n');
    const bin = makeFakeBob(root);

    const origLog = console.log;
    let captured = '';
    console.log = (...a) => { captured += a.join(' ') + '\n'; };
    try {
      close = await startServer({ root, port: PORT, allowOrigins: [ORIGIN], bob: { bin } });
    } finally {
      console.log = origLog;
    }
    const code = captured.match(/Pairing code:\s*(\d{6})/)[1];
    session = (await request('/pair', { method: 'POST', body: { code } })).body.session;
  });

  after(async () => { if (close) await close(); });

  it('advertises Bob in /status', async () => {
    const res = await request('/status');
    assert.equal(res.body.ai[0].provider, 'bob');
    assert.equal(res.body.ai[0].available, true);
  });

  it('requires a session', async () => {
    const res = await request('/ai/run', { method: 'POST', body: { provider: 'bob', stage: 'intake', prompt: 'x' } });
    assert.equal(res.status, 401);
  });

  it('refuses a foreign origin', async () => {
    const res = await request('/ai/run', { method: 'POST', token: session, origin: 'https://evil.example', body: { provider: 'bob', stage: 'intake', prompt: 'x' } });
    assert.equal(res.status, 403);
  });

  it('validates provider, stage and prompt', async () => {
    assert.equal((await request('/ai/run', { method: 'POST', token: session, body: { provider: 'claude', stage: 'intake', prompt: 'x' } })).status, 400);
    assert.equal((await request('/ai/run', { method: 'POST', token: session, body: { provider: 'bob', stage: 'deploy', prompt: 'x' } })).status, 400);
    assert.equal((await request('/ai/run', { method: 'POST', token: session, body: { provider: 'bob', stage: 'intake', prompt: '' } })).status, 400);
  });

  it('runs Bob and ignores command fields in the body', async () => {
    const res = await request('/ai/run', {
      method: 'POST',
      token: session,
      body: { provider: 'bob', stage: 'intake', prompt: 'hello bob', command: 'rm -rf /', args: ['--yolo'] },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'success');
    const echoed = JSON.parse(res.body.last_message);
    assert.equal(echoed.prompt, 'hello bob');
    assert.ok(!echoed.argv.includes('--yolo'));
    assert.ok(!echoed.argv.includes('rm -rf /'));
  });
});

// ── Origin allow-list (G-23: web extension hosts run on per-session subdomains) ──

describe('originAllowed', async () => {
  const { originAllowed } = await import('../src/server.mjs');
  const allowed = ['http://*.localhost:3000', 'https://team.github.io'];

  it('accepts exact origins and one-label wildcard subdomains', () => {
    assert.ok(originAllowed('https://team.github.io', allowed));
    assert.ok(originAllowed('http://v--0ab12.localhost:3000', allowed));
  });

  it('rejects everything else', () => {
    for (const o of ['http://localhost:3000', 'http://a.b.localhost:3000', 'http://x.localhost:3001', 'https://x.localhost:3000', 'http://evil.com/.localhost:3000', 'https://team.github.io.evil.com']) {
      assert.equal(originAllowed(o, allowed), false, o);
    }
  });
});
