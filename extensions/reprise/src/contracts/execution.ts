// contracts/execution.ts — TestResult, RunResult, RunContext, Executor, RunRequest
// FROZEN after base-v1. Change only via change request (CR).
// Spec: 02-specs/test-execution.md, 02-specs/local-runner.md §POST /runs

import type * as runtime from './runtime';
import type { Platform, Executor as ExecutorType } from './enums';

export type TestStatus = 'passed' | 'failed' | 'error' | 'skipped';

export interface TestResult {
  /** id = "<file>::<full test name>" */
  id: string;
  status: TestStatus;
  message: string;
  output: string;
}

export interface RunResult {
  platform: Platform;
  executor: ExecutorType;
  method: 'repo_command' | 'driver';
  exit_code: number | null;
  timed_out: boolean;
  duration_ms: number;
  tests: TestResult[];
  /** Last 200 lines, redacted. */
  output_tail: string;
  host_os: string;
  device: string;
  ci_run_url: string | null;
  /** Set by the Reprise Runner; null on CI. */
  runner_version: string | null;
}

export type Availability =
  | { available: true }
  | { available: false; reason: string };

export interface RunRequest {
  platform: Platform;
  mode: 'single' | 'all' | 'lint';
  test_path: string;
  runs: number;
  ref: null | { base: string } | { head: string } | { overlay: string };
}

export interface Executor {
  id: ExecutorType;
  available(): Promise<Availability>;
  run(
    req: RunRequest,
    token: runtime.CancellationToken,
    onEvent: (event: RunEvent) => void
  ): Promise<RunResult[]>;
}

/** Events emitted during a run (mirrors runner SSE stream). */
export type RunEvent =
  | { type: 'output'; line: string }
  | { type: 'result'; result: RunResult }
  | { type: 'done' }
  | { type: 'error'; message: string };
