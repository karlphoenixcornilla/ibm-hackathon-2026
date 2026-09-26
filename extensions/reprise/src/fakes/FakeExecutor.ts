// fakes/FakeExecutor.ts — in-memory fake Executor returning scripted RunResults
// 20 trials, 7 FAIL_MATCH (flaky bug)
import type { Executor, RunRequest, RunResult, RunEvent, Availability } from '../contracts/execution';
import type * as vscode from 'vscode';

const SCRIPTED_RESULTS: RunResult[] = Array.from({ length: 20 }, (_, i) => {
  const isFail = [0, 2, 5, 7, 11, 14, 18].includes(i); // 7 failures
  return {
    platform: 'android',
    executor: 'local',
    method: 'repo_command',
    exit_code: isFail ? 1 : 0,
    timed_out: false,
    duration_ms: 3200 + i * 50,
    tests: [
      {
        id: 'app/src/androidTest/LoginTest.kt::testBiometricLogin',
        status: isFail ? 'failed' : 'passed',
        message: isFail ? 'AssertionError: expected activity to resume but got DESTROYED' : '',
        output: isFail ? 'FAILED: testBiometricLogin' : 'PASSED: testBiometricLogin',
      },
    ],
    output_tail: isFail
      ? 'BUILD FAILED in 3s\nFailed tests: testBiometricLogin'
      : 'BUILD SUCCESSFUL in 3s\n1 test passed',
    host_os: 'darwin',
    device: 'emulator-5554',
    ci_run_url: null,
    runner_version: '0.1.0-fake',
  };
});

export class FakeExecutor implements Executor {
  constructor(public readonly id: 'local' | 'ci') {}

  async available(): Promise<Availability> {
    return { available: true };
  }

  async run(
    _req: RunRequest,
    _token: vscode.CancellationToken,
    onEvent: (event: RunEvent) => void
  ): Promise<RunResult[]> {
    const results: RunResult[] = [];
    for (const result of SCRIPTED_RESULTS) {
      onEvent({ type: 'output', line: `Run ${results.length + 1}: starting` });
      onEvent({ type: 'result', result });
      results.push(result);
    }
    onEvent({ type: 'done' });
    return results;
  }
}
