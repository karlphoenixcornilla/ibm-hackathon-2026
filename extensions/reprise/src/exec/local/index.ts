// exec/local/ — local executor (sends POST /runs to runner, streams results)
// Owned by: T2
// Spec: 02-specs/test-execution.md §Local executor

import type * as runtime from '../../contracts/runtime';
import type { Services } from '../../contracts/services';
import type { Executor, RunRequest, RunResult, RunEvent, Availability } from '../../contracts/execution';
import type { RunnerEvent } from '../../contracts/runner-api';

/**
 * Create the LocalExecutor backed by the RunnerClientService from services.
 */
export function createLocalExecutor(
  services: Omit<Services, never>
): Executor {
  return new LocalExecutor(services);
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
    token: runtime.CancellationToken,
    onEvent: (event: RunEvent) => void
  ): Promise<RunResult[]> {
    const client = this.services.runnerClient;

    if (!client.isPaired()) {
      throw new Error('No runner is paired. Use "Connect Runner" to pair first.');
    }

    if (token.isCancellationRequested) throw new Error('Run cancelled');
    if (!client.startRun || !client.openEventStream || !client.cancelRun) throw new Error('Runner does not support local execution');
    const internal = {
      startRun: client.startRun.bind(client),
      openEventStream: client.openEventStream.bind(client),
      cancelRun: client.cancelRun.bind(client),
    };

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
      let settled = false;
      let cancelling = false;
      let teardown = () => {};
      const lifecycle: { subscription?: runtime.Disposable } = {};
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        teardown();
        lifecycle.subscription?.dispose();
        if (error) reject(error); else resolve();
      };
      const cancel = () => {
        if (settled || cancelling) return;
        cancelling = true;
        teardown();
        void internal.cancelRun(runId).then(() => finish(new Error('Run cancelled')), () => finish(new Error('Run cancelled')));
      };
      teardown = internal.openEventStream(runId, (event: RunnerEvent) => {
        if (settled || cancelling) return;
        onEvent(event);
        if (event.type === 'result') results.push(event.result);
        else if (event.type === 'done') finish();
        else if (event.type === 'error') finish(new Error(event.message));
      });
      if (settled) { teardown(); return; }
      lifecycle.subscription = token.onCancellationRequested(cancel);
      if (token.isCancellationRequested) cancel();
    });

    return results;
  }
}
