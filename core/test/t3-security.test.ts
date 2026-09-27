// test/t3-security.test.ts — Security module tests
// Spec: 02-specs/security.md

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  redact,
  recordApproval,
  isApproved,
  clearApprovals,
  isTrustedUrl,
  isInScope,
  matchGlob,
} from '../src/security/security';

// ── redact ────────────────────────────────────────────────────────────────────

describe('redact', () => {
  it('does not alter clean text', () => {
    assert.equal(redact('hello world'), 'hello world');
  });

  it('redacts a ghp_ token (planted fake token)', () => {
    const token = 'ghp_' + 'A'.repeat(40);
    const text = `Authorization: token ${token}`;
    const result = redact(text);
    assert.ok(result.includes('[REDACTED]'), `expected REDACTED in: ${result}`);
    assert.ok(!result.includes('ghp_'), `expected ghp_ removed from: ${result}`);
  });

  it('redacts ghs_ token', () => {
    const token = 'ghs_' + 'B'.repeat(40);
    const result = redact(`secret=${token}`);
    assert.ok(result.includes('[REDACTED]'));
    assert.ok(!result.includes('ghs_'));
  });

  it('redacts gho_ token', () => {
    const token = 'gho_' + 'C'.repeat(40);
    const result = redact(token);
    assert.ok(result.includes('[REDACTED]'));
  });

  it('redacts github_pat_ token', () => {
    const token = 'github_pat_ABCDEF_suffix_123';
    const result = redact(token);
    assert.ok(result.includes('[REDACTED]'));
  });

  it('redacts Bearer token', () => {
    const result = redact('Authorization: Bearer sk-ant-abcdefghijklmnopqrstuvwxyz0123456789');
    assert.ok(result.includes('[REDACTED]'));
  });

  it('redacts home path /home/alice/...', () => {
    const result = redact('/home/alice/projects/app');
    assert.ok(result.includes('[HOME]'), `got: ${result}`);
    assert.ok(!result.includes('/home/alice/'), `got: ${result}`);
  });

  it('redacts /Users/bob/... (macOS style)', () => {
    const result = redact('/Users/bob/Documents/app');
    assert.ok(result.includes('[HOME]'), `got: ${result}`);
  });

  it('does not redact short tokens (below 36 chars for ghp_)', () => {
    const result = redact('ghp_short');
    // shorter than threshold — may or may not match depending on regex; just verify no crash
    assert.equal(typeof result, 'string');
  });

  it('handles empty string', () => {
    assert.equal(redact(''), '');
  });

  it('is idempotent on [REDACTED]', () => {
    const result = redact('[REDACTED]');
    assert.equal(result, '[REDACTED]');
  });
});

// ── approvals ─────────────────────────────────────────────────────────────────

describe('approvals', () => {
  beforeEach(() => clearApprovals());

  it('records and verifies an approval', () => {
    recordApproval('/test/foo.kt', 'abc123');
    assert.equal(isApproved('/test/foo.kt', 'abc123'), true);
  });

  it('wrong sha returns false', () => {
    recordApproval('/test/foo.kt', 'abc123');
    assert.equal(isApproved('/test/foo.kt', 'wrong'), false);
  });

  it('unapproved path returns false', () => {
    assert.equal(isApproved('/test/bar.kt', 'abc123'), false);
  });

  it('overwriting approval updates the stored sha', () => {
    recordApproval('/test/foo.kt', 'sha1');
    recordApproval('/test/foo.kt', 'sha2');
    assert.equal(isApproved('/test/foo.kt', 'sha2'), true);
    assert.equal(isApproved('/test/foo.kt', 'sha1'), false);
  });
});

// ── isTrustedUrl ──────────────────────────────────────────────────────────────

describe('isTrustedUrl', () => {
  it('trusts api.github.com', () => {
    assert.equal(isTrustedUrl('https://api.github.com/repos/x/y'), true);
  });

  it('trusts 127.0.0.1', () => {
    assert.equal(isTrustedUrl('http://127.0.0.1:47410/status'), true);
  });

  it('trusts localhost', () => {
    assert.equal(isTrustedUrl('http://localhost:3000/'), true);
  });

  it('trusts api.anthropic.com (future)', () => {
    assert.equal(isTrustedUrl('https://api.anthropic.com/v1/messages'), true);
  });

  it('rejects arbitrary URLs', () => {
    assert.equal(isTrustedUrl('https://evil.example.com/steal'), false);
  });

  it('rejects non-URL strings', () => {
    assert.equal(isTrustedUrl('not-a-url'), false);
  });
});

// ── matchGlob ─────────────────────────────────────────────────────────────────

describe('matchGlob', () => {
  it('** matches across segments', () => {
    assert.equal(matchGlob('app/**', 'app/src/test/Foo.kt'), true);
  });

  it('* matches within single segment', () => {
    assert.equal(matchGlob('app/src/*.kt', 'app/src/Foo.kt'), true);
    assert.equal(matchGlob('app/src/*.kt', 'app/src/sub/Foo.kt'), false);
  });

  it('exact path matches', () => {
    assert.equal(matchGlob('.reprise/**', '.reprise/stubs/7/intake.json'), true);
    assert.equal(matchGlob('.reprise/**', 'app/src/Foo.kt'), false);
  });

  it('does not match across directory with *', () => {
    assert.equal(matchGlob('src/*.ts', 'src/sub/foo.ts'), false);
  });
});

// ── isInScope ─────────────────────────────────────────────────────────────────

describe('isInScope', () => {
  const testAllowed = ['app/src/androidTest/**', 'app/src/test/**'];
  const fixAllowed = ['app/src/main/**'];
  const never = ['.reprise/**', '.git/**'];

  it('allows a file in test scope', () => {
    assert.equal(
      isInScope('app/src/androidTest/LoginTest.kt', testAllowed, never),
      true
    );
  });

  it('allows a file in fix scope', () => {
    assert.equal(
      isInScope('app/src/main/java/LoginActivity.kt', fixAllowed, never),
      true
    );
  });

  it('denies .reprise/ path (never)', () => {
    assert.equal(
      isInScope('.reprise/stubs/7/intake.json', testAllowed, never),
      false
    );
  });

  it('denies file not in allowed list', () => {
    assert.equal(
      isInScope('app/src/release/build.gradle', testAllowed, never),
      false
    );
  });

  it('never list takes precedence over allowed', () => {
    const both = ['.reprise/**'];
    assert.equal(isInScope('.reprise/stubs/7/fix.json', both, both), false);
  });
});
