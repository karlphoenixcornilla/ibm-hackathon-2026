// store/ — issue records on reprise-data branch
// Owned by: T1
// Spec: 02-specs/data-contracts.md §Issue record
import type { Services } from '../contracts/services';

export function createStore(_services: Omit<Services, 'store'>): import('../contracts/services').StoreService {
  throw new Error('Not implemented yet (track T1)');
}
