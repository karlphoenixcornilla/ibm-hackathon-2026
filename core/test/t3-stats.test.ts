// test/t3-stats.test.ts — Statistics spec tests (100% branch coverage)
// Spec: 02-specs/statistics.md

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  wilsonInterval,
  zeroFailureUpperBound,
  verdict,
  classifyTrial,
  runsRequired,
  claimText,
  formatRate,
  formatInterval,
  needsInfoBoundSentence,
  parseCounts,
  validCounts,
  shouldEarlyStop,
  Z95,
} from '../src/stats/stats';

// ── §3 Wilson score interval ───────────────────────────────────────────────────

describe('wilsonInterval', () => {
  // Worked examples from statistics.md §3 (n=20, tolerance 4 decimal places)
  const cases: [number, number, number, number][] = [
    [20, 20, 0.8389, 1.0000],
    [19, 20, 0.7639, 0.9911],
    [10, 20, 0.2993, 0.7007],
    [4,  20, 0.0807, 0.4160],
    [1,  20, 0.0089, 0.2361],
    [0,  20, 0.0000, 0.1611],
  ];

  for (const [k, n, expectedLow, expectedHigh] of cases) {
    it(`k=${k} n=${n} → low≈${expectedLow} high≈${expectedHigh}`, () => {
      const { low, high } = wilsonInterval(k, n);
      assert.ok(
        Math.abs(low - expectedLow) < 0.00005,
        `low: expected ${expectedLow}, got ${low.toFixed(6)}`
      );
      assert.ok(
        Math.abs(high - expectedHigh) < 0.00005,
        `high: expected ${expectedHigh}, got ${high.toFixed(6)}`
      );
    });
  }

  it('returns {0, 0} for n=0', () => {
    const r = wilsonInterval(0, 0);
    assert.equal(r.low, 0);
    assert.equal(r.high, 0);
  });

  it('uses Z=1.959963984540054', () => {
    assert.ok(Math.abs(Z95 - 1.959963984540054) < 1e-12);
  });
});

// ── §4 Zero-failure upper bound ────────────────────────────────────────────────

describe('zeroFailureUpperBound', () => {
  // Spec §4 worked examples
  const cases: [number, number][] = [
    [3, 0.6316],
    [20, 0.1391],
    [36, 0.0798],
  ];

  for (const [n, expected] of cases) {
    it(`n=${n} → bound≈${expected}`, () => {
      const bound = zeroFailureUpperBound(n);
      assert.ok(
        Math.abs(bound - expected) < 0.00005,
        `expected ≈${expected}, got ${bound.toFixed(6)}`
      );
    });
  }

  it('returns 1 for n=0', () => {
    assert.equal(zeroFailureUpperBound(0), 1);
  });

  it('matches §2a table row n=10 (≈25.9%)', () => {
    const bound = zeroFailureUpperBound(10);
    assert.ok(Math.abs(bound - 0.2589) < 0.0002, `got ${bound}`);
  });

  it('matches §2a table row n=5 (≈45.1%)', () => {
    const bound = zeroFailureUpperBound(5);
    assert.ok(Math.abs(bound - 0.4511) < 0.001, `got ${bound}`);
  });
});

// ── §2 Verdict ────────────────────────────────────────────────────────────────

describe('verdict', () => {
  it('CONFIRMED when k = n (all failed)', () => {
    assert.equal(verdict({ pass: 0, fail_match: 20, fail_other: 0, error: 0 }), 'CONFIRMED');
  });

  it('FLAKY when 0 < k < n', () => {
    assert.equal(verdict({ pass: 13, fail_match: 7, fail_other: 0, error: 0 }), 'FLAKY');
  });

  it('NEEDS_INFO when k = 0', () => {
    assert.equal(verdict({ pass: 20, fail_match: 0, fail_other: 0, error: 0 }), 'NEEDS_INFO');
  });

  it('NEEDS_INFO when no valid trials at all', () => {
    assert.equal(verdict({ pass: 0, fail_match: 0, fail_other: 3, error: 2 }), 'NEEDS_INFO');
  });

  it('CONFIRMED with min=10 (all 10 failed)', () => {
    assert.equal(verdict({ pass: 0, fail_match: 10, fail_other: 0, error: 0 }), 'CONFIRMED');
  });
});

// ── §1 classifyTrial ──────────────────────────────────────────────────────────

describe('classifyTrial', () => {
  const sig = { kind: 'assertion_message', pattern: 'expected activity to resume but got DESTROYED' };

  it('PASS when exit_code=0', () => {
    assert.equal(classifyTrial(0, false, '', '', sig), 'PASS');
  });

  it('FAIL_MATCH when exit_code=1 and failure message matches pattern', () => {
    const msg = 'AssertionError: expected activity to resume but got DESTROYED';
    assert.equal(classifyTrial(1, false, msg, '', sig), 'FAIL_MATCH');
  });

  it('FAIL_MATCH when pattern matches output_tail (not message)', () => {
    const tail = 'FAIL: expected activity to resume but got DESTROYED';
    assert.equal(classifyTrial(1, false, '', tail, sig), 'FAIL_MATCH');
  });

  it('FAIL_OTHER when exit_code=1 but message does not match', () => {
    assert.equal(classifyTrial(1, false, 'NullPointerException', '', sig), 'FAIL_OTHER');
  });

  it('ERROR when timed_out (and signature kind is not timeout)', () => {
    assert.equal(classifyTrial(null, true, '', '', sig), 'ERROR');
  });

  it('FAIL_MATCH when timed_out and kind=timeout', () => {
    const timeoutSig = { kind: 'timeout', pattern: '' };
    assert.equal(classifyTrial(null, true, '', '', timeoutSig), 'FAIL_MATCH');
  });

  it('ERROR when exit_code is null and not timed_out', () => {
    assert.equal(classifyTrial(null, false, '', '', sig), 'ERROR');
  });

  it('FAIL_OTHER for invalid regex pattern', () => {
    const badSig = { kind: 'assertion_message', pattern: '[invalid' };
    assert.equal(classifyTrial(1, false, 'something', '', badSig), 'FAIL_OTHER');
  });
});

