// api/client.ts — a typed browser client for the Reprise app API (for the Review UI, #33).
// No Node dependencies: fetch + EventSource with same-origin cookies.

import type {
  AcknowledgeRequest, ExecResult, GitHubIssue, IssueRecord, PrCreated, PrRequest,
  RunAccepted, RunStatus, RunStreamEvent, SessionInfo,
} from './types';
import { readSse } from './sse';

export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export class RepriseApi {
  constructor(private readonly base = '', private readonly fetchImpl: typeof fetch = (...a) => fetch(...a)) {}

  signIn(token: string) { return this.call<SessionInfo>('POST', '/api/session', { token }); }
  whoAmI() { return this.call<SessionInfo>('GET', '/api/session'); }
  signOut() { return this.call<void>('DELETE', '/api/session'); }

  listIssues(owner: string, repo: string) {
    return this.call<GitHubIssue[]>('GET', `/api/repos/${owner}/${repo}/issues`);
  }
  getRecord(owner: string, repo: string, n: number) {
    return this.call<IssueRecord>('GET', `/api/repos/${owner}/${repo}/issues/${n}/record`);
  }
  acknowledge(owner: string, repo: string, n: number, body: AcknowledgeRequest = {}) {
    return this.call<RunAccepted>('POST', `/api/repos/${owner}/${repo}/issues/${n}/acknowledge`, body);
  }
  propose(owner: string, repo: string, n: number) {
    return this.call<RunAccepted>('POST', `/api/repos/${owner}/${repo}/issues/${n}/propose`);
  }
  createPr(owner: string, repo: string, n: number, body: PrRequest) {
    return this.call<PrCreated>('POST', `/api/repos/${owner}/${repo}/issues/${n}/pr`, body);
  }
  /** Apply a fix on the paired runner and test it there; follow the run with RunnerBridge.attach. */
  check(owner: string, repo: string, n: number, diff: string) {
    return this.call<RunAccepted>('POST', `/api/repos/${owner}/${repo}/issues/${n}/check`, { diff });
  }
  getRun(id: string) { return this.call<RunStatus>('GET', `/api/runs/${id}`); }

  /**
   * Read a run's events with fetch, awaiting `onEvent` for each one before reading the
   * next. Resolves after run.done / run.failed (or when the stream ends).
   */
  async streamRun(id: string, onEvent: (e: RunStreamEvent) => unknown, signal?: AbortSignal): Promise<void> {
    const res = await this.fetchImpl(`${this.base}/api/runs/${id}/events`, {
      credentials: 'same-origin',
      headers: { accept: 'text/event-stream' },
      signal,
    });
    if (!res.ok || !res.body) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new ApiError(res.status, data.error ?? res.statusText);
    }
    await readSse(res.body, async (data) => {
      const e = JSON.parse(data) as RunStreamEvent;
      await onEvent(e);
      return e.type !== 'run.done' && e.type !== 'run.failed';
    });
  }
  sendExecResult(runId: string, reqId: string, result: ExecResult) {
    return this.call<void>('POST', `/api/runs/${runId}/exec/${reqId}`, result);
  }

  /** Follow a run's events (browser only). Returns a function that stops listening. */
  followRun(id: string, onEvent: (e: RunStreamEvent) => void): () => void {
    const es = new EventSource(`${this.base}/api/runs/${id}/events`);
    es.onmessage = (m: MessageEvent<string>) => {
      const e = JSON.parse(m.data) as RunStreamEvent;
      onEvent(e);
      if (e.type === 'run.done' || e.type === 'run.failed') { es.close(); }
    };
    return () => es.close();
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.base}${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 204) { return undefined as T; }
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) { throw new ApiError(res.status, data.error ?? res.statusText); }
    return data as T;
  }
}
