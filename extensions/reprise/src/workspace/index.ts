// A workspace backed by the paired runner, with no filesystem access in the UI.
import type { WorkspaceService, RunnerClientService, Services } from '../contracts/services';
import type { OverlaysRequest } from '../contracts/runner-api';
import type { RunRequest, RunResult, RunEvent } from '../contracts/execution';
import type { CancellationToken } from '../contracts/runtime';
import { Result } from '../util/result';
import { sha256 } from '../util/sha256';

export type ConfirmLocalChanges = (files: ReadonlyArray<{ path: string; content: Uint8Array }>) => Promise<boolean>;

export function createRunnerWorkspace(client: () => RunnerClientService, confirm: ConfirmLocalChanges): WorkspaceService {
  return {
    async readFile(path) {
      const runner = client();
      if (!runner.readFile) return Result.err('Runner does not support local file access');
      const result = await runner.readFile(path);
      if (!result.ok) return result;
      try { return Result.ok(Uint8Array.from(atob(result.value.content), c => c.charCodeAt(0))); }
      catch { return Result.err('Runner returned invalid file data'); }
    },
    async writeFile(path, content) {
      const runner = client();
      if (!runner.approve || !runner.writeFile) return Result.err('Runner does not support approved local writes');
      const bytes = new Uint8Array(content);
      if (!await confirm([{ path, content: new Uint8Array(bytes) }])) return Result.err('Local change cancelled');
      const approval = await runner.approve(path, await sha256(bytes));
      if (!approval.ok) return approval;
      const encoded = btoa(Array.from(bytes, b => String.fromCharCode(b)).join(''));
      const written = await runner.writeFile({ path, content: encoded });
      return written.ok ? Result.ok(undefined) : written;
    },
    sha256,
    getRootUri: () => client().isPaired() ? 'runner:/' : null,
    getRepository: () => client().getStatus(),
  };
}

/** Approve and verify proposed contents in an isolated runner worktree.
 * Uses the existing Executor contract; never publishes, commits, or alters the source clone.
 */
export async function runLocalOverlay(
  services: Services,
  overlay: OverlaysRequest,
  request: Omit<RunRequest, 'ref'>,
  token: CancellationToken,
  onEvent: (event: RunEvent) => void,
  confirm: ConfirmLocalChanges,
): Promise<RunResult[]> {
  if (token.isCancellationRequested) throw new Error('Run cancelled');
  const runner = services.runnerClient;
  if (!runner.isPaired() || !runner.approve || !runner.createOverlay) throw new Error('A paired runner with overlay support is required');
  const proposal = { base: overlay.base, files: overlay.files.map(file => ({ ...file })) };
  // Carry the current reproduction test into the detached worktree, including
  // approved tests that have not been committed. Fixes cannot replace that test.
  if (request.mode === 'single') {
    if (proposal.files.some(file => file.path === request.test_path)) throw new Error('A fix overlay cannot modify the reproduction test');
    const test = await services.workspace.readFile(request.test_path);
    if (!test.ok) throw new Error(test.error);
    proposal.files.push({ path: request.test_path, content: new TextDecoder('utf-8', { fatal: true }).decode(test.value) });
  }
  const files = proposal.files.map(file => ({ path: file.path, content: new TextEncoder().encode(file.content) }));
  if (!await confirm(files.map(file => ({ path: file.path, content: new Uint8Array(file.content) })))) throw new Error('Local change cancelled');
  for (const file of files) {
    if (token.isCancellationRequested) throw new Error('Run cancelled');
    const approved = await runner.approve(file.path, await sha256(file.content));
    if (!approved.ok) throw new Error(approved.error);
  }
  const created = await runner.createOverlay(proposal);
  if (!created.ok) throw new Error(created.error);
  return services.executors.local.run({ ...request, ref: { overlay: created.value.overlay_id } }, token, onEvent);
}
