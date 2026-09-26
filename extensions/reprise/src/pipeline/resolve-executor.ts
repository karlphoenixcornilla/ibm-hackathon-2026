// pipeline/resolve-executor.ts — Stage 3: executor resolution
// Owned by: T3
// Spec: 02-specs/replication-pipeline.md §3

import type { Stage, PipelineContext, StageResult } from './types';
import type { Platform } from '../contracts/enums';
import { touchRecord } from './record-factory';

export const resolveExecutorStage: Stage = {
  async run(ctx: PipelineContext): Promise<StageResult> {
    const { record, services } = ctx;
    const fingerprint = record.replication.fingerprint;
    const platform = fingerprint.platform as Platform | 'unknown';

    // Try preferred executor from config
    const config = services.config.get();
    const preferredId = config?.defaults.executor ?? 'local';

    // Check local first, then CI
    const executorOrder: Array<'local' | 'ci'> = preferredId === 'ci'
      ? ['ci', 'local']
      : ['local', 'ci'];

    for (const id of executorOrder) {
      const executor = services.executors[id];
      const avail = await executor.available();
      if (avail.available) {
        // Update the run_context on the record
        record.replication.repro.run_context = {
          ...record.replication.repro.run_context,
          executor: id,
          platform: platform === 'unknown' ? 'android' : platform,
        };
        return { ok: true };
      }
    }

    // No capable executor found
    const platformLabel = platform === 'unknown' ? 'the required platform' : platform;
    const reason = `No Reprise Runner connected on a machine that can run ${platformLabel}`;
    record.state = 'BLOCKED_ENV';
    record.replication.verdict = 'BLOCKED_ENV';
    record.replication.question = reason;
    record.replication.finished_at = new Date().toISOString();
    touchRecord(record);
    ctx.addEvent('verdict', `BLOCKED_ENV: ${reason}`);
    return { ok: false, error: reason, terminal: true };
  },
};
