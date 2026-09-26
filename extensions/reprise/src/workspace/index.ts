// workspace/ — file reads/writes through workspace.fs, SHA-256
// Owned by: T1
// Spec: 02-specs/browser-runtime.md
import type { Services } from '../contracts/services';

export function createWorkspace(_services: Omit<Services, 'workspace'>): import('../contracts/services').WorkspaceService {
  throw new Error('Not implemented yet (track T1)');
}
