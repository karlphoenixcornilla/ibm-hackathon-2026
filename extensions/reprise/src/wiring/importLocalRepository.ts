import type { Services } from '../contracts/services';
import type { StatusResponse } from '../contracts/runner-api';
import type { HostServices } from './buildServices';
import { buildServices } from './buildServices';
import { createRunnerWorkspace } from '../workspace/index';
import type { ConfirmLocalChanges } from '../workspace/index';
import { Result } from '../util/result';

export interface LocalRepositoryOptions extends Omit<HostServices, 'workspace'> {
  pairingCode: string;
  confirmChanges: ConfirmLocalChanges;
  /** Optional GitHub URL/SSH remote to enforce when importing into an existing project. */
  expectedRemote?: string;
}

/** Select a repository by pairing the runner started with --root <local repository>. */
export async function importLocalRepository(options: LocalRepositoryOptions): Promise<Result<{ services: Services; repository: StatusResponse }, string>> {
  const workspace = createRunnerWorkspace(() => services.runnerClient, options.confirmChanges);
  const services = buildServices({ ...options, workspace });
  try {
    const paired = await services.runnerClient.pair(options.pairingCode);
    if (!paired.ok) return paired;
    const status = await services.runnerClient.getStatus();
    if (!status.ok) throw new Error(status.error);
    if (!status.value) throw new Error('Runner disconnected during import');
    const normalise = (remote: string) => remote.replace(/^git@([^:]+):/, 'https://$1/').replace(/\.git\/?$/, '').replace(/\/$/, '');
    if (options.expectedRemote && normalise(options.expectedRemote) !== normalise(status.value.remote)) throw new Error('Runner repository does not match the selected repository');
    const config = await services.config.load();
    if (!config.ok) throw new Error(config.error);
    return Result.ok({ services, repository: status.value });
  } catch (error) {
    await services.runnerClient.disconnect();
    return Result.err(error instanceof Error ? error.message : String(error));
  }
}
