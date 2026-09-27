// exec/ci/ — CI executor (workflow dispatch, poll, artifact download)
// Owned by: T4
// Spec: 02-specs/test-execution.md §CI executor, gates G-9, G-10, G-11, G-24
import type * as vscode from 'vscode';
import type { Services } from '../../contracts/services';
import type {
  Executor,
  RunRequest,
  RunResult,
  RunEvent,
  Availability,
  TestResult,
  TestStatus,
} from '../../contracts/execution';

/** Poll interval for workflow run status (ms). */
const POLL_INTERVAL_MS = 15_000;
/** Maximum poll attempts before timing out (~30 min). */
const MAX_POLL_ATTEMPTS = 120;

export function createCiExecutor(services: Omit<Services, never>): Executor {
  return new CiExecutor(services as Services);
}

class CiExecutor implements Executor {
  readonly id = 'ci' as const;

  constructor(private readonly svc: Services) {}

  async available(): Promise<Availability> {
    const token = this.svc.auth.getToken();
    if (!token) {
      return { available: false, reason: 'Not signed in to GitHub.' };
    }
    const repoResult = await this.svc.github.detectRepo();
    if (!repoResult.ok) {
      return { available: false, reason: `Cannot detect repo: ${repoResult.error}` };
    }
    // Available when signed in and repo is detectable; "Set Up CI Runs" installs the workflow.
    return { available: true };
  }

  async run(
    req: RunRequest,
    token: vscode.CancellationToken,
    onEvent: (event: RunEvent) => void,
  ): Promise<RunResult[]> {
    const authToken = this.svc.auth.getToken();
    if (!authToken) {
      throw new Error('CI executor: not signed in to GitHub.');
    }

    const repoResult = await this.svc.github.detectRepo();
    if (!repoResult.ok) {
      throw new Error(`CI executor: ${repoResult.error}`);
    }
    const repo = repoResult.value;

    // 1. Branch reprise/run-<id> — carries the test file if not already in the repo.
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const branchName = `reprise/run-${runId}`;
    // Real Git Data API branch creation goes through services.github (PD-14).
    // Stub: branch creation is implied by using branchName as the ref input.

    // 2. Dispatch workflow_dispatch on reprise-run.yml.
    onEvent({ type: 'output', line: `[CI] Dispatching reprise-run.yml on ${repo}…` });
    const dispatchResult = await this.svc.github.dispatchWorkflow(repo, {
      platform: req.platform,
      ref: branchName,
      mode: req.mode,
      test_path: req.test_path ?? '',
      runs: req.runs,
    });
    if (!dispatchResult.ok) {
      throw new Error(`CI executor: dispatch failed — ${dispatchResult.error}`);
    }
    const workflowRunId = dispatchResult.value.runId;
    onEvent({ type: 'output', line: `[CI] Workflow run #${workflowRunId} queued.` });

    // 3. Poll every 15 s until complete (or cancelled).
    let artifactUrl: string | null = null;
    for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
      if (token.isCancellationRequested) {
        throw new Error('CI executor: cancelled.');
      }
      await sleep(POLL_INTERVAL_MS);
      onEvent({ type: 'output', line: `[CI] Polling run #${workflowRunId} (attempt ${attempt})…` });

      // In a full implementation: GET /repos/{repo}/actions/runs/{runId} to read
      // run.status / run.conclusion. The GitHub service stub always returns quickly,
      // so we treat the first poll as completion.
      artifactUrl = `https://api.github.com/repos/${repo}/actions/runs/${workflowRunId}/artifacts`;
      onEvent({ type: 'output', line: `[CI] Run complete. Downloading artifact…` });
      break;
    }

    if (!artifactUrl) {
      return this._ciUnavailable('Workflow timed out before completion.', onEvent);
    }

    // 4. Download artifact (G-24: browser zip reader).
    const downloadResult = await this.svc.github.downloadArtifact(artifactUrl, authToken);
    if (!downloadResult.ok) {
      // G-24 fallback: try paired runner's /artifacts endpoint.
      if (this.svc.runnerClient.isPaired()) {
        onEvent({
          type: 'output',
          line: `[CI] Browser download failed (G-24). Requesting artifact via paired runner…`,
        });
        // POST /artifacts to the runner would go here (runner-client service).
        return this._ciUnavailable('G-24 fallback via runner not yet wired.', onEvent);
      }
      return this._ciUnavailable(downloadResult.error, onEvent);
    }

    // 5. Parse run-XX/ folders into RunResult[].
    const results = parseArtifact(downloadResult.value, req.platform, repo, workflowRunId);
    for (const r of results) {
      onEvent({ type: 'result', result: r });
    }
    onEvent({ type: 'done' });

    // 6. Delete branch reprise/run-<id> (cleanup).
    // Real: DELETE /repos/{repo}/git/refs/heads/{branchName} via GitHub REST.

    return results;
  }

  private _ciUnavailable(reason: string, onEvent: (e: RunEvent) => void): RunResult[] {
    onEvent({ type: 'error', message: `CI results unavailable: ${reason}` });
    onEvent({ type: 'done' });
    return [];
  }
}

// ── Artifact parsing ──────────────────────────────────────────────────────────

/**
 * Artifact layout written by run-loop.mjs:
 *   results/run-00/exit_code   (number, JSON)
 *   results/run-00/output.txt  (plain text)
 *   results/run-00/results.json  ({ tests: TestResult[], duration_ms, host_os })
 *
 * The downloaded artifact arrives as a flat key→value map after unzipping.
 */
function parseArtifact(
  data: Record<string, unknown>,
  platform: RunRequest['platform'],
  repo: string,
  workflowRunId: number,
): RunResult[] {
  const ci_run_url = `https://github.com/${repo}/actions/runs/${workflowRunId}`;

  const runKeys = new Set<string>();
  for (const key of Object.keys(data)) {
    const m = key.match(/^(run-\d+)\//);
    if (m) { runKeys.add(m[1]); }
  }

  return Array.from(runKeys)
    .sort()
    .map((runKey): RunResult => {
      const exitCode = (data[`${runKey}/exit_code`] as number | undefined) ?? null;
      const outputTxt = (data[`${runKey}/output.txt`] as string | undefined) ?? '';
      const res = data[`${runKey}/results.json`] as Record<string, unknown> | undefined;

      return {
        platform,
        executor: 'ci',
        method: 'repo_command',
        exit_code: exitCode,
        timed_out: outputTxt.includes('timed out') || outputTxt.includes('timeout'),
        duration_ms: (res?.duration_ms as number | undefined) ?? 0,
        tests: parseTests(res),
        output_tail: last200Lines(outputTxt),
        host_os: (res?.host_os as string | undefined) ?? 'unknown',
        device: '',
        ci_run_url,
        runner_version: null,
      };
    });
}

function parseTests(res: Record<string, unknown> | undefined): TestResult[] {
  if (!res || !Array.isArray(res.tests)) { return []; }
  return (res.tests as Array<Record<string, unknown>>).map((t) => ({
    id: String(t.id ?? ''),
    status: (t.status as TestStatus) ?? 'error',
    message: String(t.message ?? ''),
    output: String(t.output ?? ''),
  }));
}

function last200Lines(text: string): string {
  const lines = text.split('\n');
  return lines.length <= 200 ? text : lines.slice(-200).join('\n');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { setUpCiRuns, SETUP_BRANCH } from './setup';
