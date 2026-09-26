// verify/ — repro check and regression comparison
// Owned by: T4
// Spec: 02-specs/fix-and-verify.md
import type { Services } from '../contracts/services';

export function createVerify(_services: Omit<Services, 'verify'>): import('../contracts/services').VerifyService {
  throw new Error('Not implemented yet (track T4)');
}
