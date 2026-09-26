// stats/ — statistics (Wilson intervals, verdict computation)
// Owned by: T3
// Spec: 02-specs/statistics.md
import type { Services, StatsService } from '../contracts/services';

export function createStats(_services: Omit<Services, 'stats'>): StatsService {
  throw new Error('Not implemented yet (track T3)');
}
