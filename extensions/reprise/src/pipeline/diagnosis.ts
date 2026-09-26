// pipeline/diagnosis.ts — Stage 7: diagnosis (CONFIRMED and FLAKY only)
// Owned by: T3
// Spec: 02-specs/replication-pipeline.md §7

import type { Stage, PipelineContext, StageResult } from './types';
import type { RootcauseOutput } from '../contracts/provider';
import { validateStageOutput } from '../providers/schema-validator';
import { touchRecord } from './record-factory';

export const diagnosisStage: Stage = {
  async run(ctx: PipelineContext): Promise<StageResult> {
    const { record, services } = ctx;

    // Only run for CONFIRMED or FLAKY
    if (record.state !== 'CONFIRMED' && record.state !== 'FLAKY') {
      return { ok: true };
    }

    let rootcause: RootcauseOutput;
    try {
      const resp = await services.providers.getActive().run(
        {
          stage: 'rootcause',
          issue: record.issue,
          repo: record.repo,
          vars: {
            verdict: record.replication.verdict,
            sequence: record.replication.repro.sequence,
          },
          attempt: 1,
        },
        ctx.token
      );

      // Validate output
      const validationErr = validateStageOutput('rootcause', resp.json);
      if (validationErr) {
        // One repair attempt: ask again with error context
        const resp2 = await services.providers.getActive().run(
          {
            stage: 'rootcause',
            issue: record.issue,
            repo: record.repo,
            vars: { validation_error: validationErr },
            attempt: 2,
            previous: resp.json,
          },
          ctx.token
        );
        const repairErr = validateStageOutput('rootcause', resp2.json);
        if (repairErr) {
          throw new Error(`rootcause output invalid after repair: ${repairErr}`);
        }
        rootcause = resp2.json as RootcauseOutput;
        record.usage.calls += resp2.usage.calls;
        record.usage.by_stage.rootcause =
          (record.usage.by_stage.rootcause ?? 0) + resp2.usage.calls;
      } else {
        rootcause = resp.json as RootcauseOutput;
        record.usage.calls += resp.usage.calls;
        record.usage.by_stage.rootcause =
          (record.usage.by_stage.rootcause ?? 0) + resp.usage.calls;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      record.state = 'ERROR';
      ctx.addEvent('error', `diagnosis: ${msg}`);
      touchRecord(record);
      return { ok: false, error: msg, terminal: true };
    }

    // Persist diagnosis
    record.replication.diagnosis = {
      summary: services.security.redact(rootcause.summary),
      locations: rootcause.locations,
      fix_direction: rootcause.fix_direction,
      confidence: rootcause.confidence,
      accepted_by: '',  // Will be set when the user accepts via "Accept Diagnosis"
      edited: false,
    };

    ctx.addEvent('diagnosis.done');
    touchRecord(record);
    return { ok: true };
  },
};
