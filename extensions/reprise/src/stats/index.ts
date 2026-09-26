// stats/index.ts — StatsService factory
// Owned by: T3
// Spec: 02-specs/statistics.md

import type { Services, StatsService, TrialCounts, TrialsPolicy } from '../contracts/services';
import type { RunResult } from '../contracts/execution';
import {
  wilsonInterval,
  verdict as computeVerdict,
  classifyTrial as classifyTrialFn,
} from './stats';

class StatsServiceImpl implements StatsService {
  classifyTrial(
    result: RunResult,
    signature: { kind: string; pattern: string }
  ): 'PASS' | 'FAIL_MATCH' | 'FAIL_OTHER' | 'ERROR' {
    // Aggregate failure message from individual test results
    const failMsg = result.tests
      .filter((t) => t.status === 'failed')
      .map((t) => t.message)
      .join('\n');
    return classifyTrialFn(
      result.exit_code,
      result.timed_out,
      failMsg,
      result.output_tail,
      signature
    );
  }

  wilsonInterval(failures: number, trials: number): { low: number; high: number } {
    return wilsonInterval(failures, trials);
  }

  verdict(counts: TrialCounts, _policy: TrialsPolicy): 'CONFIRMED' | 'FLAKY' | 'NEEDS_INFO' {
    return computeVerdict(counts);
  }
}

export function createStats(_services: Omit<Services, 'stats'>): StatsService {
  return new StatsServiceImpl();
}

// Re-export pure functions for direct use by pipeline
export * from './stats';
