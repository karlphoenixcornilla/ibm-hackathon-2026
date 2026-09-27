// fakes/FakeSecurity.ts — stub fake SecurityService
import type { SecurityService } from '../contracts/services';

const SECRET_PATTERNS = [
  /ghp_[A-Za-z0-9]{36}/g,
  /ghs_[A-Za-z0-9]{36}/g,
  /gho_[A-Za-z0-9]{36}/g,
  /github_pat_[A-Za-z0-9_]+/g,
];

export class FakeSecurity implements SecurityService {
  private approved = new Map<string, string>(); // path → sha256

  redact(text: string): string {
    let result = text;
    for (const pattern of SECRET_PATTERNS) {
      result = result.replace(pattern, '[REDACTED]');
    }
    return result;
  }

  recordApproval(path: string, sha256: string): void {
    this.approved.set(path, sha256);
  }

  isApproved(path: string, sha256: string): boolean {
    return this.approved.get(path) === sha256;
  }

  isTrustedUrl(url: string): boolean {
    try {
      const u = new URL(url);
      return (
        u.hostname === 'api.github.com' ||
        u.hostname === '127.0.0.1' ||
        u.hostname === 'localhost'
      );
    } catch {
      return false;
    }
  }
}
