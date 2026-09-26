// pipeline/record-stage.ts — Stage 8: persist record and refresh views
// Owned by: T3
// Spec: 02-specs/replication-pipeline.md §8

import type { Stage, PipelineContext, StageResult } from './types';
import { touchRecord } from './record-factory';

export const recordStage: Stage = {
  async run(ctx: PipelineContext): Promise<StageResult> {
    const { record, services } = ctx;

    touchRecord(record);
    const saveResult = await services.store.save(record);
    if (!saveResult.ok) {
      ctx.addEvent('error', `Failed to save record: ${saveResult.error}`);
      return { ok: false, error: saveResult.error };
    }

    services.views.refreshBugReports();
    return { ok: true };
  },
};
