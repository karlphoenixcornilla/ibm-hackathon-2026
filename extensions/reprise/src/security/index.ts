// security/ — redaction, approvals, trusted-link checks
// Owned by: T3
// Spec: 02-specs/security.md
import type { Services, SecurityService } from '../contracts/services';

export function createSecurity(_services: Omit<Services, 'security'>): SecurityService {
  throw new Error('Not implemented yet (track T3)');
}
