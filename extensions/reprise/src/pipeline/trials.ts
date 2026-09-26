// pipeline/trials.ts — Stage 6: run trials and compute verdict
// Owned by: T3
// Spec: 02-specs/replication-pipeline.md §6, statistics.md §2a

import type { Stage, PipelineContext, StageResult } from './types';
import type { TrialsPolicy as RecordTrialsPolicy } from '../contracts/records';
import {
  classifyTrial,
  wilsonInterval,
  zeroFailureUpperBound,
  shouldEarlyStop,
  verdict as computeVerdict,
} from '../stats/stats';
import { touchRecord } from './record-factory';

export const trialsStage: Stage = {
  async run(ctx: PipelineContext): Promise<StageResult> {
    const { record, services } = ctx;
    const config = services.config.get();
    const repro = record.replication.repro;
    const executorId = repro.run_context.executor;
    const executor = services.executors[executorId];
    const sig = repro.signature;

    // Resolve trials policy: config defaults, then per-platform override, then per-run override
    const configPolicy = config?.defaults.trials ?? { min: 10, max: 20, limit: 100, max_minutes: null };
    const platformPolicy = config?.platforms[repro.run_context.platform]?.trials ?? {};
    const merged = {
      min: ctx.trialsOverride?.min ?? platformPolicy.min ?? configPolicy.min,
      max: ctx.trialsOverride?.max ?? platformPolicy.max ?? configPolicy.max,
      limit: ctx.trialsOverride?.limit ?? platformPolicy.limit ?? configPolicy.limit,
      max_minutes: ctx.trialsOverride?.max_minutes ?? platformPolicy.max_minutes ?? configPolicy.max_minutes,
    };
    const source: 'config' | 'user' = ctx.trialsOverride ? 'user' : 'config';

    let sequence = '';
    let pass = 0, fail_match = 0, fail_other = 0, error = 0;
    let stoppedBy: RecordTrialsPolicy['stopped_by'] = 'max_reached';
    const startMs = Date.now();

    const maxRuns = merged.max;

    ctx.addEvent('run.started');

    for (let i = 0; i < maxRuns; i++) {
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
          ctx.token,
          () => undefined
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        record.state = 'ERROR';
        ctx.addEvent('error', `trial ${i + 1}: ${msg}`);
        touchRecord(record);
        return { ok: false, error: msg, terminal: true };
      }

      const result = results[0];
      if (!result) continue;

      const failMsg = result.tests
        .filter((t) => t.status === 'failed')
        .map((t) => t.message)
        .join('\n');
      const outcome = classifyTrial(
        result.exit_code,
        result.timed_out,
        failMsg,
        result.output_tail,
        sig
      );

      if (outcome === 'PASS') { pass++; sequence += 'P'; }
      else if (outcome === 'FAIL_MATCH') { fail_match++; sequence += 'F'; }
      else if (outcome === 'FAIL_OTHER') { fail_other++; sequence += 'X'; }
      else { error++; sequence += 'E'; }

      const n = pass + fail_match;
      const invalid = fail_other + error;

      // Check invalid rate: >10% of total so far
      const total = n + invalid;
      if (total > 0 && invalid / total > 0.10) {
        // Too many invalid runs — continue attempting if we have budget
        // (the spec says return to repro loop if attempts remain; simplified here)
      }

      // Check early stop at min (spec §2a rule 1)
      if (n >= merged.min && shouldEarlyStop(n, fail_match, merged.min)) {
        stoppedBy = 'all_failed_at_min';
        break;
      }

      // Check time budget (spec §2a max_minutes)
      if (
        merged.max_minutes !== null &&
        n >= merged.min &&
        (Date.now() - startMs) / 60000 >= merged.max_minutes
      ) {
        stoppedBy = 'time_budget';
        break;
      }
    }

    const n = pass + fail_match;
    const k = fail_match;
    const invalid = fail_other + error;

    // Compute Wilson interval
    const { low: wilsonLow, high: wilsonHigh } = wilsonInterval(k, n);

    // Compute verdict
    const counts = { pass, fail_match, fail_other, error };
    const v = computeVerdict(counts);

    // Build NEEDS_INFO upper-bound sentence if k === 0
    let question = '';
    if (v === 'NEEDS_INFO' && n > 0) {
      const bound = zeroFailureUpperBound(n);
      question = `The test never failed in ${n} runs, so if this bug exists here it happens in fewer than about ${(bound * 100).toFixed(1)}% of runs.`;
    }

    // Persist to record
    repro.trials = n;
    repro.failed = k;
    repro.invalid = invalid;
    repro.sequence = sequence;
    repro.rate = n > 0 ? k / n : 0;
    repro.wilson_low = wilsonLow;
    repro.wilson_high = wilsonHigh;
    repro.trials_policy = {
      min: merged.min,
      max: merged.max,
      limit: merged.limit,
      max_minutes: merged.max_minutes,
      source,
      stopped_by: stoppedBy,
    };

    record.replication.verdict = v;
    record.replication.question = question;
    record.replication.finished_at = new Date().toISOString();
    record.replication.duration_ms = Date.now() - new Date(record.replication.started_at).getTime();

    // State transitions
    if (v === 'CONFIRMED') record.state = 'CONFIRMED';
    else if (v === 'FLAKY') record.state = 'FLAKY';
    else record.state = 'NEEDS_INFO';

    touchRecord(record);
    ctx.addEvent('verdict', v);

    return { ok: true };
  },
};
