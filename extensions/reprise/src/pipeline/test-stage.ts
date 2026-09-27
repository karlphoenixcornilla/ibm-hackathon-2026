// pipeline/test-stage.ts — Stage 4: test provide or validate (R-1)
// Owned by: T3
// Spec: 02-specs/replication-pipeline.md §4

import type { Stage, PipelineContext, StageResult } from './types';
import type { TestOutput } from '../contracts/provider';
import { touchRecord } from './record-factory';
import { approveAndWriteTest } from './approve-file';

function needsInfo(ctx: PipelineContext, msg: string, state: 'NEEDS_INFO' | 'STOPPED' = 'NEEDS_INFO'): StageResult {
  const { record } = ctx;
  record.state = state;
  if (state === 'NEEDS_INFO') record.replication.verdict = 'NEEDS_INFO';
  record.replication.question = msg;
  record.replication.finished_at = new Date().toISOString();
  touchRecord(record);
  ctx.addEvent(state === 'NEEDS_INFO' ? 'verdict' : 'stopped', state === 'NEEDS_INFO' ? 'NEEDS_INFO' : msg);
  return { ok: false, error: `${state}: ${msg}`, terminal: true };
}

export const testStage: Stage = {
  async run(ctx: PipelineContext): Promise<StageResult> {
    const { record, services } = ctx;
    const repro = record.replication.repro;

    // Validate mode: the user chose their own test ("Choose Test File for Report").
    if (repro.test_origin === 'user' && repro.test_file) {
      const current = await services.workspace.readFile(repro.test_file);
      if (!current.ok) {
        return needsInfo(ctx, `Your test file ${repro.test_file} could not be read: ${current.error}`);
      }
      const sha256 = await services.workspace.sha256(current.value);
      repro.test_sha256 = sha256;
      services.security.recordApproval(repro.test_file, sha256);
      if (services.runnerClient.approve && services.runnerClient.isPaired()) {
        await services.runnerClient.approve(repro.test_file, sha256);
      }
      repro.attempts = Math.max(1, repro.attempts);
      ctx.addEvent('test.user', repro.test_file);
      touchRecord(record);
      return { ok: true };
    }

    const provider = services.providers.getActive();
    let testOut: TestOutput;
    try {
      const resp = await provider.run(
        {
          stage: 'test',
          issue: record.issue,
          repo: record.repo,
          vars: {},
          attempt: 1,
        },
        ctx.token
      );
      testOut = resp.json as TestOutput;
      record.usage.calls += resp.usage.calls;
      record.usage.by_stage.test = (record.usage.by_stage.test ?? 0) + resp.usage.calls;

      // The provider proposes a test file — it needs approval before it is written or run (PD-10)
      for (const f of resp.files) {
        const approved = await approveAndWriteTest(ctx, f, resp.provider);
        if (!approved.ok) {
          if (approved.rejected) {
            return needsInfo(
              ctx,
              `${approved.error}. Use "Reprise: Choose Test File for Report" to supply your own, or acknowledge again.`,
              'STOPPED'
            );
          }
          throw new Error(approved.error);
        }
        if (f.path === testOut.test_file) repro.test_sha256 = approved.sha256;
      }
      if (resp.files.length > 0 && !resp.files.some((f) => f.path === testOut.test_file)) {
        throw new Error(`The provider named ${testOut.test_file} but proposed ${resp.files.map((f) => f.path).join(', ')}`);
      }

      repro.test_file = testOut.test_file;
      repro.signature = testOut.signature;
      repro.test_origin = 'provided';
      repro.attempts = 1;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // No test available
      return needsInfo(ctx, msg);
    }

    touchRecord(record);
    return { ok: true };
  },
};
