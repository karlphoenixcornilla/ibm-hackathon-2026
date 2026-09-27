// api/runner-bridge.ts — the browser's side of the local runner (issue #31). Browser-safe.
//
// The deployed backend cannot reach 127.0.0.1 on the user's machine; the page can. The bridge:
//   - pairs with the Reprise Runner (probing ports 47410–47419) and keeps its session in memory,
//   - shows which repository/commit the runner serves and whether it is the one being reviewed,
//   - reads files from the local clone for display,
//   - services a run's relay requests (exec.request / runner.request) one at a time, in order.
//
// Typical use in the Review UI:
//   const bridge = new RunnerBridge();
//   await bridge.pair(code);                        // code from the runner's terminal
//   if (!bridge.sameRepo(owner, repo)) …            // block: wrong clone
//   const { runId } = await api.check(owner, repo, n, diff);
//   const status = await bridge.attach(api, runId, { onOutput: (l) => log(l) });

import type { PairResponse, RunnerEvent, RunRequest, RunResult, RunsResponse, StatusResponse } from '@reprise/core';
import type { RepriseApi } from './client';
import { remoteMatches } from './remote';
import { readSse } from './sse';
import type { ExecResult, RunnerCall, RunnerFile, RunStatus, RunStreamEvent } from './types';

/** Where the runner listens: its preferred port and the nine it falls back to (#19). */
export const RUNNER_PORTS: readonly number[] = Array.from({ length: 10 }, (_, i) => 47410 + i);

export type RunnerErrorCode = 'not_found' | 'wrong_code' | 'locked' | 'not_paired' | 'runner';

export class RunnerError extends Error {
  constructor(readonly code: RunnerErrorCode, message: string) { super(message); }
}

/** The only runner calls the backend may ask for. Everything else is refused. */
const ALLOWED_CALLS: ReadonlyArray<{ method: string; path: RegExp }> = [
  { method: 'GET', path: /^\/status$/ },
  { method: 'GET', path: /^\/file\?/ },
  { method: 'POST', path: /^\/approve$/ },
  { method: 'POST', path: /^\/overlays$/ },
];

export function isAllowedRunnerCall(call: { method: string; path: string }): boolean {
  return ALLOWED_CALLS.some((a) => a.method === call.method && a.path.test(call.path));
}

export interface RunnerBridgeOptions {
  ports?: readonly number[];
  host?: string;
  fetchImpl?: typeof fetch;
}

export interface AttachOptions {
  /** Every event on the run's stream (progress, relay requests, the final status). */
  onEvent?: (e: RunStreamEvent) => void;
  /** Output lines from the local test runs. */
  onOutput?: (line: string) => void;
  signal?: AbortSignal;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const errorOf = (body: unknown) =>
  body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : JSON.stringify(body);

export class RunnerBridge {
  private base: string | null = null;
  private session: string | null = null;
  private info: PairResponse | StatusResponse | null = null;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: RunnerBridgeOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? ((...args) => fetch(...args));
  }

  get paired(): boolean { return this.session !== null; }

  /** What the runner reported last: remote, head, host_os, platforms. */
  get connection(): PairResponse | StatusResponse | null { return this.info; }

