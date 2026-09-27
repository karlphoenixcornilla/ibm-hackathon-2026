// End to end (issue #31): the real Reprise Runner on a real git clone, the real server, and
// the browser bridge. An agent-style diff is applied on a runner worktree and tested there;
// the user's clone must be left exactly as it was.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { Result } from '@reprise/core';
import type { IssueRecord } from '@reprise/core';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { realCoreFactory } from '../src/core-factory';
import { localCheckHandler } from '../src/local-check';
import { mockPrHandler, mockProposeHandler, mockRecord } from '../src/mock';
import { connectRunner } from '../src/repo-context';
import { StagingStore } from '../src/staging';
import { RepriseApi } from '../src/api/client';
import { RunnerBridge } from '../src/api/runner-bridge';
import { cookieFetch, withOrigin } from './helpers/http';

const REPO = 'acme/calc';
const ORIGIN = 'http://localhost:8787';
const RUNNER_PORT = 47460;
const TEST_FILE = 'test/add.test.js';

const BUGGY = 'exports.add = (a, b) => a - b;\n';
const REPRO_TEST = [
  "const test = require('node:test');",
  "const assert = require('node:assert');",
  "const { add } = require('../src/calc.js');",
  "test('add adds', () => { assert.strictEqual(add(2, 3), 5, 'BUG-ADD: add(2, 3) should be 5'); });",
  '',
].join('\n');
const FIX = `--- a/src/calc.js\n+++ b/src/calc.js\n@@ -1 +1 @@\n-exports.add = (a, b) => a - b;\n+exports.add = (a, b) => a + b;\n`;
const NOT_A_FIX = `--- a/src/calc.js\n+++ b/src/calc.js\n@@ -1 +1,2 @@\n+// looked at this\n exports.add = (a, b) => a - b;\n`;

const JUNIT = '--test-reporter=junit --test-reporter-destination=junit.xml';
const REPRISE_YML = [
  'version: 3',
  'edit_scope:',
  '  test:',
  '    - "test/**"',
  '  fix:',
  '    - "src/**"',
  'fix:',
  '  quick_runs: 2',
  'verify:',
  '  max_runs: 20',
  'platforms:',
  '  linux:',
  `    shell: ${process.platform === 'win32' ? 'cmd' : 'bash'}`,
  '    test:',
  '      pattern: "test/**"',
  `      single: 'node --test ${JUNIT} {file}'`,
  `      all: 'node --test ${JUNIT} "test/**/*.test.js"'`,
  '      report: junit',
  '      report_path: "junit.xml"',
  '    run_timeout_seconds: 60',
  // This test itself runs under `node --test`; without this the inner `node --test`
  // inherits NODE_TEST_CONTEXT, skips every file and exits 0.
  '    env_remove:',
  '      - NODE_TEST_CONTEXT',
  '',
].join('\n');

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
// A real dynamic import (tsc would turn `import()` into require(), which can't take a file URL).
const importEsm = new Function('specifier', 'return import(specifier)') as (s: string) => Promise<unknown>;

let clone: string;
let head: string;
let closeRunner: () => Promise<void>;
let pairingCode: string;
let app: FastifyInstance;
let base: string;

