// test/t4-fix-verify.test.ts — T4 acceptance tests
// Covers: regression classifier (every TestClass), required-runs formula,
// fix.iterations[0] schema for each verify verdict.
// Runs with: node --test (no vscode runtime needed).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Regression classifier ─────────────────────────────────────────────────────
import { classifyTestClass, buildRegressionSection, requiredRuns } from '../src/verify/index';
import type { TestSummary } from '../src/verify/index';
import type { RunResult } from '../src/contracts/execution';

describe('classifyTestClass — every TestClass', () => {
  const cases: Array<[Pick<TestSummary, 'baseStatus' | 'headStatus'>, string]> = [
    [{ baseStatus: 'passed',  headStatus: 'passed'  }, 'UNCHANGED_PASS'],
    [{ baseStatus: 'failed',  headStatus: 'passed'  }, 'NEWLY_PASSING'],
    [{ baseStatus: 'error',   headStatus: 'passed'  }, 'NEWLY_PASSING'],
    [{ baseStatus: 'failed',  headStatus: 'failed'  }, 'PRE_EXISTING_FAILURE'],
    [{ baseStatus: 'error',   headStatus: 'error'   }, 'PRE_EXISTING_FAILURE'],
    [{ baseStatus: 'passed',  headStatus: 'skipped' }, 'PRE_EXISTING_FLAKY'],
    [{ baseStatus: null,      headStatus: 'passed'  }, 'ADDED_PASSING'],
    [{ baseStatus: null,      headStatus: 'failed'  }, 'ADDED_FAILING'],
    [{ baseStatus: null,      headStatus: 'error'   }, 'ADDED_FAILING'],
    [{ baseStatus: 'passed',  headStatus: null      }, 'REMOVED'],
    [{ baseStatus: 'failed',  headStatus: null      }, 'REMOVED'],
    [{ baseStatus: 'passed',  headStatus: 'failed'  }, 'REGRESSION'],
    [{ baseStatus: 'passed',  headStatus: 'error'   }, 'REGRESSION'],
  ];

  for (const [fields, expected] of cases) {
    const label = `base=${fields.baseStatus ?? 'null'} head=${fields.headStatus ?? 'null'} → ${expected}`;
    it(label, () => {
      const cls = classifyTestClass({ id: 'test::case', ...fields } as TestSummary);
      assert.equal(cls, expected);
    });
  }
});

// ── buildRegressionSection ────────────────────────────────────────────────────

function makeRun(tests: Array<{ id: string; status: 'passed' | 'failed' | 'error' | 'skipped' }>): RunResult {
  return {
    platform: 'linux',
    executor: 'local',
    method: 'repo_command',
    exit_code: 0,
    timed_out: false,
    duration_ms: 100,
    tests: tests.map((t) => ({ ...t, message: '', output: '' })),
    output_tail: '',
    host_os: 'linux',
    device: '',
    ci_run_url: null,
    runner_version: null,
  };
}

describe('buildRegressionSection', () => {
  it('no tests — empty section', () => {
    const sec = buildRegressionSection([], []);
    assert.equal(sec.tests_total, 0);
    assert.deepEqual(sec.blocking, []);
  });

  it('UNCHANGED_PASS — not blocking or notable', () => {
    const base = [makeRun([{ id: 'a::t', status: 'passed' }])];
    const head = [makeRun([{ id: 'a::t', status: 'passed' }])];
    const sec = buildRegressionSection(base, head);
    assert.equal(sec.counts['UNCHANGED_PASS'], 1);
    assert.equal(sec.blocking.length, 0);
  });

  it('REGRESSION — blocks verdict', () => {
    const base = [makeRun([{ id: 'a::t', status: 'passed' }])];
    const head = [makeRun([{ id: 'a::t', status: 'failed' }])];
    const sec = buildRegressionSection(base, head);
    assert.equal(sec.counts['REGRESSION'], 1);
    assert.ok(sec.blocking.includes('a::t'));
  });

  it('ADDED_FAILING — blocks verdict', () => {
    const base: RunResult[] = [];
    const head = [makeRun([{ id: 'new::t', status: 'failed' }])];
    const sec = buildRegressionSection(base, head);
    assert.equal(sec.counts['ADDED_FAILING'], 1);
    assert.ok(sec.blocking.includes('new::t'));
  });

  it('REMOVED — blocks verdict', () => {
    const base = [makeRun([{ id: 'gone::t', status: 'passed' }])];
    const head: RunResult[] = [];
    const sec = buildRegressionSection(base, head);
    assert.equal(sec.counts['REMOVED'], 1);
    assert.ok(sec.blocking.includes('gone::t'));
  });

  it('NEWLY_PASSING — not blocking', () => {
    const base = [makeRun([{ id: 'x::t', status: 'failed' }])];
    const head = [makeRun([{ id: 'x::t', status: 'passed' }])];
    const sec = buildRegressionSection(base, head);
    assert.equal(sec.counts['NEWLY_PASSING'], 1);
    assert.equal(sec.blocking.length, 0);
  });
});

