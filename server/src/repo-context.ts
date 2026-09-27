// repo-context.ts — connect a run to the user's paired runner (through the browser) and
// check it serves the repository the run is about.

import { remoteMatches } from './api/remote';
import { RunnerRelay } from './runner-relay';
import type { Run } from './runs';
import type { StagedFiles } from './staging';

/** Everything a run needs to work on the user's local clone. */
export interface RunnerContext {
  relay: RunnerRelay;
  /** The runner's HEAD when the run started: the base for reads and overlays. */
  head: string;
  remote: string;
  stage: StagedFiles;
}

export interface ConnectOptions {
  /** How long to wait for the Review UI to attach to the run. */
  graceMs: number;
  /** How long each relayed runner call may take. */
  timeoutMs: number;
  /** Require the runner's remote to be this repository (off only in mock mode). */
  checkRepo: boolean;
}

export async function connectRunner(run: Run, repo: string, stage: StagedFiles, opts: ConnectOptions): Promise<RunnerContext> {
  if (!(await run.waitForSubscriber(opts.graceMs))) {
    throw new Error('Open the Review UI and connect your local runner, then try again.');
  }
  const relay = new RunnerRelay(run, opts.timeoutMs);
  const status = await relay.status();
  if (opts.checkRepo && !remoteMatches(status.remote, repo)) {
    throw new Error(
      `The runner is serving ${status.remote || 'a repository with no remote'}, not ${repo}. ` +
      `Restart it with --root pointing at your clone of ${repo}.`,
    );
  }
  if (!status.head) { throw new Error('The runner could not resolve HEAD in its repository.'); }
  return { relay, head: status.head, remote: status.remote, stage };
}
