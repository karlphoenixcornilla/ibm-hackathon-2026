// runner-workspace.ts — core's FileSystem for a run on the user's local clone.
// Reads: staged content first, else the runner's GET /file at the run's HEAD.
// Writes: staged in backend memory only; they reach the runner as an overlay.

import type { FileSystem } from '@reprise/core';
import type { RunnerContext } from './repo-context';

export function createRunnerWorkspace(runner: RunnerContext): FileSystem {
  const encoder = new TextEncoder();
  return {
    getRoot: () => `runner:${runner.remote}@${runner.head.slice(0, 12)}`,
    async readFile(path: string): Promise<Uint8Array> {
      const staged = runner.stage.get(path);
      if (staged !== undefined) { return encoder.encode(staged); }
      const file = await runner.relay.readFile(path, runner.head);
      return encoder.encode(file.content);
    },
    async writeFile(path: string, content: Uint8Array): Promise<void> {
      runner.stage.write(path, new TextDecoder().decode(content));
    },
  };
}
