// pipeline/first-run.ts — Stage 5: first run and revision
// Owned by: T3
// Spec: 02-specs/replication-pipeline.md §5

import type { Stage, PipelineContext, StageResult } from './types';
import type { TestOutput } from '../contracts/provider';
import { touchRecord } from './record-factory';

export const firstRunStage: Stage = {
  async run(ctx: PipelineContext): Promise<StageResult> {
    const { record, services } = ctx;
    const config = services.config.get();
    const maxAttempts = config?.defaults.max_test_attempts ?? 3;
    const repro = record.replication.repro;
    const executorId = repro.run_context.executor;
    const executor = services.executors[executorId];
    const sig = repro.signature;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      repro.attempts = attempt;

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
        ctx.addEvent('error', `first-run attempt ${attempt}: ${msg}`);
        touchRecord(record);
        return { ok: false, error: msg, terminal: true };
      }

      const result = results[0];
      if (!result) {
        continue;
      }

      const failMsg = result.tests
        .filter((t) => t.status === 'failed')
        .map((t) => t.message)
        .join('\n');
      const outcome = services.stats.classifyTrial(result, sig);

      ctx.addEvent('run.finished', outcome);

      if (outcome === 'FAIL_MATCH') {
        // Update run_context from actual result
        record.replication.repro.run_context = {
          platform: result.platform,
          executor: result.executor,
          method: result.method,
          host_os: result.host_os,
          device: result.device,
          ci_run_url: result.ci_run_url,
          runner_version: result.runner_version,
        };
        touchRecord(record);
        return { ok: true };
      }

      // For provided tests, attempt revision via provider
      if (repro.test_origin === 'provided' && attempt < maxAttempts) {
        try {
          const resp = await services.providers.getActive().run(
            {
              stage: 'test',
              issue: record.issue,
              repo: record.repo,
              vars: {
                outcome,
                failure_message: failMsg,
                output_tail: result.output_tail,
              },
              attempt: attempt + 1,
              previous: { test_file: repro.test_file, signature: sig },
            },
            ctx.token
          );
          const revised = resp.json as TestOutput;
          record.usage.calls += resp.usage.calls;
          record.usage.by_stage.test = (record.usage.by_stage.test ?? 0) + resp.usage.calls;

          // Write revised test file
          if (resp.files.length > 0) {
            for (const f of resp.files) {
              const bytes = new TextEncoder().encode(f.content);
              await services.workspace.writeFile(f.path, bytes);
              const sha256 = await services.workspace.sha256(bytes);
              services.security.recordApproval(f.path, sha256);
              repro.test_sha256 = sha256;
            }
          }
          repro.test_file = revised.test_file;
          repro.signature = revised.signature;
          ctx.addEvent('test.approved', `revision ${attempt + 1}`);
          touchRecord(record);
        } catch {
          // Stub cannot revise — fall through to NEEDS_INFO
          break;
        }
        continue;
      }

      // User test or no attempts left
      break;
    }

    // No accepted test
    record.state = 'NEEDS_INFO';
    record.replication.verdict = 'NEEDS_INFO';
    record.replication.question = 'No reproduction test could be confirmed. What was tried and expected?';
    record.replication.finished_at = new Date().toISOString();
    touchRecord(record);
    ctx.addEvent('verdict', 'NEEDS_INFO');
    return { ok: false, error: 'NEEDS_INFO: test could not reproduce the bug', terminal: true };
  },
};
