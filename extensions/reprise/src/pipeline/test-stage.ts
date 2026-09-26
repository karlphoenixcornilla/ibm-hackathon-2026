// pipeline/test-stage.ts — Stage 4: test provide or validate (R-1)
// Owned by: T3
// Spec: 02-specs/replication-pipeline.md §4

import type { Stage, PipelineContext, StageResult } from './types';
import type { TestOutput } from '../contracts/provider';
import { touchRecord } from './record-factory';

export const testStage: Stage = {
  async run(ctx: PipelineContext): Promise<StageResult> {
    const { record, services } = ctx;
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

      // The provider proposes a test file — require approval (PD-10)
      if (resp.files.length > 0) {
        for (const f of resp.files) {
          // Write to workspace
          const bytes = new TextEncoder().encode(f.content);
          const writeResult = await services.workspace.writeFile(f.path, bytes);
          if (!writeResult.ok) {
            throw new Error(`Failed to write test file: ${writeResult.error}`);
          }
          // Compute SHA-256 and register approval
          const sha256 = await services.workspace.sha256(bytes);
          services.security.recordApproval(f.path, sha256);
          record.replication.repro.test_sha256 = sha256;
        }
      }

      record.replication.repro.test_file = testOut.test_file;
      record.replication.repro.signature = testOut.signature;
      record.replication.repro.test_origin = 'provided';
      record.replication.repro.attempts = 1;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // No test available
      record.state = 'NEEDS_INFO';
      record.replication.verdict = 'NEEDS_INFO';
      record.replication.question = msg;
      record.replication.finished_at = new Date().toISOString();
      touchRecord(record);
      ctx.addEvent('verdict', 'NEEDS_INFO');
      return { ok: false, error: `NEEDS_INFO: no test available: ${msg}`, terminal: true };
    }

    ctx.addEvent('test.approved');
    touchRecord(record);
    return { ok: true };
  },
};
