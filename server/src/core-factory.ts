// core-factory.ts — builds a core container per request/run.
// Real mode: buildCore over the GitHub contents FileSystem with the session's token held in
// memory. When a Run is given, core events are forwarded to it and the local executor is
// replaced by the browser relay.

import { buildCore, createMemoryTokenStore, createNotifier } from '@reprise/core';
import type { CoreServices } from '@reprise/core';
import { createGitHubFileSystem } from './github-fs';
import { RelayExecutor } from './relay-executor';
import type { Run } from './runs';
import type { MockWorld } from './mock';

export interface CoreRequest {
  token: string;
  repo: string;
  run?: Run;
}

export type CoreFactory = (req: CoreRequest) => CoreServices;

function attachRun(core: CoreServices, run: Run, relayTimeoutMs: number): CoreServices {
  core.notifier.onEvent((event) => run.emit({ type: 'core', event }));
  // Executors are read lazily by the pipeline, so swapping after construction is safe.
  core.executors.local = new RelayExecutor(run, relayTimeoutMs);
  return core;
}

export function realCoreFactory(relayTimeoutMs: number): CoreFactory {
  return ({ token, repo, run }) => {
    const core = buildCore({
      fileSystem: createGitHubFileSystem({ repo, token }),
      tokenStore: createMemoryTokenStore(token),
      notifier: createNotifier(),
    });
    return run ? attachRun(core, run, relayTimeoutMs) : core;
  };
}

export function mockCoreFactory(world: MockWorld, relayTimeoutMs: number): CoreFactory {
  return ({ run }) => {
    const core = world.buildCore();
    return run ? attachRun(core, run, relayTimeoutMs) : core;
  };
}
