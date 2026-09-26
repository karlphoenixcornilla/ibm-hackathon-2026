// pipeline/orchestrator.ts — Pipeline orchestrator
// Owned by: T3
// Spec: 02-specs/replication-pipeline.md

import type { Services, PipelineService, TrialsPolicy } from '../contracts/services';
import type { IssueRecord, IssueEvent } from '../contracts/records';
import type { Result } from '../util/result';
import type * as vscode from 'vscode';
import { Result as R } from '../util/result';
import { makeBlankRecord, touchRecord } from './record-factory';
import { intakeStage } from './intake';
import { dedupeStage } from './dedupe';
import { resolveExecutorStage } from './resolve-executor';
import { testStage } from './test-stage';
import { firstRunStage } from './first-run';
import { trialsStage } from './trials';
import { diagnosisStage } from './diagnosis';
import { recordStage } from './record-stage';
import type { PipelineContext } from './types';

const EVENT_CAP = 200;

function addEvent(record: IssueRecord, type: string, detail = ''): void {
  if (record.events.length >= EVENT_CAP) return;
  record.events.push({
    at: new Date().toISOString(),
    type,
    detail: detail,
  } satisfies IssueEvent);
}

export class PipelineOrchestrator implements PipelineService {
  constructor(private readonly services: Omit<Services, 'pipeline'>) {}

  async acknowledge(
    repo: string,
    issue: number,
    trialsOverride?: Partial<TrialsPolicy>,
    token?: vscode.CancellationToken
  ): Promise<Result<IssueRecord, string>> {
    // Resolve cancellation token
    const cancelToken: vscode.CancellationToken = token ?? {
      isCancellationRequested: false,
      onCancellationRequested: (() => ({ dispose: () => undefined })) as unknown as vscode.Event<unknown>,
    };

    // Check preconditions (spec §0)
    const config = this.services.config.get();
    if (!config) {
      const record = makeBlankRecord(repo, issue, '', `https://github.com/${repo}/issues/${issue}`, '');
      record.state = 'BLOCKED_ENV';
      record.replication.verdict = 'BLOCKED_ENV';
      record.replication.question = 'BLOCKED_ENV: .reprise.yml not loaded';
      return R.err('BLOCKED_ENV: .reprise.yml not loaded');
    }

    // Look up existing record or create new
    const existing = await this.services.store.load(repo, issue);
    let record: IssueRecord;
    const now = new Date().toISOString();

    if (existing.ok && existing.value) {
      record = existing.value;
      // Reset for re-acknowledgement
      record.state = 'REPLICATING';
      record.updated_at = now;
      record.replication.started_at = now;
    } else {
      // Fetch issue metadata from GitHub
      const issueList = await this.services.github.listIssues(repo);
      let title = `Issue #${issue}`;
      if (issueList.ok) {
        const gh = issueList.value.find((i) => i.number === issue);
        if (gh) title = gh.title;
      }
      record = makeBlankRecord(
        repo,
        issue,
        title,
        `https://github.com/${repo}/issues/${issue}`,
        '' // acknowledged_by — not available without auth at this point
      );
    }

    addEvent(record, 'acknowledged');

    const ctx: PipelineContext = {
      repo,
      issue,
      record,
      services: this.services,
      trialsOverride,
      token: cancelToken,
      addEvent: (type, detail) => addEvent(record, type, detail),
    };

    // ── Run stages sequentially ───────────────────────────────────────────────
    const stages = [
      intakeStage,
      dedupeStage,
      resolveExecutorStage,
      testStage,
      firstRunStage,
      trialsStage,
      diagnosisStage,
      recordStage,
    ];

    for (const stage of stages) {
      // Check cancellation
      if (cancelToken.isCancellationRequested) {
        record.state = 'STOPPED';
        touchRecord(record);
        addEvent(record, 'error', 'Cancelled by user');
        await this.services.store.save(record);
        return R.err('Cancelled');
      }

      const result = await stage.run(ctx);

      // Always persist after each stage
      touchRecord(record);
      await this.services.store.save(record);
      this.services.views.refreshBugReports();

      if (!result.ok) {
        if (result.terminal) {
          // Terminal state set on record — return the record
          return R.ok(record);
        }
        return R.err(result.error ?? 'Unknown pipeline error');
      }
    }

    return R.ok(record);
  }

