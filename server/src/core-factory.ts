// core-factory.ts — builds a core container per request/run.
// Real mode: buildCore with the session's token held in memory. Files come from the user's
// local clone through the runner when the run has a RunnerContext (writes are staged, never
// written to the clone), else read-only from the GitHub contents API. When a Run is given,
// core events are forwarded to it and the local executor becomes the browser relay.

import { buildCore, createMemoryTokenStore, createNotifier } from '@reprise/core';
import type { CoreServices } from '@reprise/core';
import { createGitHubFileSystem } from './github-fs';
import { RelayExecutor } from './relay-executor';
import { createRunnerWorkspace } from './runner-workspace';
import type { RunnerContext } from './repo-context';
import type { Run } from './runs';
import type { MockWorld } from './mock';

export interface CoreRequest {
  token: string;
  repo: string;
  run?: Run;
  /** The paired runner for this run (acknowledge, check). */
  runner?: RunnerContext;
}

export type CoreFactory = (req: CoreRequest) => CoreServices;

function attachRun(core: CoreServices, run: Run, relayTimeoutMs: number, runner?: RunnerContext): CoreServices {
  core.notifier.onEvent((event) => run.emit({ type: 'core', event }));
  // Executors are read lazily by the pipeline, so swapping after construction is safe.
  core.executors.local = new RelayExecutor(run, relayTimeoutMs, { runner });
  return core;
}

export function realCoreFactory(relayTimeoutMs: number): CoreFactory {
  return ({ token, repo, run, runner }) => {
    const core = buildCore({
      fileSystem: runner ? createRunnerWorkspace(runner) : createGitHubFileSystem({ repo, token }),
      tokenStore: createMemoryTokenStore(token),
      notifier: createNotifier(),
    });
    return run ? attachRun(core, run, relayTimeoutMs, runner) : core;
  };
}

export function mockCoreFactory(world: MockWorld, relayTimeoutMs: number): CoreFactory {
  return ({ run, runner }) => {
    const core = world.buildCore();
    return run ? attachRun(core, run, relayTimeoutMs, runner) : core;
  };
}