// ── requiredRuns (statistics.md §5) ──────────────────────────────────────────

describe('requiredRuns', () => {
  it('20/20 wilson_low=0.8389 → required=3 (clamped to min)', () => {
    // raw = ceil(ln(0.05)/ln(1-0.8389)) = ceil(2.0) = 2 → clamped to min=3
    const { required, capped } = requiredRuns(0.8389, 3, 200);
    assert.equal(required, 3);
    assert.equal(capped, false);
  });

  it('10/20 wilson_low=0.2993 → required=9', () => {
    const { required, capped } = requiredRuns(0.2993, 3, 200);
    assert.equal(required, 9);
    assert.equal(capped, false);
  });

  it('1/20 wilson_low=0.0089 → capped at max=200', () => {
    const { required, capped } = requiredRuns(0.0089, 3, 200);
    assert.equal(required, 200);
    assert.equal(capped, true);
  });

  it('wilson_low=0 → max', () => {
    const { required } = requiredRuns(0, 3, 200);
    assert.equal(required, 200);
  });

  it('wilson_low>=1 → min', () => {
    const { required } = requiredRuns(1.0, 3, 200);
    assert.equal(required, 3);
  });
});

// ── fix.iterations[0] schema — scripted round via minimal stubs ───────────────
// Build services purely in-memory without importing any vscode-dependent fakes.

import { createFix } from '../src/fix/index';
import { createVerify } from '../src/verify/index';
import { Result as R } from '../src/util/result';
import type { IssueRecord, FixIteration } from '../src/contracts/records';
import type { Services } from '../src/contracts/services';
import type { RunResult as RR } from '../src/contracts/execution';

/** Minimal stub RunResult — all passing. */
function passRun(): RR {
  return {
    platform: 'android', executor: 'local', method: 'repo_command',
    exit_code: 0, timed_out: false, duration_ms: 200,
    tests: [{ id: 'LoginTest.kt::testBiometricLogin', status: 'passed', message: '', output: '' }],
    output_tail: 'BUILD SUCCESSFUL', host_os: 'darwin', device: 'emulator-5554',
    ci_run_url: null, runner_version: null,
  };
}

/** Minimal stub RunResult — failing with signature match. */
function failRun(): RR {
  return {
    platform: 'android', executor: 'local', method: 'repo_command',
    exit_code: 1, timed_out: false, duration_ms: 200,
    tests: [{ id: 'LoginTest.kt::testBiometricLogin', status: 'failed',
              message: 'expected activity to resume but got DESTROYED', output: 'FAILED' }],
    output_tail: 'expected activity to resume but got DESTROYED',
    host_os: 'darwin', device: 'emulator-5554', ci_run_url: null, runner_version: null,
  };
}