  async runMoreTrials(
    repo: string,
    issue: number,
    count: number,
    token?: vscode.CancellationToken
  ): Promise<Result<IssueRecord, string>> {
    const loaded = await this.services.store.load(repo, issue);
    if (!loaded.ok || !loaded.value) {
      return R.err('No existing record found');
    }
    const record = loaded.value;

    // Validate that we can add more trials
    const repro = record.replication.repro;
    const currentTrials = repro.trials;
    const policyLimit = repro.trials_policy.limit;

    if (currentTrials >= policyLimit) {
      return R.err(`Already at trial limit (${policyLimit})`);
    }

    const toRun = Math.min(count, policyLimit - currentTrials);
    if (toRun <= 0) {
      return R.err('No additional trials possible');
    }

    const cancelToken: vscode.CancellationToken = token ?? {
      isCancellationRequested: false,
      onCancellationRequested: (() => ({ dispose: () => undefined })) as unknown as vscode.Event<unknown>,
    };

    const executorId = repro.run_context.executor;
    const executor = this.services.executors[executorId];
    const sig = repro.signature;

    addEvent(record, 'trials.extended', `+${toRun}`);

    let pass = 0, fail_match = 0, fail_other = 0, error = 0;
    // Parse existing sequence counts
    for (const ch of repro.sequence) {
      if (ch === 'P') pass++;
      else if (ch === 'F') fail_match++;
      else if (ch === 'X') fail_other++;
      else if (ch === 'E') error++;
    }

    let sequence = repro.sequence;

    for (let i = 0; i < toRun; i++) {
      if (cancelToken.isCancellationRequested) break;
      let results;
      try {
        results = await executor.run(
          {
            platform: repro.run_context.platform,
            mode: 'single',
            test_path: repro.test_file,
            runs: 1,
            ref: null,
          },
          cancelToken,
          () => undefined
        );
      } catch (e) {
        addEvent(record, 'error', `extended trial: ${e instanceof Error ? e.message : String(e)}`);
        break;
      }

      const result = results[0];
      if (!result) continue;

      const failMsg = result.tests.filter((t) => t.status === 'failed').map((t) => t.message).join('\n');
      const { classifyTrial } = await import('../stats/stats');
      const outcome = classifyTrial(result.exit_code, result.timed_out, failMsg, result.output_tail, sig);

      if (outcome === 'PASS') { pass++; sequence += 'P'; }
      else if (outcome === 'FAIL_MATCH') { fail_match++; sequence += 'F'; }
      else if (outcome === 'FAIL_OTHER') { fail_other++; sequence += 'X'; }
      else { error++; sequence += 'E'; }
    }

    const n = pass + fail_match;
    const k = fail_match;
    const { wilsonInterval, verdict: computeVerdict } = await import('../stats/stats');
    const { low: wilsonLow, high: wilsonHigh } = wilsonInterval(k, n);
    const counts = { pass, fail_match, fail_other, error };
    const v = computeVerdict(counts);

    repro.trials = n;
    repro.failed = k;
    repro.invalid = fail_other + error;
    repro.sequence = sequence;
    repro.rate = n > 0 ? k / n : 0;
    repro.wilson_low = wilsonLow;
    repro.wilson_high = wilsonHigh;
    repro.trials_policy.stopped_by = 'user_extended';

    record.replication.verdict = v;
    if (v === 'CONFIRMED') record.state = 'CONFIRMED';
    else if (v === 'FLAKY') record.state = 'FLAKY';
    else record.state = 'NEEDS_INFO';

    touchRecord(record);
    addEvent(record, 'verdict', v);
    await this.services.store.save(record);
    this.services.views.refreshBugReports();

    return R.ok(record);
  }
}
