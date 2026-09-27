// security/security.ts — redaction, approvals, trusted-link checks, edit_scope checks
// Owned by: T3
// Spec: 02-specs/security.md

// ── Redaction ─────────────────────────────────────────────────────────────────

/**
 * Patterns to redact from any string before it is stored or shown.
 * Spec: T3 (GitHub token), T4 (provider API keys), security.md redact rules.
 */
const TOKEN_PATTERNS: RegExp[] = [
  /ghp_[A-Za-z0-9]{36,}/g,           // GitHub fine-grained PATs
  /ghs_[A-Za-z0-9]{36,}/g,           // GitHub Actions secrets
  /gho_[A-Za-z0-9]{36,}/g,           // GitHub OAuth tokens
  /github_pat_[A-Za-z0-9_]+/g,       // GitHub PATs (new format)
  /Bearer\s+[A-Za-z0-9\-._~+/]{20,}/g, // Bearer tokens
];

/**
 * Replace any recognised secret patterns and home-path-like strings with [REDACTED].
 */
export function redact(text: string): string {
  let result = text;
  for (const pattern of TOKEN_PATTERNS) {
    // Reset lastIndex to avoid issues with /g flags across calls
    pattern.lastIndex = 0;
    result = result.replace(pattern, '[REDACTED]');
  }
  // Redact home-path prefixes: /home/<word>/ or /Users/<word>/
  result = result.replace(/\/(home|Users)\/[^/\s]+\//g, '/[HOME]/');
  return result;
}

// ── Approvals ─────────────────────────────────────────────────────────────────

/** In-memory map of (path → sha256) approvals. */
const approvals = new Map<string, string>();

/** Record that the user approved this exact file at this SHA-256 (PD-10). */
export function recordApproval(path: string, sha256: string): void {
  approvals.set(path, sha256);
}

/** Return true if (path, sha256) was previously approved. */
export function isApproved(path: string, sha256: string): boolean {
  return approvals.get(path) === sha256;
}

/** Clear all recorded approvals (for test teardown). */
export function clearApprovals(): void {
  approvals.clear();
}

// ── Trusted-link checks ────────────────────────────────────────────────────────

/**
 * Hostnames that Reprise is allowed to contact.
 * Spec: security.md browser rules and T3 / T4 controls.
 */
const TRUSTED_HOSTNAMES = new Set([
  'api.github.com',
  '127.0.0.1',
  'localhost',
  'api.anthropic.com',     // claude (future)
  'generativelanguage.googleapis.com', // gemini (future)
  'api.groq.com',          // groq (future)
]);

/** AWS Lambda Function URLs (the agentic proxy): <id>.lambda-url.<region>.on.aws */
const LAMBDA_URL_HOST = /\.lambda-url\.[a-z0-9-]+\.on\.aws$/;

/** Return true if the URL's host is on the allow-list. */
export function isTrustedUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (TRUSTED_HOSTNAMES.has(u.hostname)) { return true; }
    if (LAMBDA_URL_HOST.test(u.hostname)) { return true; }
    return false;
  } catch {
    return false;
  }
}

// ── edit_scope path checks ─────────────────────────────────────────────────────

/**
 * Return true if `filePath` is inside at least one of the allowed glob patterns.
 * Patterns may use `*` (any single-segment characters) and `**` (any path segment).
 * The `never` list is checked first; a match there always returns false.
 */
export function isInScope(
  filePath: string,
  allowed: string[],
  never: string[]
): boolean {
  // Normalise separators
  const p = filePath.replace(/\\/g, '/');

  // Deny if in never list
  for (const pattern of never) {
    if (matchGlob(pattern, p)) return false;
  }

  // Allow if in allowed list
  for (const pattern of allowed) {
    if (matchGlob(pattern, p)) return true;
  }
  return false;
}

/**
 * Minimal glob matcher: supports `**` and `*`.
 */
export function matchGlob(pattern: string, path: string): boolean {
  const p = pattern.replace(/\\/g, '/');
  // Escape regex metacharacters except * which we handle
  const escaped = p.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const regexSrc = escaped
    .replace(/\*\*/g, '§§')       // placeholder for **
    .replace(/\*/g, '[^/]*')      // * matches within a segment
    .replace(/§§/g, '.*');        // ** matches across segments
  const re = new RegExp(`^${regexSrc}(/.*)?$`);
  return re.test(path);
}
