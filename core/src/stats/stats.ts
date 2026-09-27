// stats/stats.ts — pure statistical functions (spec: 02-specs/statistics.md)
// Owned by: T3
// No dependencies on VS Code or other modules.

// z value for two-sided 95% confidence interval
export const Z95 = 1.959963984540054;
// α = 0.05
export const ALPHA = 0.05;

// ── §1 Trial classification ────────────────────────────────────────────────────

export type TrialOutcome = 'PASS' | 'FAIL_MATCH' | 'FAIL_OTHER' | 'ERROR';

export interface TrialCounts {
  pass: number;
  fail_match: number;
  fail_other: number;
  error: number;
}

/**
 * Parse a trial-sequence string (e.g. "PPFPPXP") into counts.
 * P = PASS, F = FAIL_MATCH, X = FAIL_OTHER or ERROR (both invalid).
 */
export function parseCounts(sequence: string): TrialCounts {
  let pass = 0, fail_match = 0, fail_other = 0, error = 0;
  for (const ch of sequence) {
    if (ch === 'P') pass++;
    else if (ch === 'F') fail_match++;
    else if (ch === 'X') fail_other++;
    else if (ch === 'E') error++;
  }
  return { pass, fail_match, fail_other, error };
}

/** n = valid trials (P + F). k = failures (F). */
export function validCounts(c: TrialCounts): { n: number; k: number; invalid: number } {
  const n = c.pass + c.fail_match;
  const k = c.fail_match;
  const invalid = c.fail_other + c.error;
  return { n, k, invalid };
}

/**
 * Classify one run result against a signature.
 * Returns the TrialOutcome for that run.
 *
 * @param exitCode  process exit code (0 = passed)
 * @param timedOut  true if the run hit its timeout
 * @param failureMessage  per-test failure message (may be empty)
 * @param outputTail  last N lines of captured output
 * @param sig  { kind, pattern } — JavaScript regex source (or "timeout")
 */
export function classifyTrial(
  exitCode: number | null,
  timedOut: boolean,
  failureMessage: string,
  outputTail: string,
  sig: { kind: string; pattern: string }
): TrialOutcome {
  if (timedOut) {
    // Timeout is a special kind: if signature kind is "timeout" that counts as FAIL_MATCH
    if (sig.kind === 'timeout') return 'FAIL_MATCH';
    return 'ERROR';
  }
  if (exitCode === null) return 'ERROR';
  if (exitCode === 0) return 'PASS';

  // Test failed — check if it matches the signature
  try {
    const re = new RegExp(sig.pattern);
    if (re.test(failureMessage) || re.test(outputTail)) return 'FAIL_MATCH';
  } catch {
    // Invalid regex → can't match
    return 'FAIL_OTHER';
  }
  return 'FAIL_OTHER';
}

// ── §3 Wilson score interval ───────────────────────────────────────────────────

/**
 * Compute the Wilson score 95% confidence interval.
 * @param k  number of failures
 * @param n  number of valid trials
 * Returns { low, high } in [0, 1]. Both 0 when n = 0.
 */
export function wilsonInterval(k: number, n: number): { low: number; high: number } {
  if (n === 0) return { low: 0, high: 0 };
  const z = Z95;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / d;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return {
    low: Math.max(0, centre - margin),
    high: Math.min(1, centre + margin),
  };
}

// ── §4 Upper bound when nothing failed ────────────────────────────────────────

/**
 * One-sided 95% upper bound on failure rate when k = 0 in n trials.
 * Formula: 1 - α^(1/n)
 */
export function zeroFailureUpperBound(n: number): number {
  if (n === 0) return 1;
  return 1 - Math.pow(ALPHA, 1 / n);
}

// ── §2 Verdict from trials ─────────────────────────────────────────────────────

export interface TrialsPolicy {
  min: number;
  max: number;
  limit: number;
  max_minutes: number | null;
}

/**
 * Derive replication verdict from trial counts.
 * k = fail_match (reproductions), n = pass + fail_match (valid).
 */
export function verdict(counts: TrialCounts): 'CONFIRMED' | 'FLAKY' | 'NEEDS_INFO' {
  const { n, k } = validCounts(counts);
  if (n === 0) return 'NEEDS_INFO';
  if (k === n) return 'CONFIRMED';
  if (k > 0) return 'FLAKY';
  return 'NEEDS_INFO';
}

// ── §2a Adaptive trial count ───────────────────────────────────────────────────

export type StoppedBy = 'all_failed_at_min' | 'max_reached' | 'time_budget' | 'user_extended';

/**
 * Check whether an early stop applies after `min` valid runs when every run failed.
 * Call this only once n >= policy.min.
 */
export function shouldEarlyStop(n: number, k: number, policyMin: number): boolean {
  return n >= policyMin && k === n;
}

// ── §5 Runs required to verify ─────────────────────────────────────────────────

const VERIFY_MIN = 3;
const VERIFY_MAX = 200;

/**
 * Compute how many verification runs are needed given the Wilson low bound r.
 * @param r  wilson_low from replication
 * @param minRuns  lower clamp (default 3)
 * @param maxRuns  upper clamp (default 200)
 */
export function runsRequired(
  r: number,
  minRuns = VERIFY_MIN,
  maxRuns = VERIFY_MAX
): { required: number; capped: boolean } {
  let raw: number;
  if (r >= 1) {
    raw = minRuns;
  } else {
    raw = Math.ceil(Math.log(ALPHA) / Math.log(1 - r));
  }
  const required = Math.max(minRuns, Math.min(maxRuns, raw));
  return { required, capped: raw > maxRuns };
}

// ── §6 Claim text ──────────────────────────────────────────────────────────────

/**
 * Build the claim text for a verification comment.
 * @param r  wilson_low (replication rate lower bound)
 * @param required  the clamped runs_required value
 * @param capped  whether raw > maxRuns
 * @param runs  actual runs done (may equal required)
 */
export function claimText(r: number, required: number, capped: boolean, runs: number): string {
  if (!capped) {
    return (
      `If this bug were still present at its replication rate (at least ${formatRate(r)}), ` +
      `the chance of ${required} clean runs would be below 5%.`
    );
  }
  const bound = zeroFailureUpperBound(runs);
  return (
    `${runs} clean runs rule out failure rates above ${formatRate(bound)}. ` +
    `The bug's replication rate may be as low as ${formatRate(r)}, so this is limited evidence. ` +
    `Consider verifying again with a higher run limit.`
  );
}

// ── §7 Rounding and display ────────────────────────────────────────────────────

/**
 * Format a rate (0..1) as a percentage with one decimal: "20.0%".
 */
export function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

/**
 * Format a Wilson interval as "8.1%–41.6%".
 */
export function formatInterval(low: number, high: number): string {
  return `${formatRate(low)}–${formatRate(high)}`;
}

/**
 * NEEDS_INFO upper-bound sentence.
 */
export function needsInfoBoundSentence(n: number): string {
  const bound = zeroFailureUpperBound(n);
  return (
    `The test never failed in ${n} runs, so if this bug exists here it happens in fewer than about ${formatRate(bound)} of runs.`
  );
}