before(async () => {
  clone = fs.mkdtempSync(path.join(os.tmpdir(), 'reprise-e2e-'));
  fs.mkdirSync(path.join(clone, 'src'));
  fs.mkdirSync(path.join(clone, 'test'));
  fs.writeFileSync(path.join(clone, 'src', 'calc.js'), BUGGY);
  fs.writeFileSync(path.join(clone, 'test', 'other.test.js'),
    "require('node:test')('math still works', () => { require('node:assert').strictEqual(1 + 1, 2); });\n");
  fs.writeFileSync(path.join(clone, '.reprise.yml'), REPRISE_YML);
  git(clone, 'init', '-q');
  git(clone, 'config', 'user.email', 'e2e@example.com');
  git(clone, 'config', 'user.name', 'E2E');
  git(clone, 'config', 'commit.gpgsign', 'false');
  git(clone, 'add', '.');
  git(clone, 'commit', '-q', '-m', 'calc with a bug');
  git(clone, 'remote', 'add', 'origin', `https://github.com/${REPO}.git`);
  head = git(clone, 'rev-parse', 'HEAD');

  // The real runner, pointed at the clone. Capture the pairing code it prints.
  const runnerModule = path.resolve(__dirname, '../../../runner/src/server.mjs');
  const { startServer } = await importEsm(pathToFileURL(runnerModule).href) as {
    startServer(args: { root: string; port: number; allowOrigins: string[] }): Promise<() => Promise<void>>;
  };
  const origLog = console.log;
  let printed = '';
  console.log = (...args: unknown[]) => { printed += args.join(' ') + '\n'; };
  try {
    closeRunner = await startServer({ root: clone, port: RUNNER_PORT, allowOrigins: [ORIGIN] });
  } finally {
    console.log = origLog;
  }
  pairingCode = /Pairing code:\s*(\d{6})/.exec(printed)?.[1] ?? '';
  assert.ok(pairingCode, 'runner printed a pairing code');

  // The real server. Only the record store is in memory (instead of the reprise-data branch),
  // with the generated reproduction test staged as acknowledge would have left it.
  const staging = new StagingStore();
  staging.for(REPO, 1).write(TEST_FILE, REPRO_TEST);
  const seed = mockRecord(REPO, 1, 'add() subtracts');
  const record: IssueRecord = {
    ...seed,
    replication: {
      ...seed.replication,
      repro: {
        ...seed.replication.repro,
        test_file: TEST_FILE,
        signature: { kind: 'output_regex', pattern: 'BUG-ADD' },
        run_context: { ...seed.replication.repro.run_context, platform: 'linux' },
      },
    },
  };
  const real = realCoreFactory(120_000);
  const config = { ...loadConfig({ PUBLIC_ORIGIN: ORIGIN }), relayTimeoutMs: 120_000 };
  app = await buildApp({
    config,
    coreFactory: (req) => {
      const core = real(req);
      core.store = {
        load: async () => Result.ok(record),
        save: async () => Result.ok(undefined),
        getCached: () => record,
        invalidate: () => undefined,
      };
      return core;
    },
    validateToken: async () => 'e2e-user',
    propose: mockProposeHandler,
    pr: mockPrHandler,
    check: localCheckHandler,
    connectRunner: (run, repo, stage) => connectRunner(run, repo, stage, { graceMs: 10_000, timeoutMs: 120_000, checkRepo: true }),
    staging,
    logger: false,
  });
  base = await app.listen({ port: 0, host: '127.0.0.1' });
});

after(async () => {
  await app?.close();
  await closeRunner?.();
  try { fs.rmSync(clone, { recursive: true, force: true }); } catch { /* Windows may hold handles briefly */ }
});

test('a fix is applied and verified on a runner worktree; the clone is untouched', { timeout: 180_000 }, async () => {
  const bridge = new RunnerBridge({ ports: [RUNNER_PORT], fetchImpl: withOrigin(ORIGIN) });
  const paired = await bridge.pair(pairingCode);
  assert.equal(paired.head, head);
  assert.ok(bridge.sameRepo('acme', 'calc'));
  assert.equal((await bridge.readFile('src/calc.js')).content, BUGGY);

  const api = new RepriseApi(base, cookieFetch());
  await api.signIn('any');

  const good = await api.check('acme', 'calc', 1, FIX);
  const verified = await bridge.attach(api, good.runId);
  assert.equal(verified?.state, 'succeeded', verified?.error ?? '');
  const check = verified!.check!;
  assert.equal(check.verdict, 'FIX_VERIFIED', JSON.stringify(check));
  assert.deepEqual(check.repro, { test_file: TEST_FILE, runs: 2, failed: 0, fixed: true });
  assert.equal(check.base_sha, head);
  assert.deepEqual(check.regression?.blocking, []);
  assert.equal(check.regression?.tests_total, 2, 'the suite ran with JUnit results: the existing test plus the new one');

  const bad = await api.check('acme', 'calc', 1, NOT_A_FIX);
  const incomplete = await bridge.attach(api, bad.runId);
  assert.equal(incomplete?.state, 'succeeded', incomplete?.error ?? '');
  assert.equal(incomplete!.check!.verdict, 'FIX_INCOMPLETE');
  assert.equal(incomplete!.check!.repro.failed, 2, 'the repro still fails with the BUG-ADD signature');

  // Nothing touched the user's clone.
  assert.equal(git(clone, 'rev-parse', 'HEAD'), head);
  assert.equal(git(clone, 'status', '--porcelain'), '');
  assert.equal(fs.readFileSync(path.join(clone, 'src', 'calc.js'), 'utf8'), BUGGY);
  assert.ok(!fs.existsSync(path.join(clone, TEST_FILE)), 'the reproduction test was never written to the clone');
});
