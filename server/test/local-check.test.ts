import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Result } from '@reprise/core';
import type { IssueRecord, RunRequest, RunResult, TestResult } from '@reprise/core';
import { realCoreFactory } from '../src/core-factory';
import { runLocalCheck, REACKNOWLEDGE_MESSAGE } from '../src/local-check';
import { mockRecord } from '../src/mock';
import type { RelayExecutor } from '../src/relay-executor';
import { RunnerRelay } from '../src/runner-relay';
import { RunRegistry } from '../src/runs';
import { StagedFiles } from '../src/staging';
import type { RunnerContext } from '../src/repo-context';
import { answerRelay, result } from './helpers/fake-browser';

const HEAD = 'e'.repeat(40);
const REPO = 'acme/calc';
const TEST_FILE = 'test/add.test.js';
const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

const CONFIG = (withAll: boolean) => [
  'version: 3',
  'edit_scope:',
  '  test: ["test/**"]',
  '  fix: ["src/**"]',
  'fix:',
  '  quick_runs: 2',
  'platforms:',
  '  linux:',
  '    test:',
  '      pattern: "test/**"',
  '      single: "node --test {file}"',
  ...(withAll ? ['      all: "node --test"'] : []),
].join('\n') + '\n';

const REPO_FILES = (withAll: boolean): Record<string, string> => ({
  '.reprise.yml': CONFIG(withAll),
  'src/calc.js': 'exports.add = (a, b) => a - b;\n',
});

const FIX = `--- a/src/calc.js\n+++ b/src/calc.js\n@@ -1 +1 @@\n-exports.add = (a, b) => a - b;\n+exports.add = (a, b) => a + b;\n`;

const t = (id: string, status: TestResult['status']): TestResult => ({ id, status, message: '', output: '' });

interface Scenario {
  withAll?: boolean;
  /** Stage the generated repro test (as acknowledge would). */
  staged?: boolean;
  record?: IssueRecord | null;
  repro?: () => RunResult;
  base?: TestResult[];
  head?: TestResult[];
}

function setup(s: Scenario = {}) {
  const withAll = s.withAll ?? true;
  const run = new RunRegistry().create('s', 'check', REPO, 1);
  let overlays = 0;
  const files = REPO_FILES(withAll);
  const browser = answerRelay(run, {
    runner: (call) => {
      const url = new URL(call.path, 'http://runner');
      if (url.pathname === '/file') {
        const p = url.searchParams.get('path')!;
        return p in files
          ? { status: 200, body: { path: p, ref: HEAD, sha256: sha256(files[p]!), content: files[p] } }
          : { status: 404, body: { error: `${p} is not a tracked file` } };
      }
      if (url.pathname === '/approve') { return { status: 200, body: { ok: true } }; }
      if (url.pathname === '/overlays') { overlays++; return { status: 200, body: { overlay_id: `ov${overlays}` } }; }
      return { status: 500, body: { error: 'unexpected' } };
    },
    exec: (req: RunRequest) => {
      if (req.mode === 'single') { return Array.from({ length: req.runs }, () => (s.repro ?? (() => result()))()); }
      const isBase = req.ref !== null && 'base' in req.ref;
      return [result({ tests: isBase ? (s.base ?? [t('suite::a', 'passed')]) : (s.head ?? [t('suite::a', 'passed')]) })];
    },
  });

  const stage = new StagedFiles();
  if (s.staged ?? true) { stage.write(TEST_FILE, 'the generated test'); }
  const runner: RunnerContext = { relay: new RunnerRelay(run, 2000), head: HEAD, remote: 'https://github.com/acme/calc', stage };
  const core = realCoreFactory(2000)({ token: 'tok', repo: REPO, run, runner });

  const base = mockRecord(REPO, 1, 'add is wrong');
  const record: IssueRecord | null = s.record === undefined ? {
    ...base,
    replication: {
      ...base.replication,
      repro: {
        ...base.replication.repro,
        test_file: TEST_FILE,
        signature: { kind: 'output_regex', pattern: 'BUG-ADD' },
        run_context: { ...base.replication.repro.run_context, platform: 'linux' },
      },
    },
  } : s.record;
  core.store = {
    load: async () => Result.ok(record),
    save: async () => Result.ok(undefined),
    getCached: () => record,
    invalidate: () => undefined,
  };

  const executor = core.executors.local as RelayExecutor;
  const check = async (diff = FIX) => {
    await core.config.load();
    return runLocalCheck({ core, repo: REPO, issue: 1, token: 'tok', diff, runner, executor, cancel: run.token });
  };
  return { check, browser, stage };
}