function makeRecord(): IssueRecord {
  return {
    schema: 3, repo: 'demo-owner/demo-app', issue: 7,
    title: 'Login crashes on Android 14', url: 'https://github.com/demo-owner/demo-app/issues/7',
    state: 'CONFIRMED', provider: 'stub', stubbed: true,
    created_at: '2025-01-10T10:00:00Z', updated_at: '2025-01-15T14:30:00Z',
    replication: {
      verdict: 'CONFIRMED', acknowledged_by: 'user',
      started_at: '2025-01-15T10:00:00Z', finished_at: '2025-01-15T12:00:00Z',
      duration_ms: 7200000,
      fingerprint: {
        platform: 'android', component: 'auth', functions: ['BiometricManager.authenticate'],
        symptom: 'crash', trigger: 'biometric', expected: 'resume', actual: 'DESTROYED',
        error_signature: 'IllegalStateException',
      },
      duplicate: { of: null, score: null, fields: {}, reason: '', behaviour_check: null },
      question: '',
      repro: {
        test_origin: 'provided', test_file: 'app/src/androidTest/LoginTest.kt',
        test_sha256: 'abc123', branch: 'main',
        signature: { kind: 'assertion_message', pattern: 'expected activity to resume but got DESTROYED' },
        attempts: 1,
        run_context: {
          platform: 'android', executor: 'local', method: 'repo_command',
          host_os: 'darwin', device: 'emulator-5554', ci_run_url: null, runner_version: '0.1.0',
        },
        trials: 20, failed: 7, invalid: 0, sequence: 'FPPPFPPFPPPFPPFPPPFP',
        trials_policy: { min: 10, max: 20, limit: 100, max_minutes: null, source: 'config', stopped_by: 'max_reached' },
        rate: 1.0, wilson_low: 0.8389, wilson_high: 1.0,
      },
      diagnosis: {
        summary: 'BiometricPrompt callback on destroyed activity',
        locations: [{ file: 'app/src/main/java/LoginActivity.kt', start_line: 47, end_line: 55, reason: 'lifecycle' }],
        fix_direction: 'Check isDestroyed()', confidence: 'high', accepted_by: 'user', edited: false,
      },
    },
    fix: { iterations: [] },
    resolution_note: '', usage: { provider: 'stub', calls: 4, by_stage: {} }, events: [],
  };
}

/** Build a minimal Services object without any vscode-runtime dependencies. */
function makeServices(
  store: Map<string, IssueRecord>,
  executorRuns: RR[],
): Services {
  const storeService = {
    async load(_repo: string, issue: number) {
      return R.ok(store.get(String(issue)) ?? null);
    },
    async save(r: IssueRecord) {
      store.set(String(r.issue), r);
      return R.ok(undefined);
    },
    getCached(_repo: string, issue: number) { return store.get(String(issue)) ?? null; },
    invalidate() {},
  };

  const noop = () => ({ dispose: () => undefined });
  const fakeEvent = noop;

  const statsService = {
    classifyTrial(result: RR, sig: { kind: string; pattern: string }) {
      if (result.exit_code === 0) { return 'PASS' as const; }
      const out = result.output_tail ?? '';
      if (out.includes(sig.pattern)) { return 'FAIL_MATCH' as const; }
      return 'FAIL_OTHER' as const;
    },
    wilsonInterval: (f: number, n: number) => {
      if (n === 0) { return { low: 0, high: 0 }; }
      return { low: f / n * 0.8, high: Math.min(1, f / n * 1.2) };
    },
    verdict: () => 'CONFIRMED' as const,
  };

  const providerService = {
    getActive: () => ({
      id: 'stub',
      capabilities: { images: false, implemented: true },
      async run(req: { stage: string }) {
        return {
          json: {
            summary: `Candidate fix for stage ${req.stage}`,
            files_changed: ['app/src/main/java/LoginActivity.kt'],
            risk_notes: 'Low',
            tests_added: [],
            verdict: 'ok',
            findings: [],
          },
          files: [{ path: 'app/src/main/java/LoginActivity.kt', content: '// fixed\n' }],
          usage: { calls: 1, detail: {} },
          provider: 'stub',
          stubbed: true,
        };
      },
    }),
    list: () => [],
    setActive: () => R.ok(undefined),
    onDidChangeProvider: fakeEvent as unknown as import('vscode').Event<{ id: string }>,
  };

  const executorObj = {
    id: 'local' as const,
    async available() { return { available: true as const }; },
    async run() { return executorRuns; },
  };

  const configData = {
    version: 3 as const,
    issues: { labels: ['bug'] },
    components: ['auth'],
    defaults: { executor: 'local' as const, trials: { min: 10, max: 20, limit: 100, max_minutes: null }, max_test_attempts: 3 },
    fix: { candidates: 3, quick_runs: 3, max_rounds: 3, candidate_executor: 'auto' as const, draft_pr: true, self_review: false },
    verify: { min_runs: 3, max_runs: 200, regression_reruns: 3 },
    edit_scope: { test: [], fix: ['app/src/main/**'], never: ['.reprise/**'] },
    platforms: {
      android: {
        shell: 'bash', cwd: '.',
        test: { pattern: '**/*Test.kt', single: './gradlew test', all: './gradlew test', report: 'junit', report_path: 'build/test-results/**/*.xml' },
        run_timeout_seconds: 300,
      },
    },
  };

  return {
    config: {
      async load() { return R.ok(configData); },
      get() { return configData; },
      getUri() { return null; },
      invalidate() {},
    },
    auth: {
      async signIn() { return R.ok('fake-token'); },
      async signOut() {},
      getToken() { return 'fake-token'; },
      isSignedIn() { return true; },
      onDidChangeSession: fakeEvent as unknown as import('vscode').Event<{ signedIn: boolean }>,
    },
    github: {
      async detectRepo() { return R.ok('demo-owner/demo-app'); },
      async listIssues() { return R.ok([]); },
      async readRecord() { return R.ok(null); },
      async writeRecord() { return R.ok(undefined); },
      async createOrUpdatePr(_r: string, _branch: string) {
        return R.ok({ number: 42, html_url: `https://github.com/demo-owner/demo-app/pull/42` });
      },
      async dispatchWorkflow() { return R.ok({ runId: 99 }); },
      async downloadArtifact() { return R.ok({}); },
    },
    store: storeService,
    workspace: {
      async readFile() { return R.ok(new Uint8Array()); },
      async writeFile() { return R.ok(undefined); },
      async sha256() { return 'abc'; },
      getRootUri() { return null; },
    },
    views: {
      refreshBugReports() {},
      refreshRuns() {},
      openPanel() {},
      setStatusBar() {},
      async showInfo(_msg: string, ...actions: string[]) { return actions[0]; },
      showError() {},
    },
    runnerClient: {
      async pair() { return R.ok({ port: 0, version: '0.1.0', paired: true } as unknown as import('../src/contracts/runner-api').PairResponse); },
      async disconnect() {},
      async getStatus() { return R.ok(null); },
      isPaired() { return false; },
      onDidChangePairing: fakeEvent as unknown as import('vscode').Event<{ paired: boolean }>,
    },
    executors: { local: executorObj, ci: executorObj },
    providers: providerService,
    pipeline: {
      async acknowledge() { return R.err('stub'); },
      async runMoreTrials() { return R.err('stub'); },
    },
    stats: statsService,
    fix: { async proposeFixes() { return R.err('stub'); }, async runQuickCheck() { return R.err('stub'); }, async applySelected() { return R.err('stub'); } },
    verify: { async verify() { return R.err('stub'); } },
    security: {
      redact: (s: string) => s,
      recordApproval() {},
      isApproved() { return true; },
      isTrustedUrl() { return true; },
    },
  } as unknown as Services;
}

