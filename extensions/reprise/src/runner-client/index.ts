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

const RUNNER_BASE_URL = 'http://127.0.0.1:47410';
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
  private baseUrl: string = RUNNER_BASE_URL;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private missedHeartbeats = 0;
  private _paired = false;

  private emitter = new vscode.EventEmitter<{ paired: boolean }>();
  readonly onDidChangePairing: vscode.Event<{ paired: boolean }> = this.emitter.event;

  constructor(private readonly services: Omit<Services, 'runnerClient'>) {}

  // ── RunnerClientService ────────────────────────────────────────────────────

  async pair(code: string): Promise<Result<PairResponse, string>> {
    const body: PairRequest = { code };
    const res = await this.fetchRunner<PairResponse>('/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      requiresAuth: false,
    });

    if (!res.ok) return R.err(res.error);

    const pairResp = res.value;
    this.sessionToken = pairResp.session;
    this._paired = true;
    this.emitter.fire({ paired: true });

    // Same-repository check (spec §Same repository check)
    await this.checkSameRepository(pairResp);

    // Start heartbeat
    this.startHeartbeat();

    return R.ok(pairResp);
  }

  async disconnect(): Promise<void> {
    this.stopHeartbeat();
    this.sessionToken = null;
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

  // ── Fetch helper ───────────────────────────────────────────────────────────

  private async fetchRunner<T>(
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
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body,
      });

      if (!response.ok) {
        let msg = `HTTP ${response.status}`;
        try {
          const j = await response.json() as { error?: string };
          if (j.error) msg = j.error;
        } catch { /**/ }
        return R.err(msg);
      }

      const data = await response.json() as T;
      return R.ok(data);
    } catch (err) {
      return R.err((err as Error).message);
    }
  }
}
