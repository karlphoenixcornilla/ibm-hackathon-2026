// runner-client/ — pairing, requests and streaming to the Reprise Runner
// Owned by: T2
// Spec: 02-specs/local-runner.md
import type { Services } from '../contracts/services';

export function createRunnerClient(_services: Omit<Services, 'runnerClient'>): import('../contracts/services').RunnerClientService {
  throw new Error('Not implemented yet (track T2)');
}
