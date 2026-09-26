// fix/ — fix proposal, diff review, PR creation
// Owned by: T4
// Spec: 02-specs/fix-and-verify.md
import type { Services } from '../contracts/services';

export function createFix(_services: Omit<Services, 'fix'>): import('../contracts/services').FixService {
  throw new Error('Not implemented yet (track T4)');
}
