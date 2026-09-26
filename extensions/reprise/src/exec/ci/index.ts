// exec/ci/ — CI executor (workflow dispatch, poll, artifact download)
// Owned by: T4
// Spec: 02-specs/test-execution.md §CI executor
import type { Services } from '../../contracts/services';

export function createCiExecutor(_services: Omit<Services, never>): import('../../contracts/execution').Executor {
  throw new Error('Not implemented yet (track T4)');
}
