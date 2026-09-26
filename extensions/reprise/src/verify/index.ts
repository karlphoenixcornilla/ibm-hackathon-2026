// verify/ — repro check and regression comparison
// Owned by: T4
// Spec: 02-specs/fix-and-verify.md §6–7, statistics.md §5–6, regression-classification.mmd
import type * as vscode from 'vscode';
import type { Services, VerifyService } from '../contracts/services';
import type { IssueRecord, VerificationRepro, VerificationRegression, Verification } from '../contracts/records';
import type { VerifyVerdict, TestClass } from '../contracts/enums';
import type { RunResult, TestResult } from '../contracts/execution';
import type { Result } from '../util/result';
import { Result as R } from '../util/result';

/** Minimal non-cancellable token for use when no real token is provided. */
function neverCancelled(): import('vscode').CancellationToken {
  return { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => undefined }) };
}

export function createVerify(services: Omit<Services, 'verify'>): VerifyService {
  return new VerifyServiceImpl(services as Services);
}

// ── Regression classifier ─────────────────────────────────────────────────────
// Follows regression-classification.mmd exactly.

export interface TestSummary {
  id: string;
  /** null if test did not appear in this run set */
  baseStatus: 'passed' | 'failed' | 'error' | 'skipped' | null;
  headStatus: 'passed' | 'failed' | 'error' | 'skipped' | null;
}

/**
 * Classify a single test's base→head transition into a TestClass.
 * Spec: regression-classification.mmd
 */
export function classifyTestClass(summary: TestSummary): TestClass {
  const { baseStatus, headStatus } = summary;

  if (baseStatus === null && headStatus !== null) {
    // Test was added.
    return headStatus === 'passed' ? 'ADDED_PASSING' : 'ADDED_FAILING';
  }

  if (baseStatus !== null && headStatus === null) {
    // Test was removed.
    return 'REMOVED';
  }

  if (baseStatus === null && headStatus === null) {
    // Should not happen — treat as unchanged pass.
    return 'UNCHANGED_PASS';
  }

  // Both present.
  const basePassed = baseStatus === 'passed';
  const headPassed = headStatus === 'passed';
  const baseFailed = baseStatus === 'failed' || baseStatus === 'error';
  const headFailed = headStatus === 'failed' || headStatus === 'error';

  if (basePassed && headPassed) { return 'UNCHANGED_PASS'; }
  if (baseFailed && headPassed) { return 'NEWLY_PASSING'; }
  if (baseFailed && headFailed) { return 'PRE_EXISTING_FAILURE'; }
  if (basePassed && headFailed) { return 'REGRESSION'; }

  // Skipped on either side — treat as pre-existing flaky.
  return 'PRE_EXISTING_FLAKY';
}

/** Classes that block a FIX_VERIFIED verdict. */
const BLOCKING_CLASSES: TestClass[] = ['ADDED_FAILING', 'REMOVED', 'REGRESSION'];

/** Classify all tests and build the regression section. */
export function buildRegressionSection(
  baseResults: RunResult[],
  headResults: RunResult[],
): VerificationRegression {
  // Flatten tests from all runs into a map: id → best status.
  const baseMap = flattenTests(baseResults);
  const headMap = flattenTests(headResults);

  const allIds = new Set([...baseMap.keys(), ...headMap.keys()]);
  const counts: Partial<Record<TestClass, number>> = {};
  const blocking: string[] = [];
  const notable: string[] = [];

  for (const id of allIds) {
    const summary: TestSummary = {
      id,
      baseStatus: baseMap.get(id) ?? null,
      headStatus: headMap.get(id) ?? null,
    };
    const cls = classifyTestClass(summary);
    counts[cls] = (counts[cls] ?? 0) + 1;

    if (BLOCKING_CLASSES.includes(cls)) {
      blocking.push(id);
    } else if (cls === 'ADDED_FAILING' || cls === 'PRE_EXISTING_FLAKY') {
      notable.push(id);
    }
  }

  return {
    tests_total: allIds.size,
    counts,
    blocking,
    notable,
  };
}

