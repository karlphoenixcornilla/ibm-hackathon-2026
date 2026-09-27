// runner-relay.ts — typed calls to the user's runner, made by the browser on our behalf
// (runner.request events; see runs.ts). The backend never talks to 127.0.0.1 itself.

import type { ApproveResponse, OverlaysResponse, StatusResponse } from '@reprise/core';
import type { RunnerCall, RunnerFile } from './api/types';
import type { Run } from './runs';

/** The runner answered with a non-2xx status. */
export class RunnerCallError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export class RunnerRelay {
  constructor(private readonly run: Run, private readonly timeoutMs: number) {}

  status(): Promise<StatusResponse> {
    return this.call<StatusResponse>({ method: 'GET', path: '/status' });
  }

  /** A git-tracked file at `ref` (default: the runner's HEAD). */
  readFile(path: string, ref?: string): Promise<RunnerFile> {
    const q = new URLSearchParams({ path });
    if (ref) { q.set('ref', ref); }
    return this.call<RunnerFile>({ method: 'GET', path: `/file?${q.toString()}` });
  }

  approve(path: string, sha256: string): Promise<ApproveResponse> {
    return this.call<ApproveResponse>({ method: 'POST', path: '/approve', body: { path, sha256 } });
  }

  createOverlay(base: string, files: Array<{ path: string; content: string }>): Promise<OverlaysResponse> {
    return this.call<OverlaysResponse>({ method: 'POST', path: '/overlays', body: { base, files } });
  }

  private async call<T>(call: RunnerCall): Promise<T> {
    const res = await this.run.requestRunner(call, this.timeoutMs, this.run.token);
    if (res.status < 200 || res.status >= 300) {
      const body = res.body as { error?: unknown } | null;
      const detail = body && typeof body === 'object' && 'error' in body ? String(body.error) : `HTTP ${res.status}`;
      throw new RunnerCallError(res.status, `Runner ${call.method} ${call.path.split('?')[0]}: ${detail}`);
    }
    return res.body as T;
  }
}