// ── §5 runsRequired ───────────────────────────────────────────────────────────

describe('runsRequired', () => {
  // Worked examples from statistics.md §5
  const cases: [number, number, boolean][] = [
    [0.8389, 3, false],   // 20/20: raw=2, clamped up to 3
    [0.7639, 3, false],   // 19/20: raw=3
    [0.2993, 9, false],   // 10/20: raw=9
    [0.0807, 36, false],  // 4/20: raw=36
    [0.0089, 200, true],  // 1/20: raw=336, capped at 200
  ];

  for (const [r, expected, capped] of cases) {
    it(`r=${r} → ${expected} (capped=${capped})`, () => {
      const result = runsRequired(r);
      assert.equal(result.required, expected, `required mismatch for r=${r}`);
      assert.equal(result.capped, capped, `capped mismatch for r=${r}`);
    });
  }

  it('r >= 1 returns minRuns', () => {
    const { required, capped } = runsRequired(1.0);
    assert.equal(required, 3);
    assert.equal(capped, false);
  });

  it('respects custom min and max', () => {
    const { required } = runsRequired(0.5, 5, 50);
    assert.ok(required >= 5 && required <= 50);
  });

  // §6 check: for 4/20, (1 - 0.0807)^36 < 0.05
  it('§6 check: (1 - 0.0807)^36 < 0.05', () => {
    const prob = Math.pow(1 - 0.0807, 36);
    assert.ok(prob < 0.05, `expected < 0.05, got ${prob}`);
  });
});

// ── §6 claimText ──────────────────────────────────────────────────────────────

describe('claimText', () => {
  it('strong evidence (not capped)', () => {
    const text = claimText(0.2993, 9, false, 9);
    assert.ok(text.includes('29.9%'), `got: ${text}`);
    assert.ok(text.includes('9 clean runs'), `got: ${text}`);
    assert.ok(text.includes('below 5%'), `got: ${text}`);
  });

  it('limited evidence (capped)', () => {
    const text = claimText(0.0089, 200, true, 200);
    assert.ok(text.includes('200 clean runs'), `got: ${text}`);
    assert.ok(text.includes('limited evidence'), `got: ${text}`);
  });
});

// ── §7 formatRate and formatInterval ──────────────────────────────────────────

describe('formatRate', () => {
  it('formats 0.20 as "20.0%"', () => {
    assert.equal(formatRate(0.20), '20.0%');
  });

  it('formats 0.0807 as "8.1%"', () => {
    assert.equal(formatRate(0.0807), '8.1%');
  });

  it('formats 1.0 as "100.0%"', () => {
    assert.equal(formatRate(1.0), '100.0%');
  });
});

describe('formatInterval', () => {
  it('formats low and high with em-dash', () => {
    assert.equal(formatInterval(0.0807, 0.4160), '8.1%–41.6%');
  });
});

// ── parseCounts / validCounts / shouldEarlyStop ───────────────────────────────

describe('parseCounts', () => {
  it('parses PPFPPXEP', () => {
    const c = parseCounts('PPFPPXEP');
    // P,P,F,P,P,X,E,P → 5 pass, 1 fail_match, 1 fail_other, 1 error
    assert.equal(c.pass, 5);
    assert.equal(c.fail_match, 1);
    assert.equal(c.fail_other, 1);
    assert.equal(c.error, 1);
  });

  it('empty string gives zeros', () => {
    const c = parseCounts('');
    assert.deepEqual(c, { pass: 0, fail_match: 0, fail_other: 0, error: 0 });
  });
});

describe('validCounts', () => {
  it('n = pass + fail_match, k = fail_match', () => {
    const r = validCounts({ pass: 3, fail_match: 7, fail_other: 1, error: 0 });
    assert.equal(r.n, 10);
    assert.equal(r.k, 7);
    assert.equal(r.invalid, 1);
  });
});

describe('shouldEarlyStop', () => {
  it('true when n >= min and k = n', () => {
    assert.equal(shouldEarlyStop(10, 10, 10), true);
  });

  it('false when k < n', () => {
    assert.equal(shouldEarlyStop(10, 9, 10), false);
  });

  it('false when n < min', () => {
    assert.equal(shouldEarlyStop(5, 5, 10), false);
  });
});

// ── needsInfoBoundSentence ────────────────────────────────────────────────────

describe('needsInfoBoundSentence', () => {
  it('contains n and bound for n=20', () => {
    const sentence = needsInfoBoundSentence(20);
    assert.ok(sentence.includes('20 runs'), `got: ${sentence}`);
    assert.ok(sentence.includes('13.9%') || sentence.includes('14'), `got: ${sentence}`);
  });
});