test('a fix that makes the repro pass with no regressions is FIX_VERIFIED', async () => {
  const { check, browser, stage } = setup({ base: [t('suite::a', 'passed')], head: [t('suite::a', 'passed'), t('add::adds', 'passed')] });
  const out = await check();
  assert.equal(out.verdict, 'FIX_VERIFIED');
  assert.deepEqual(out.repro, { test_file: TEST_FILE, runs: 2, failed: 0, fixed: true });
  assert.equal(out.base_sha, HEAD);
  assert.equal(out.overlay_id, 'ov1');
  const fixed = 'exports.add = (a, b) => a + b;\n';
  assert.deepEqual(out.files, [{ path: 'src/calc.js', sha256: sha256(fixed) }]);
  assert.deepEqual(out.regression?.blocking, []);
  assert.equal(stage.get('src/calc.js'), fixed, 'fix staged next to the test');

  const execs = browser.log.filter((l) => l.kind === 'exec').map((l) => l.kind === 'exec' && l.request);
  assert.deepEqual(execs.map((r) => r && [r.mode, r.ref]), [
    ['single', { overlay: 'ov1' }],
    ['all', { base: HEAD }],
    ['all', { overlay: 'ov1' }],
  ]);
  const overlay = browser.log.find((l) => l.kind === 'runner' && l.call.path === '/overlays');
  assert.ok(overlay?.kind === 'runner' && overlay.call.method === 'POST');
  assert.deepEqual(
    (overlay.call as { body: { files: Array<{ path: string }> } }).body.files.map((f) => f.path).sort(),
    ['src/calc.js', TEST_FILE],
  );
});

test('a repro that still fails with the signature is FIX_INCOMPLETE', async () => {
  const { check } = setup({ repro: () => result({ exit_code: 1, output_tail: 'AssertionError: BUG-ADD add(2,3)' }) });
  const out = await check();
  assert.equal(out.verdict, 'FIX_INCOMPLETE');
  assert.deepEqual(out.repro, { test_file: TEST_FILE, runs: 2, failed: 2, fixed: false });
});

test('a suite test that passed before and fails with the fix is REGRESSION_DETECTED', async () => {
  const { check } = setup({ base: [t('suite::a', 'passed')], head: [t('suite::a', 'failed')] });
  const out = await check();
  assert.equal(out.verdict, 'REGRESSION_DETECTED');
  assert.ok((out.regression?.blocking.length ?? 0) > 0);
});

test('without test.all there is no regression section', async () => {
  const { check, browser } = setup({ withAll: false });
  const out = await check();
  assert.equal(out.regression, null);
  assert.equal(out.verdict, 'FIX_VERIFIED');
  assert.equal(browser.log.filter((l) => l.kind === 'exec').length, 1);
});

test('a generated repro test that is no longer staged asks to acknowledge again', async () => {
  const { check } = setup({ staged: false });
  await assert.rejects(check(), (e: unknown) => e instanceof Error && e.message === REACKNOWLEDGE_MESSAGE);
});

test('no record → acknowledge first', async () => {
  const { check } = setup({ record: null });
  await assert.rejects(check(), /acknowledge the issue first/);
});

test('edit scope: the repro test and edit_scope.never are off limits', async () => {
  const touchTest = `--- a/${TEST_FILE}\n+++ b/${TEST_FILE}\n@@ -1 +1 @@\n-the generated test\n+weakened\n`;
  await assert.rejects(setup().check(touchTest), /must not change the reproduction test/);
  const touchConfig = `--- a/.reprise.yml\n+++ b/.reprise.yml\n@@ -1 +1 @@\n-version: 3\n+version: 4\n`;
  await assert.rejects(setup().check(touchConfig), /edit_scope\.never/);
});

test('a second check replaces the previous fix', async () => {
  const { check, stage } = setup();
  await check();
  const other = `--- /dev/null\n+++ b/src/extra.js\n@@ -0,0 +1 @@\n+exports.extra = 1;\n`;
  await check(other);
  assert.equal(stage.get('src/calc.js'), undefined, 'first fix dropped');
  assert.equal(stage.get('src/extra.js'), 'exports.extra = 1;\n');
  assert.ok(stage.has(TEST_FILE));
});
