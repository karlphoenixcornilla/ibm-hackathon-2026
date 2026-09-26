// auth/ — GitHub sign-in: built-in provider (G-7) or token (PD-23)
// Owned by: T1
// Spec: 02-specs/github-connection.md, ADR-3
import type { Services } from '../contracts/services';

export function createAuth(_services: Omit<Services, 'auth'>): import('../contracts/services').AuthService {
  // T1 replaces this body. Until then the fake is returned via wiring/buildServices.
  throw new Error('Not implemented yet (track T1)');
}