  /** Pair with the runner using the 6-digit code it printed. */
  async pair(code: string): Promise<PairResponse> {
    const ports = this.opts.ports ?? RUNNER_PORTS;
    const host = this.opts.host ?? '127.0.0.1';
    for (const port of ports) {
      const base = `http://${host}:${port}`;
      let res: Response;
      try {
        res = await this.fetchImpl(`${base}/pair`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ code }),
        });
      } catch {
        continue; // nothing listening here (or a runner that doesn't allow this site)
      }
      const body = (await res.json().catch(() => null)) as (Partial<PairResponse> & { error?: string }) | null;
      if (res.ok && body?.session) {
        this.base = base;
        this.session = body.session;
        this.info = body as PairResponse;
        return body as PairResponse;
      }
      const error = body?.error ?? '';
      if (/locked/i.test(error)) {
        throw new RunnerError('locked', 'Pairing is locked after too many wrong codes. Restart the runner to get a new code.');
      }
      if (/wrong pairing code/i.test(error)) {
        throw new RunnerError('wrong_code', 'Wrong pairing code. Use the code in the runner\'s terminal; codes expire after 5 minutes.');
      }
      // Something else is on this port: keep looking.
    }
    const site = (globalThis as { location?: { origin?: string } }).location?.origin ?? '<this site>';
    throw new RunnerError('not_found',
      `No Reprise Runner found on ports ${ports[0]}–${ports[ports.length - 1]}. ` +
      `Start it with: node reprise-runner.mjs --root <your clone> --allow-origin ${site}`);
  }

  disconnect(): void {
    this.base = null;
    this.session = null;
    this.info = null;
  }

  async status(): Promise<StatusResponse> {
    const res = await this.request('GET', '/status');
    if (res.status !== 200) { throw new RunnerError('runner', `Runner status: ${errorOf(res.body)}`); }
    this.info = res.body as StatusResponse;
    return this.info;
  }

  /** Is the runner serving this GitHub repository? */
  sameRepo(owner: string, repo: string): boolean {
    return this.info !== null && remoteMatches(this.info.remote, `${owner}/${repo}`);
  }

  /** A tracked file from the local clone (default: at its HEAD), for display. */
  async readFile(path: string, ref?: string): Promise<RunnerFile> {
    const q = new URLSearchParams({ path });
    if (ref) { q.set('ref', ref); }
    const res = await this.request('GET', `/file?${q.toString()}`);
    if (res.status !== 200) { throw new RunnerError('runner', `Cannot read ${path}: ${errorOf(res.body)}`); }
    return res.body as RunnerFile;
  }

  /**
   * Follow a backend run and perform its relay requests on the runner, strictly in order.
   * Resolves with the final RunStatus (or null if the stream ended without one).
   */
  async attach(api: RepriseApi, runId: string, opts: AttachOptions = {}): Promise<RunStatus | null> {
    let final: RunStatus | null = null;
    await api.streamRun(runId, async (e) => {
      opts.onEvent?.(e);
      if (e.type === 'exec.request') {
        await api.sendExecResult(runId, e.reqId, await this.answerExec(e.request, opts.onOutput));
      } else if (e.type === 'runner.request') {
        await api.sendExecResult(runId, e.reqId, await this.answerCall(e.call));
      } else if (e.type === 'run.done' || e.type === 'run.failed') {
        final = e.status;
      }
    }, opts.signal);
    return final;
  }

  private async answerCall(call: RunnerCall): Promise<ExecResult> {
    if (!isAllowedRunnerCall(call)) {
      return { ok: false, error: `Runner call not allowed: ${call.method} ${call.path}` };
    }
    try {
      const res = await this.request(call.method, call.path, 'body' in call ? call.body : undefined);
      return { ok: true, status: res.status, body: res.body };
    } catch (err) {
      return { ok: false, error: message(err) };
    }
  }

  private async answerExec(request: RunRequest, onOutput?: (line: string) => void): Promise<ExecResult> {
    try {
      return { ok: true, results: await this.execute(request, onOutput) };
    } catch (err) {
      return { ok: false, error: message(err) };
    }
  }

  /** POST /runs, then follow the runner's event stream until done. */
  private async execute(request: RunRequest, onOutput?: (line: string) => void): Promise<RunResult[]> {
    const started = await this.request('POST', '/runs', request);
    if (started.status !== 200) { throw new Error(`The runner refused the run: ${errorOf(started.body)}`); }
    const runId = (started.body as RunsResponse).run_id;
    const res = await this.fetchImpl(`${this.requireBase()}/runs/${runId}/events`, { headers: this.authHeaders() });
    if (!res.ok || !res.body) { throw new Error(`Runner events: HTTP ${res.status}`); }
    const results: RunResult[] = [];
    let failure: string | null = null;
    let done = false;
    await readSse(res.body, (data) => {
      const ev = JSON.parse(data) as RunnerEvent;
      if (ev.type === 'result') { results.push(ev.result); }
      else if (ev.type === 'output') { onOutput?.(ev.line); }
      else if (ev.type === 'error') { failure = ev.message; }
      else if (ev.type === 'done') { done = true; return false; }
      return true;
    });
    if (failure) { throw new Error(failure); }
    if (!done) { throw new Error('The runner closed the run stream before it finished.'); }
    return results;
  }

  private async request(method: string, path: string, body?: unknown): Promise<{ status: number; body: unknown }> {
    const res = await this.fetchImpl(`${this.requireBase()}${path}`, {
      method,
      headers: { ...this.authHeaders(), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: unknown = text;
    try { parsed = JSON.parse(text); } catch { /* keep text */ }
    return { status: res.status, body: parsed };
  }

  private requireBase(): string {
    if (!this.base || !this.session) { throw new RunnerError('not_paired', 'Pair with your local runner first.'); }
    return this.base;
  }

  private authHeaders(): Record<string, string> {
    return this.session ? { authorization: `Bearer ${this.session}` } : {};
  }
}
