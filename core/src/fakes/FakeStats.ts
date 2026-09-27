// fakes/FakeStats.ts — stub fake StatsService
import type { StatsService, TrialCounts, TrialsPolicy } from '../contracts/services';
import type { RunResult } from '../contracts/execution';

export class FakeStats implements StatsService {
  classifyTrial(
    result: RunResult,
    signature: { kind: string; pattern: string }
  ): 'PASS' | 'FAIL_MATCH' | 'FAIL_OTHER' | 'ERROR' {
    if (result.exit_code === 0) return 'PASS';
    const output = result.output_tail ?? '';
    if (output.includes(signature.pattern)) return 'FAIL_MATCH';
    if (result.timed_out) return 'ERROR';
    return 'FAIL_OTHER';
  }

  wilsonInterval(failures: number, trials: number): { low: number; high: number } {
    if (trials === 0) return { low: 0, high: 0 };
    const p = failures / trials;
    const z = 1.96;
    const n = trials;
    const center = (p + (z * z) / (2 * n)) / (1 + (z * z) / n);
    const margin = (z / (1 + (z * z) / n)) * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
    return { low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
  }

  verdict(counts: TrialCounts, _policy: TrialsPolicy): 'CONFIRMED' | 'FLAKY' | 'NEEDS_INFO' {
    const total = counts.pass + counts.fail_match + counts.fail_other + counts.error;
    if (total === 0) return 'NEEDS_INFO';
    const failRate = counts.fail_match / total;
    if (failRate === 1) return 'CONFIRMED';
    if (failRate > 0) return 'FLAKY';
    return 'NEEDS_INFO';
  }
}