/** Best status for each test id across multiple RunResults (passed > skipped > failed > error). */
function flattenTests(results: RunResult[]): Map<string, TestResult['status']> {
  const ORDER: Record<TestResult['status'], number> = {
    passed: 0, skipped: 1, failed: 2, error: 3,
  };
  const map = new Map<string, TestResult['status']>();
  for (const r of results) {
    for (const t of r.tests) {
      const existing = map.get(t.id);
      if (existing === undefined || ORDER[t.status] < ORDER[existing]) {
        map.set(t.id, t.status);
      }
    }
  }
  return map;
}

// ── Runs-required formula (statistics.md §5) ──────────────────────────────────

export function requiredRuns(
  wilsonLow: number,
  minRuns: number,
  maxRuns: number,
): { required: number; capped: boolean } {
  const alpha = 0.05;
  let raw: number;
  if (wilsonLow >= 1) {
    raw = minRuns;
  } else if (wilsonLow <= 0) {
    raw = maxRuns;
  } else {
    raw = Math.ceil(Math.log(alpha) / Math.log(1 - wilsonLow));
  }
  const required = Math.min(Math.max(raw, minRuns), maxRuns);
  return { required, capped: raw > maxRuns };
}

// ── Claim sentence (statistics.md §6) ────────────────────────────────────────

function buildClaim(
  r: number,
  required: number,
  capped: boolean,
  runs: number,
): string {
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const alpha = 0.05;

  if (!capped) {
    return (
      `If this bug were still present at its replication rate (at least ${pct(r)}), ` +
      `the chance of ${required} clean runs would be below 5%.`
    );
  }
  const bound = 1 - Math.pow(alpha, 1 / runs);
  return (
    `${runs} clean runs rule out failure rates above ${pct(bound)}. ` +
    `The bug's replication rate may be as low as ${pct(r)}, so this is limited evidence. ` +
    `Consider verifying again with a higher run limit.`
  );
}

// ── VerifyServiceImpl ─────────────────────────────────────────────────────────

class VerifyServiceImpl implements VerifyService {
  constructor(private readonly svc: Services) {}

