// exec/local/ — local executor (sends POST /runs to runner, streams results)
// Owned by: T2
// Spec: 02-specs/test-execution.md §Local executor
import type { Services } from '../../contracts/services';

export function createLocalExecutor(_services: Omit<Services, never>): import('../../contracts/execution').Executor {
  throw new Error('Not implemented yet (track T2)');
}