function withIteration(record: IssueRecord): IssueRecord {
  const iter: FixIteration = {
    n: 1, source: 'provider', pr: null, pr_draft: true,
    branch: 'reprise/fix-1', base_sha: '', head_sha: '',
    summary: 'test fix', dropped_files: [], candidates: [],
    review: { verdict: 'ok', findings: [], stubbed: true },
    verification: {
      verdict: 'FIX_INCOMPLETE', finished_at: '',
      run_context: record.replication.repro.run_context,
      repro: { runs_required: 0, runs: 0, failed: 0, invalid: 0, evidence: 'limited', claim: '', injected: false },
      regression: { tests_total: 0, counts: {}, blocking: [], notable: [] },
    },
  };
  return { ...record, state: 'VERIFYING', fix: { iterations: [iter] } };
}

describe('fix.iterations[0] — schema valid for proposeFixes', () => {
  it('produces a FixIteration with candidates when executor passes all runs', async () => {
    const store = new Map<string, IssueRecord>();
    const record = makeRecord();
    store.set('7', record);

    const svc = makeServices(store, [passRun()]);
    const fixSvc = createFix(svc as Omit<Services, 'fix'>);
    const result = await fixSvc.proposeFixes('demo-owner/demo-app', 7);

    assert.ok(result.ok, `proposeFixes failed: ${!result.ok && (result as { error: string }).error}`);
    if (!result.ok) { return; }

    const iter = result.value.fix.iterations[0];
    assert.ok(iter, 'Expected fix.iterations[0]');
    assert.equal(iter.n, 1);
    assert.equal(iter.source, 'provider');
    assert.ok(Array.isArray(iter.candidates));
    assert.ok(iter.candidates.length > 0);
    assert.ok(iter.branch.startsWith('reprise/fix-'));

    for (const c of iter.candidates) {
      assert.ok(typeof c.k === 'number');
      assert.ok(typeof c.diff_hash === 'string');
      const validStatuses = ['selected','survived','rejected_repro','rejected_regression','rejected_duplicate','error'];
      assert.ok(validStatuses.includes(c.status), `unexpected status: ${c.status}`);
    }
  });
});

