// security/index.ts — SecurityService factory
// Owned by: T3
// Spec: 02-specs/security.md

import type { Services, SecurityService } from '../contracts/services';
import {
  redact as redactFn,
  recordApproval as recordApprovalFn,
  isApproved as isApprovedFn,
  isTrustedUrl as isTrustedUrlFn,
} from './security';

class SecurityServiceImpl implements SecurityService {
  /** Approvals scoped to this instance (not module-level). */
  private approved = new Map<string, string>();

  redact(text: string): string {
    return redactFn(text);
  }

  recordApproval(path: string, sha256: string): void {
    this.approved.set(path, sha256);
    recordApprovalFn(path, sha256);
  }

  isApproved(path: string, sha256: string): boolean {
    // Check instance map first (fresh per pipeline run), then module-level
    if (this.approved.get(path) === sha256) return true;
    return isApprovedFn(path, sha256);
  }

  isTrustedUrl(url: string): boolean {
    return isTrustedUrlFn(url);
  }
}

export function createSecurity(_services: Omit<Services, 'security'>): SecurityService {
  return new SecurityServiceImpl();
}

// Re-export pure functions for direct use in pipeline
export * from './security';
