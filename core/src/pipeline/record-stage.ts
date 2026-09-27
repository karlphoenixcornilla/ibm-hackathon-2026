// pipeline/record-stage.ts — Stage 8: persist record and notify watchers
// Owned by: T3
// Spec: 02-specs/replication-pipeline.md §8

import type { Services } from '../contracts/services';
import type { IssueRecord } from '../contracts/records';
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

    notifyRecordUpdated(services, record);
    return { ok: true };
  },
};

/** Tell watchers (UI, API subscribers) that a record changed. */
export function notifyRecordUpdated(services: Pick<Services, 'notifier'>, record: IssueRecord): void {
  services.notifier.emit({ type: 'record.updated', repo: record.repo, issue: record.issue, state: record.state });
}
