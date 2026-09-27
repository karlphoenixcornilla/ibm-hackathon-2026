// pipeline/intake.ts — Stage 1: intake via provider
// Owned by: T3
// Spec: 02-specs/replication-pipeline.md §1

import type { Stage, PipelineContext, StageResult } from './types';
import type { IntakeOutput } from '../contracts/provider';
import { touchRecord } from './record-factory';

export const intakeStage: Stage = {
  async run(ctx: PipelineContext): Promise<StageResult> {
    const { record, services } = ctx;
    const provider = services.providers.getActive();

    let response;
    try {
      response = await provider.run(
        {
          stage: 'intake',
          issue: record.issue,
          repo: record.repo,
          vars: {},
          attempt: 1,
        },
        ctx.token
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      record.state = 'ERROR';
      touchRecord(record);
      ctx.addEvent('error', `intake: ${msg}`);
      return { ok: false, error: msg, terminal: true };
    }

    const out = response.json as IntakeOutput;

    // Persist fingerprint
    record.replication.fingerprint = { ...out.fingerprint };
    record.provider = response.provider;
    record.stubbed = response.stubbed;

    // Accumulate usage
    record.usage.provider = response.provider;
    record.usage.calls += response.usage.calls;
    record.usage.by_stage.intake = (record.usage.by_stage.intake ?? 0) + response.usage.calls;

    ctx.addEvent('intake.done');
    touchRecord(record);

    // If attempt_possible is false → NEEDS_INFO
    if (!out.attempt_possible) {
      record.state = 'NEEDS_INFO';
      record.replication.verdict = 'NEEDS_INFO';
      record.replication.question = out.question;
      record.replication.finished_at = new Date().toISOString();
      touchRecord(record);
      ctx.addEvent('verdict', 'NEEDS_INFO');
      return { ok: false, error: `NEEDS_INFO: ${out.question}`, terminal: true };
    }

    return { ok: true };
  },
};
