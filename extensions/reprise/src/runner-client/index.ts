// runner-client/ — pairing, heartbeat, same-repository check and SSE reader
// Owned by: T2
// Spec: 02-specs/local-runner.md §Same repository check, §Stopping

import * as vscode from 'vscode';
import type { Services, RunnerClientService } from '../contracts/services';
import type {
  PairRequest,
  PairResponse,
  StatusResponse,
  ApproveRequest,
  ApproveResponse,
  RunsRequest,
  RunsResponse,
  RunnerEvent,
} from '../contracts/runner-api';
import type { Result } from '../util/result';
import { Result as R } from '../util/result';

const RUNNER_HOST = 'http://127.0.0.1';
const DEFAULT_RUNNER_PORT = 47410;
// The runner falls back to the next 9 ports when its port is busy (runner/src/server.mjs findPort)
const RUNNER_PORT_SPAN = 10;
const HEARTBEAT_INTERVAL_MS = 30_000; // 30 s per spec
const HEARTBEAT_MISS_LIMIT = 2;

/**
 * Create the RunnerClientService.
 * Services is used for views (status bar, messages) and workspace (repo check).
 */
export function createRunnerClient(
  services: Omit<Services, 'runnerClient'>
): RunnerClientService {
  return new RunnerClient(services);
}

class RunnerClient implements RunnerClientService {
  private sessionToken: string | null = null;
  private baseUrl = `${RUNNER_HOST}:${DEFAULT_RUNNER_PORT}`;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private missedHeartbeats = 0;
  private _paired = false;

  private emitter = new vscode.EventEmitter<{ paired: boolean }>();
  readonly onDidChangePairing: vscode.Event<{ paired: boolean }> = this.emitter.event;

  constructor(private readonly services: Omit<Services, 'runnerClient'>) {}

  // ── RunnerClientService ────────────────────────────────────────────────────

  async pair(code: string): Promise<Result<PairResponse, string>> {
    // Probe 47410–47419 in order; use the configured port as the start if set.
    // Fix for issue #19: was hardcoded to 47410 and never probed fallback ports.
    const startPort = vscode.workspace
      .getConfiguration('reprise')
      .get<number>('runnerPort', RUNNER_PORT_START);
    const endPort = startPort + (RUNNER_PORT_END - RUNNER_PORT_START);

    const body: PairRequest = { code };
    const start = vscode.workspace.getConfiguration('reprise').get<number>('runnerPort', DEFAULT_RUNNER_PORT);
    const ports = Array.from({ length: RUNNER_PORT_SPAN }, (_, i) => start + i);

    // Use the first port where a runner answers. A network error means nothing is
    // listening there, or a runner that does not allow this page's origin (its CORS
    // preflight fails), so try the next port. Any HTTP answer, including a wrong
    // code, comes from the runner to use, so stop there.
    let pairResp: PairResponse | null = null;
    for (const port of ports) {
      const baseUrl = `${RUNNER_HOST}:${port}`;
      let response: Response;
      try {
        response = await fetch(`${baseUrl}/pair`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } catch {
        continue;
      }
      if (!response.ok) return R.err(await errorMessage(response));
      this.baseUrl = baseUrl;
      pairResp = await response.json() as PairResponse;
      break;
    }

    if (!pairResp) {
      return R.err(
        `No Reprise Runner accepted this page on 127.0.0.1 ports ${ports[0]}–${ports[ports.length - 1]}. ` +
          "Check the runner is running and that its \"Allowed origins\" line lists this page's origin " +
          '(otherwise restart it with --allow-origin <origin>).'
      );
    }

    this.sessionToken = pairResp.session;
    this._paired = true;
    this.emitter.fire({ paired: true });

        // Start heartbeat
        this.startHeartbeat();

        return R.ok(pairResp);
      }

      // Only stop scanning on a real runner error (wrong code, locked),
      // not on connection refused (port not in use).
      const isConnectionRefused =
        res.error.includes('ECONNREFUSED') ||
        res.error.includes('fetch') ||
        res.error.includes('Failed to fetch') ||
        res.error.includes('network');
      if (!isConnectionRefused) {
        // Runner answered but refused — propagate that error immediately.
        return R.err(res.error);
      }

      lastError = res.error;
    }

