// relay-executor.ts — the backend's "local" executor.
// A hosted backend cannot reach the user's runner on 127.0.0.1, so each RunRequest is sent
// to the browser as an `exec.request` SSE event; the browser forwards it to its paired
// runner and POSTs the results back to /api/runs/:id/exec/:reqId.

import type { Availability, CancellationToken, Executor, RunEvent, RunRequest, RunResult } from '@reprise/core';
import type { Run } from './runs';

export class RelayExecutor implements Executor {
  readonly id = 'local' as const;

  constructor(private readonly target: Run, private readonly timeoutMs: number) {}

  async available(): Promise<Availability> {
    return this.target.subscriberCount > 0
      ? { available: true }
      : { available: false, reason: 'Open the Review UI to connect your local runner.' };
  }

  async run(req: RunRequest, token: CancellationToken, onEvent: (event: RunEvent) => void): Promise<RunResult[]> {
    const results = await this.target.requestExec(req, this.timeoutMs, token);
    for (const result of results) { onEvent({ type: 'result', result }); }
    onEvent({ type: 'done' });
    return results;
  }
}
