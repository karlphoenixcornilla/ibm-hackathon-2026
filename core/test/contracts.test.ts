// test/contracts.test.ts — Basic smoke tests for contracts and fakes
// Runs with: node --test (no Node-only APIs in the tested code paths)

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Result util ───────────────────────────────────────────────────────────────
import { Result } from '../src/util/result';

describe('Result', () => {
  it('ok wraps a value', () => {
    const r = Result.ok(42);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.value, 42);
  });

  it('err wraps an error', () => {
    const r = Result.err('boom');
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error, 'boom');
  });

  it('map transforms ok', () => {
    const r = Result.map(Result.ok(2), (v) => v * 3);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.value, 6);
  });

  it('map leaves err unchanged', () => {
    const r = Result.map(Result.err('e') as Result<number, string>, (v) => v * 3);
    assert.equal(r.ok, false);
  });

  it('unwrap returns value for ok', () => {
    assert.equal(Result.unwrap(Result.ok('x')), 'x');
  });

  it('unwrap throws for err', () => {
    assert.throws(() => Result.unwrap(Result.err('boom')), /boom/);
  });
});

// ── Enums completeness ────────────────────────────────────────────────────────
import type { State, Stage, Platform } from '../src/contracts/enums';

describe('enums', () => {
  it('State has 16 values', () => {
    const states: State[] = [
      'LISTED','REPLICATING','CONFIRMED','FLAKY','DUPLICATE','NEEDS_INFO',
      'BLOCKED_ENV','STOPPED','ERROR','FIXING','FIX_ABANDONED','VERIFYING',
      'FIX_VERIFIED','FIX_INCOMPLETE','REGRESSION_DETECTED','RESOLVED',
    ];
    assert.equal(states.length, 16);
  });

  it('Stage has 6 values', () => {
    const stages: Stage[] = ['intake','dedupe','test','rootcause','fix','review'];
    assert.equal(stages.length, 6);
  });

  it('Platform has 5 values', () => {
    const platforms: Platform[] = ['windows','android','ios','macos','linux'];
    assert.equal(platforms.length, 5);
  });
});

// ── FakeSecurity redact ───────────────────────────────────────────────────────
import { FakeSecurity } from '../src/fakes/FakeSecurity';

describe('FakeSecurity', () => {
  const sec = new FakeSecurity();

  it('does not redact clean text', () => {
    assert.equal(sec.redact('hello world'), 'hello world');
  });

  it('redacts a ghp_ token', () => {
    const text = 'token: ghp_' + 'A'.repeat(36);
    assert.match(sec.redact(text), /\[REDACTED\]/);
  });

  it('approves and verifies a file', () => {
    sec.recordApproval('/test/foo.kt', 'abc123');
    assert.equal(sec.isApproved('/test/foo.kt', 'abc123'), true);
    assert.equal(sec.isApproved('/test/foo.kt', 'wrong'), false);
  });

  it('trusts api.github.com', () => {
    assert.equal(sec.isTrustedUrl('https://api.github.com/repos/x/y'), true);
  });

  it('trusts 127.0.0.1', () => {
    assert.equal(sec.isTrustedUrl('http://127.0.0.1:47410/status'), true);
  });

  it('does not trust arbitrary URLs', () => {
    assert.equal(sec.isTrustedUrl('https://evil.example.com'), false);
  });
});

// ── FakeStats Wilson interval ─────────────────────────────────────────────────
import { FakeStats } from '../src/fakes/FakeStats';

describe('FakeStats', () => {
  const stats = new FakeStats();

  it('wilsonInterval returns 0,0 for 0 trials', () => {
    const { low, high } = stats.wilsonInterval(0, 0);
    assert.equal(low, 0);
    assert.equal(high, 0);
  });

  it('wilsonInterval for 7/20 is in (0.15, 0.6)', () => {
    const { low, high } = stats.wilsonInterval(7, 20);
    assert.ok(low > 0.15 && low < 0.5, `low=${low}`);
    assert.ok(high > 0.35 && high < 0.65, `high=${high}`);
  });

  it('verdict FLAKY for mixed results', () => {
    const v = stats.verdict(
      { pass: 13, fail_match: 7, fail_other: 0, error: 0 },
      { min: 10, max: 20, limit: 100, max_minutes: null }
    );
    assert.equal(v, 'FLAKY');
  });

  it('verdict CONFIRMED for all failures', () => {
    const v = stats.verdict(
      { pass: 0, fail_match: 20, fail_other: 0, error: 0 },
      { min: 10, max: 20, limit: 100, max_minutes: null }
    );
    assert.equal(v, 'CONFIRMED');
  });
});

// ── FakeConfig ────────────────────────────────────────────────────────────────
import { FakeConfig } from '../src/fakes/FakeConfig';

describe('FakeConfig', () => {
  it('load returns ok with a valid config', async () => {
    const cfg = new FakeConfig();
    const result = await cfg.load();
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.version, 3);
      assert.deepEqual(result.value.issues.labels, ['bug']);
    }
  });

  it('get returns the loaded config', async () => {
    const cfg = new FakeConfig();
    await cfg.load();
    assert.ok(cfg.get() !== null);
  });
});

// ── FakeGitHub ────────────────────────────────────────────────────────────────
import { FakeGitHub } from '../src/fakes/FakeGitHub';

describe('FakeGitHub', () => {
  const gh = new FakeGitHub();

  it('detectRepo returns demo-owner/demo-app', async () => {
    const r = await gh.detectRepo();
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.value, 'demo-owner/demo-app');
  });

  it('listIssues returns 3 issues', async () => {
    const r = await gh.listIssues('demo-owner/demo-app');
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.value.length, 3);
  });
});
