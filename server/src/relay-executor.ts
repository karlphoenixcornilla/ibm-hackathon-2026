// relay-executor.ts — the backend's "local" executor.
// A hosted backend cannot reach the user's runner on 127.0.0.1, so each RunRequest is sent
// to the browser as an `exec.request` SSE event; the browser forwards it to its paired
// runner and POSTs the results back to /api/runs/:id/exec/:reqId.
//
// With a RunnerContext, `ref: null` ("the working copy" to core) means HEAD plus whatever
// core staged: the staged files are approved and sent as an overlay, and the run happens
// on a runner worktree. The user's clone is never modified.

import { createHash } from 'node:crypto';
import type { Availability, CancellationToken, Executor, RunEvent, RunRequest, RunResult } from '@reprise/core';
import type { RunnerContext } from './repo-context';
import type { Run } from './runs';

export interface RelayExecutorOptions {
  /** How long available() waits for the browser to open the run's stream. Default 10 s. */
  connectGraceMs?: number;
  /** The paired runner; enables staging via overlays. */
  runner?: RunnerContext;
}

export class RelayExecutor implements Executor {
  readonly id = 'local' as const;
  private readonly connectGraceMs: number;
  private readonly runner: RunnerContext | undefined;
  /** The overlay for a given stage version, so repeated runs reuse it. */
  private overlay: { version: number; id: string } | null = null;

  /** @param timeoutMs how long to wait for the browser to return a run's results */
  constructor(private readonly target: Run, private readonly timeoutMs: number, opts: RelayExecutorOptions = {}) {
    this.connectGraceMs = opts.connectGraceMs ?? 10_000;
    this.runner = opts.runner;
  }

  async available(): Promise<Availability> {
    return (await this.target.waitForSubscriber(this.connectGraceMs))
      ? { available: true }
      : { available: false, reason: 'Open the Review UI to connect your local runner.' };
  }

  /** The overlay holding the current staged files (created on demand), or null if nothing is staged. */
  async overlayId(): Promise<string | null> {
    const runner = this.runner;
    if (!runner) { return null; }
    const files = runner.stage.files();
    if (files.length === 0) { return null; }
    const version = runner.stage.version;
    if (this.overlay?.version === version) { return this.overlay.id; }
    for (const f of files) {
      await runner.relay.approve(f.path, createHash('sha256').update(f.content, 'utf8').digest('hex'));
    }
    const { overlay_id } = await runner.relay.createOverlay(runner.head, files);
    this.overlay = { version, id: overlay_id };
    return overlay_id;
  }

  async run(req: RunRequest, token: CancellationToken, onEvent: (event: RunEvent) => void): Promise<RunResult[]> {
    let ref = req.ref;
    if (ref === null && this.runner) {
      const overlay = await this.overlayId();
      ref = overlay ? { overlay } : { head: this.runner.head };
    }
    const results = await this.target.requestExec({ ...req, ref }, this.timeoutMs, token);
    for (const result of results) { onEvent({ type: 'result', result }); }
    onEvent({ type: 'done' });
    return results;
  }
}
