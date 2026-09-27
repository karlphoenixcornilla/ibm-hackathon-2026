// exec/local/ — local executor (sends POST /runs to runner, streams results)
// Owned by: T2
// Spec: 02-specs/test-execution.md §Local executor

import type { CancellationToken } from '../../contracts/events';
import type { Services } from '../../contracts/services';
import type { Executor, RunRequest, RunResult, RunEvent, Availability } from '../../contracts/execution';
import type { RunsRequest, RunsResponse, RunnerEvent } from '../../contracts/runner-api';

/**
 * Create the LocalExecutor backed by the RunnerClientService from services.
 */
export function createLocalExecutor(
  services: Omit<Services, never>
): Executor {
  return new LocalExecutor(services);
}

/**
 * Extended interface for the internal methods we need from the runner client.
 * These methods are on the concrete RunnerClient class but not on the service
 * interface (they're consumed only by this executor).
 */
interface RunnerClientInternal {
  startRun(request: RunsRequest): Promise<{ ok: true; value: RunsResponse } | { ok: false; error: string }>;
  openEventStream(runId: string, onEvent: (event: RunnerEvent) => void): () => void;
  cancelRun(runId: string): Promise<void>;
}

class LocalExecutor implements Executor {
  readonly id: 'local' = 'local';

  constructor(private readonly services: Omit<Services, never>) {}

  async available(): Promise<Availability> {
    const client = this.services.runnerClient;
    if (!client.isPaired()) {
      return { available: false, reason: 'Connect Runner: no runner is paired.' };
    }
    const statusResult = await client.getStatus();
    if (!statusResult.ok) {
      return { available: false, reason: `Runner status error: ${statusResult.error}` };
    }
    if (statusResult.value === null) {
      return { available: false, reason: 'Connect Runner: runner returned no status.' };
    }
    if ((statusResult.value as { busy?: boolean }).busy) {
      return { available: false, reason: 'Runner is busy with another run.' };
    }
    return { available: true };
  }

  async run(
    req: RunRequest,
    token: CancellationToken,
    onEvent: (event: RunEvent) => void
  ): Promise<RunResult[]> {
    const client = this.services.runnerClient;

    if (!client.isPaired()) {
      throw new Error('No runner is paired. Use "Connect Runner" to pair first.');
    }

    // The concrete RunnerClient exposes startRun/openEventStream/cancelRun;
    // cast through the internal interface so this module doesn't import runner-client/.
    const internal = client as unknown as RunnerClientInternal;

    // POST /runs
    const runsResponse = await internal.startRun({
      platform: req.platform,
      mode: req.mode,
      test_path: req.test_path,
      runs: req.runs,
      ref: req.ref,
    });

    if (!runsResponse.ok) {
      throw new Error(`Runner refused run: ${runsResponse.error}`);
    }

    const runId = runsResponse.value.run_id;

    // Subscribe to SSE events
    const results: RunResult[] = [];

    await new Promise<void>((resolve, reject) => {
      const teardown = internal.openEventStream(runId, (event: RunnerEvent) => {
        // Forward to Runs view
        onEvent(event as RunEvent);

        if (event.type === 'result') {
          results.push(event.result as RunResult);
        } else if (event.type === 'done') {
          teardown();
          resolve();
        } else if (event.type === 'error') {
          teardown();
          reject(new Error(event.message));
        }
      });

      // Cancellation support
      token.onCancellationRequested(async () => {
        teardown();
        await internal.cancelRun(runId).catch(() => {});
        resolve();
      });
    });

    return results;
  }
}