    return R.err(lastError);
  }

  async disconnect(): Promise<void> {
    this.stopHeartbeat();
    this.sessionToken = null;
    this.baseUrl = null;
    this._paired = false;
    this.emitter.fire({ paired: false });
    this.services.views.setStatusBar('Reprise');
  }

  async getStatus(): Promise<Result<StatusResponse | null, string>> {
    if (!this._paired) return R.ok(null);
    return this.fetchRunner<StatusResponse>('/status', { method: 'GET' });
  }

  isPaired(): boolean {
    return this._paired;
  }

  // ── Internal methods ───────────────────────────────────────────────────────

  /**
   * POST /approve after the IDE writes and approves a file.
   */
  async approve(path: string, sha256: string): Promise<Result<ApproveResponse, string>> {
    return this.fetchRunner<ApproveResponse>('/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, sha256 } satisfies ApproveRequest),
    });
  }

  /**
   * POST /runs and returns the run_id.
   */
  async startRun(request: RunsRequest): Promise<Result<RunsResponse, string>> {
    return this.fetchRunner<RunsResponse>('/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
  }

  /**
   * Open an SSE stream for GET /runs/<id>/events.
   * Calls onEvent for each parsed event. Returns a teardown function.
   */
  openEventStream(
    runId: string,
    onEvent: (event: RunnerEvent) => void
  ): () => void {
    if (!this.sessionToken) {
      onEvent({ type: 'error', message: 'Not paired' });
      return () => {};
    }

    const url = `${this.baseUrl}/runs/${runId}/events`;
    const controller = new AbortController();

    // Use fetch-based SSE (available in Node ≥22 / browser)
    (async () => {
      try {
        const response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${this.sessionToken}`,
            Accept: 'text/event-stream',
          },
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          onEvent({ type: 'error', message: `SSE stream failed: HTTP ${response.status}` });
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // Parse SSE lines
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const event = JSON.parse(line.slice(6)) as RunnerEvent;
                onEvent(event);
              } catch { /* malformed */ }
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          onEvent({ type: 'error', message: (err as Error).message });
        }
      }
    })();

    return () => controller.abort();
  }

  /**
   * DELETE /runs/<id> — kill a running test.
   */
  async cancelRun(runId: string): Promise<void> {
    await this.fetchRunner(`/runs/${runId}`, { method: 'DELETE' }).catch(() => {});
  }

  // ── Heartbeat ──────────────────────────────────────────────────────────────

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.missedHeartbeats = 0;
    this.heartbeatTimer = setInterval(async () => {
      const res = await this.getStatus();
      if (!res.ok || res.value === null) {
        this.missedHeartbeats++;
        if (this.missedHeartbeats >= HEARTBEAT_MISS_LIMIT) {
          this.services.views.showError(
            'Runner disconnected: missed two consecutive heartbeats.'
          );
          await this.disconnect();
        }
      } else {
        this.missedHeartbeats = 0;
        this.services.views.setStatusBar(`Reprise Runner: connected`);
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // ── Same-repository check (spec §Same repository check) ───────────────────

  private async checkSameRepository(pairResp: PairResponse): Promise<void> {
    const workspaceRemote = await this.detectWorkspaceRemote();
    const workspaceHead = await this.detectWorkspaceHead();

    if (workspaceRemote && pairResp.remote) {
      const normalise = (url: string) =>
        url.replace(/\.git$/, '').replace(/\/$/, '').toLowerCase();
      if (normalise(pairResp.remote) !== normalise(workspaceRemote)) {
        // Remotes differ → refuse
        await this.disconnect();
        this.services.views.showError(
          `Runner is pointed at a different repository (${pairResp.remote}). ` +
            'Pairing refused. Start the runner in the same repository clone.'
        );
        return;
      }
    }

    if (workspaceHead && pairResp.head && pairResp.head !== workspaceHead) {
      // Same remote, different HEAD → warn only
      this.services.views.showInfo(
        "The runner's folder is on a different commit than the opened folder. " +
          'Results may not match the current state of the repository.'
      );
    }

    this.services.views.setStatusBar('Reprise Runner: connected');
  }

  private async detectWorkspaceRemote(): Promise<string | null> {
    try {
      const bytes = await this.services.workspace.readFile('.git/config');
      if (!bytes.ok) return null;
      const text = new TextDecoder().decode(bytes.value);
      const m = text.match(/\[remote "origin"\][^\[]*url\s*=\s*(.+)/);
      return m ? m[1].trim() : null;
    } catch {
      return null;
    }
  }

  private async detectWorkspaceHead(): Promise<string | null> {
    try {
      const bytes = await this.services.workspace.readFile('.git/HEAD');
      if (!bytes.ok) return null;
      const text = new TextDecoder().decode(bytes.value).trim();
      if (text.startsWith('ref: ')) {
        const refPath = text.slice(5).trim(); // e.g. refs/heads/main
        const refBytes = await this.services.workspace.readFile(`.git/${refPath}`);
        if (!refBytes.ok) return null;
        return new TextDecoder().decode(refBytes.value).trim();
      }
      return text; // detached HEAD
    } catch {
      return null;
    }
  }

  // ── Fetch helpers ──────────────────────────────────────────────────────────

  /**
   * Send a request to the already-resolved baseUrl.
   * Requires pair() to have succeeded first.
   */
  private async fetchRunner<T>(
    path: string,
    options: {
      method: string;
      headers?: Record<string, string>;
      body?: string;
      requiresAuth?: boolean;
    }
  ): Promise<Result<T, string>> {
    if (!this.baseUrl) {
      return R.err('Not paired: call pair() first');
    }
    return this.fetchRunnerAt<T>(this.baseUrl, path, options);
  }

  /**
   * Send a request to an explicit base URL.
   * Used by pair() during port scanning before baseUrl is set.
   */
  private async fetchRunnerAt<T>(
    baseUrl: string,
    path: string,
    options: {
      method: string;
      headers?: Record<string, string>;
      body?: string;
      requiresAuth?: boolean;
    }
  ): Promise<Result<T, string>> {
    const { method, headers = {}, body, requiresAuth = true } = options;

    if (requiresAuth && this.sessionToken) {
      headers['Authorization'] = `Bearer ${this.sessionToken}`;
    }

    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body,
      });

      if (!response.ok) return R.err(await errorMessage(response));

      const data = await response.json() as T;
      return R.ok(data);
    } catch (err) {
      return R.err((err as Error).message);
    }
  }
}

/** The runner's `{ error }` message, or the HTTP status. */
async function errorMessage(response: Response): Promise<string> {
  try {
    const j = await response.json() as { error?: string };
    if (j.error) return j.error;
  } catch { /**/ }
  return `HTTP ${response.status}`;
}