describe('verify — FIX_INCOMPLETE when repro still fails', () => {
  it('verdict is FIX_INCOMPLETE with failing executor', async () => {
    const store = new Map<string, IssueRecord>();
    store.set('7', withIteration(makeRecord()));

    const svc = makeServices(store, [failRun(), failRun(), failRun()]);
    const verifySvc = createVerify(svc as Omit<Services, 'verify'>);
    const result = await verifySvc.verify('demo-owner/demo-app', 7);

    assert.ok(result.ok, `verify failed: ${!result.ok && (result as { error: string }).error}`);
    if (!result.ok) { return; }

    const iter = result.value.fix.iterations[0];
    assert.ok(iter);
    assert.equal(iter.verification.verdict, 'FIX_INCOMPLETE');
    assert.ok(iter.verification.finished_at !== '');
    assert.equal(typeof iter.verification.repro.runs, 'number');
  });
});

describe('verify — FIX_VERIFIED when repro passes and no regressions', () => {
  it('verdict is FIX_VERIFIED with all-pass executor', async () => {
    const store = new Map<string, IssueRecord>();
    store.set('7', withIteration(makeRecord()));

    // All runs pass → repro_failed=0, no regressions
    const svc = makeServices(store, [passRun(), passRun(), passRun()]);
    const verifySvc = createVerify(svc as Omit<Services, 'verify'>);
    const result = await verifySvc.verify('demo-owner/demo-app', 7);

    assert.ok(result.ok, `verify failed: ${!result.ok && (result as { error: string }).error}`);
    if (!result.ok) { return; }

    const iter = result.value.fix.iterations[0];
    assert.ok(iter);
    assert.equal(iter.verification.verdict, 'FIX_VERIFIED');
    assert.ok(iter.verification.repro.claim.length > 0, 'claim should be non-empty for FIX_VERIFIED');
  });
});

describe('verify — REGRESSION_DETECTED when suite has regressions', () => {
  it('verdict is REGRESSION_DETECTED when head has a new failure', async () => {
    const store = new Map<string, IssueRecord>();
    store.set('7', withIteration(makeRecord()));

    // repro runs all pass (exit_code=0), but suite run on head has a regression.
    let callCount = 0;
    const svcBase = makeServices(store, []);
    // Override executors.local.run to return different results per call.
    const passResult = passRun();
    const headWithRegression: RR = {
      ...passRun(),
      tests: [
        { id: 'LoginTest.kt::testBiometricLogin', status: 'passed', message: '', output: '' },
        { id: 'OtherTest.kt::testSomething', status: 'failed', message: 'broke', output: '' },
      ],
    };
    const baseResult: RR = {
      ...passRun(),
      tests: [
        { id: 'LoginTest.kt::testBiometricLogin', status: 'passed', message: '', output: '' },
        { id: 'OtherTest.kt::testSomething', status: 'passed', message: '', output: '' },
      ],
    };

    (svcBase.executors.local as typeof svcBase.executors.local).run = async () => {
      callCount++;
      // Call 1: repro run (mode=single) → pass
      if (callCount === 1) { return [passResult, passResult, passResult]; }
      // Call 2: base suite → all pass
      if (callCount === 2) { return [baseResult]; }
      // Call 3: head suite → regression
      return [headWithRegression];
    };

    const verifySvc = createVerify(svcBase as Omit<Services, 'verify'>);
    const result = await verifySvc.verify('demo-owner/demo-app', 7);

    assert.ok(result.ok, `verify failed: ${!result.ok && (result as { error: string }).error}`);
    if (!result.ok) { return; }

    const iter = result.value.fix.iterations[0];
    assert.ok(iter);
    assert.equal(iter.verification.verdict, 'REGRESSION_DETECTED');
    assert.ok(iter.verification.regression.blocking.includes('OtherTest.kt::testSomething'));
  });
});
