// Stands in for the Review UI + paired runner: answers a run's relay requests in order.
import type { RunRequest, RunResult } from '@reprise/core';
import type { Run } from '../../src/runs';
import type { RunnerCall, RunnerResponse } from '../../src/api/types';

export interface FakeBrowserHandlers {
  runner?(call: RunnerCall): RunnerResponse | Promise<RunnerResponse>;
  exec?(request: RunRequest): RunResult[] | Promise<RunResult[]>;
}

export interface FakeBrowser {
  /** Every relay request seen, in order. */
  log: Array<{ kind: 'runner'; call: RunnerCall } | { kind: 'exec'; request: RunRequest }>;
  stop(): void;
}

/** Subscribe to the run and settle each relay request with the handler's answer. */
export function answerRelay(run: Run, handlers: FakeBrowserHandlers): FakeBrowser {
  const log: FakeBrowser['log'] = [];
  let queue = Promise.resolve();
  const stop = run.subscribe((e) => {
    if (e.type !== 'runner.request' && e.type !== 'exec.request') { return; }
    // Process strictly in order, like the real bridge.
    queue = queue.then(async () => {
      try {
        if (e.type === 'runner.request') {
          log.push({ kind: 'runner', call: e.call });
          if (!handlers.runner) { throw new Error(`unexpected runner call ${e.call.method} ${e.call.path}`); }
          const res = await handlers.runner(e.call);
          run.settleExec(e.reqId, { ok: true, status: res.status, body: res.body });
        } else {
          log.push({ kind: 'exec', request: e.request });
          if (!handlers.exec) { throw new Error('unexpected exec.request'); }
          run.settleExec(e.reqId, { ok: true, results: await handlers.exec(e.request) });
        }
      } catch (err) {
        run.settleExec(e.reqId, { ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    });
  });
  return { log, stop };
}

/** A RunResult with sensible defaults. */
export function result(partial: Partial<RunResult> = {}): RunResult {
  return {
    platform: 'linux', executor: 'local', method: 'repo_command', exit_code: 0, timed_out: false,
    duration_ms: 1, tests: [], output_tail: '', host_os: 'linux', device: '', ci_run_url: null,
    runner_version: 'test', ...partial,
  };
}