  async verify(
    repo: string,
    issue: number,
    token?: vscode.CancellationToken,
  ): Promise<Result<IssueRecord, string>> {
    const recordResult = await this.svc.store.load(repo, issue);
    if (!recordResult.ok) { return recordResult; }
    if (!recordResult.value) { return R.err(`Issue #${issue} not found.`); }
    const record = recordResult.value;

    const config = this.svc.config.get();
    if (!config) { return R.err('Config not loaded.'); }

    const repro = record.replication?.repro;
    if (!repro) { return R.err('No replication data found.'); }

    const platform = repro.run_context.platform;
    const executor = this.svc.executors.local;
    const cancelToken = token ?? neverCancelled();

    const verifyCfg = config.verify;
    const { required, capped } = requiredRuns(
      repro.wilson_low,
      verifyCfg.min_runs ?? 3,
      verifyCfg.max_runs ?? 200,
    );

    // ── 1. Reproduction test check ────────────────────────────────────────────
    this.svc.views.setStatusBar(`Reprise: verifying fix #${issue} — repro check (${required} runs)…`);

    let reproResults: RunResult[] = [];
    try {
      reproResults = await executor.run(
        { platform, mode: 'single', test_path: repro.test_file, runs: required, ref: null },
        cancelToken,
        () => {},
      );
    } catch (err: unknown) {
      return R.err(`Repro run failed: ${(err as Error).message}`);
    }

    let reproFailed = 0;
    let reproInvalid = 0;
    for (const r of reproResults) {
      const outcome = this.svc.stats.classifyTrial(r, repro.signature);
      if (outcome === 'FAIL_MATCH') { reproFailed++; }
      else if (outcome !== 'PASS') { reproInvalid++; }
    }

    // ── 2. Regression comparison (test.all on base and head) ──────────────────
    const platConfig = config.platforms?.[platform];
    const hasAllCommand = !!platConfig?.test?.all;

    let regressionSection: VerificationRegression = {
      tests_total: 0,
      counts: {},
      blocking: [],
      notable: [],
    };
    let noSuiteConfigured = false;

    if (!hasAllCommand) {
      noSuiteConfigured = true;
    } else {
      this.svc.views.setStatusBar(`Reprise: verifying fix #${issue} — regression check…`);
      let baseResults: RunResult[] = [];
      let headResults: RunResult[] = [];
      try {
        baseResults = await executor.run(
          { platform, mode: 'all', test_path: '', runs: 1, ref: { base: repro.branch } },
          cancelToken,
          () => {},
        );
        headResults = await executor.run(
          { platform, mode: 'all', test_path: '', runs: 1, ref: null },
          cancelToken,
          () => {},
        );
      } catch (err: unknown) {
        return R.err(`Regression run failed: ${(err as Error).message}`);
      }
      regressionSection = buildRegressionSection(baseResults, headResults);
    }

    // ── 3. Verdict ────────────────────────────────────────────────────────────
    let verdict: VerifyVerdict;
    if (regressionSection.blocking.length > 0) {
      verdict = 'REGRESSION_DETECTED';
    } else if (reproFailed > 0 || noSuiteConfigured && reproFailed > 0) {
      verdict = 'FIX_INCOMPLETE';
    } else if (reproFailed === 0 && reproResults.length >= required) {
      verdict = 'FIX_VERIFIED';
    } else {
      verdict = 'FIX_INCOMPLETE';
    }

    const evidence = capped ? 'limited' : 'strong';
    const claim =
      verdict === 'FIX_VERIFIED'
        ? buildClaim(repro.wilson_low, required, capped, reproResults.length)
        : '';

    const reproPart: VerificationRepro = {
      runs_required: required,
      runs: reproResults.length,
      failed: reproFailed,
      invalid: reproInvalid,
      evidence,
      claim,
      injected: false,
    };

    const runCtx = reproResults[0]
      ? {
          platform: reproResults[0].platform,
          executor: reproResults[0].executor,
          method: reproResults[0].method,
          host_os: reproResults[0].host_os,
          device: reproResults[0].device,
          ci_run_url: reproResults[0].ci_run_url,
          runner_version: reproResults[0].runner_version,
        }
      : repro.run_context;

    const verification: Verification = {
      verdict,
      finished_at: new Date().toISOString(),
      run_context: runCtx,
      repro: reproPart,
      regression: regressionSection,
    };

    // ── 4. Write back to record ───────────────────────────────────────────────
    const iterations = [...record.fix.iterations];
    if (iterations.length > 0) {
      const last = iterations[iterations.length - 1];
      iterations[iterations.length - 1] = { ...last, verification };
    }

    const newState =
      verdict === 'FIX_VERIFIED'
        ? 'FIX_VERIFIED'
        : verdict === 'REGRESSION_DETECTED'
          ? 'REGRESSION_DETECTED'
          : 'FIX_INCOMPLETE';

    const updated: IssueRecord = {
      ...record,
      state: newState,
      updated_at: new Date().toISOString(),
      fix: { iterations },
    };

    const saveResult = await this.svc.store.save(updated);
    if (!saveResult.ok) { return saveResult; }

    this.svc.views.setStatusBar(`Reprise: ${verdict} — fix #${issue}`);

    // ── 5. Self-review (PD-29, if fix.self_review is on) ──────────────────────
    if (verdict === 'FIX_VERIFIED' && config.fix.self_review) {
      await this._runSelfReview(repo, issue, updated, cancelToken);
    }

    return R.ok(updated);
  }

  private async _runSelfReview(
    repo: string,
    issue: number,
    record: IssueRecord,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const provider = this.svc.providers.getActive();
    try {
      const resp = await provider.run(
        { stage: 'review', issue, repo, vars: {}, attempt: 1 },
        token,
      );
      const review = resp.json as { verdict: 'ok' | 'changes_needed'; findings: unknown[] };
      const iter = record.fix.iterations[record.fix.iterations.length - 1];
      if (!iter) { return; }

      const updatedIter = {
        ...iter,
        review: {
          verdict: review.verdict ?? 'ok',
          findings: (review.findings ?? []) as FixIteration['review']['findings'],
          stubbed: resp.stubbed,
        },
      };
      const iterations = [...record.fix.iterations];
      iterations[iterations.length - 1] = updatedIter;
      await this.svc.store.save({ ...record, fix: { iterations } });
    } catch {
      // Self-review failure is non-fatal.
    }
  }
}

// Re-export for test access.
import type { FixIteration } from '../contracts/records';
