// runs.ts — long-running operations (acknowledge / propose / check) and their event streams.
// A Run buffers every RunStreamEvent so a late SSE subscriber sees the full history,
// and holds the relay's pending requests: test runs (exec.request) and other runner
// calls (runner.request) that the browser performs against its paired runner.

import { randomUUID } from 'node:crypto';
import { CancellationTokenSource } from '@reprise/core';
import type { CancellationToken, IssueRecord, RunRequest, RunResult } from '@reprise/core';
import type {
  ExecResult, LocalCheck, Proposal, RunKind, RunnerCall, RunnerResponse, RunState, RunStatus, RunStreamEvent,
} from './api/types';

type Listener = (e: RunStreamEvent) => void;

type RelayKind = 'exec' | 'runner';

interface PendingRelay {
  kind: RelayKind;
  resolve(value: unknown): void;
  reject(err: Error): void;
}

/** What settleExec made of an answer: applied, no such pending request, or the wrong kind of answer. */
export type SettleOutcome = 'ok' | 'unknown' | 'invalid';

export class Run {
  readonly id = randomUUID();
  /** Epoch ms when the run finished, or null while running. */
  finishedAtMs: number | null = null;
  private state: RunState = 'running';
  private readonly startedAt: string;
  private record: IssueRecord | null = null;
  private proposal: Proposal | null = null;
  private check: LocalCheck | null = null;
  private error: string | null = null;
  private readonly buffer: RunStreamEvent[] = [];
  private readonly listeners = new Set<Listener>();
  private readonly subscriberWaiters = new Set<() => void>();
  private readonly pending = new Map<string, PendingRelay>();
  private readonly cts = new CancellationTokenSource();

  constructor(
    readonly sessionId: string,
    readonly kind: RunKind,
    readonly repo: string,
    readonly issue: number,
    private readonly now: () => number,
  ) {
    this.startedAt = new Date(now()).toISOString();
  }

  /** Cancelled when the run is cancelled or finishes; pass it to core calls. */
  get token(): CancellationToken { return this.cts.token; }
  get subscriberCount(): number { return this.listeners.size; }
  get finished(): boolean { return this.state !== 'running'; }

  emit(event: RunStreamEvent): void {
    this.buffer.push(event);
    for (const l of this.listeners) { l(event); }
  }

  /** Replay buffered events, then receive live ones. Returns an unsubscribe function. */
  subscribe(listener: Listener): () => void {
    for (const e of this.buffer) { listener(e); }
    this.listeners.add(listener);
    for (const wake of this.subscriberWaiters) { wake(); }
    this.subscriberWaiters.clear();
    return () => { this.listeners.delete(listener); };
  }

  /**
   * Resolve true once someone is subscribed (immediately if already), or false after
   * timeoutMs. The browser opens the stream only after it has the run id, so core may
   * ask for the relay a moment before anyone is listening.
   */
  waitForSubscriber(timeoutMs: number): Promise<boolean> {
    if (this.listeners.size > 0) { return Promise.resolve(true); }
    return new Promise((resolve) => {
      const wake = () => { clearTimeout(timer); resolve(true); };
      const timer = setTimeout(() => { this.subscriberWaiters.delete(wake); resolve(false); }, timeoutMs);
      this.subscriberWaiters.add(wake);
    });
  }

  succeed(result: { record?: IssueRecord | null; proposal?: Proposal | null; check?: LocalCheck | null }): void {
    if (this.finished) { return; }
    this.record = result.record ?? this.record;
    this.proposal = result.proposal ?? this.proposal;
    this.check = result.check ?? this.check;
    this.finish('succeeded');
  }

  fail(error: string): void {
    if (this.finished) { return; }
    this.error = error;
    this.finish('failed');
  }

  cancel(): void {
    this.cts.cancel();
    for (const [id, p] of this.pending) {
      this.pending.delete(id);
      p.reject(new Error('Run cancelled.'));
    }
  }

  /** Ask the browser to execute a RunRequest on the local runner; resolve with its results. */
  requestExec(request: RunRequest, timeoutMs: number, token?: CancellationToken): Promise<RunResult[]> {
    return this.relay<RunResult[]>('exec', (reqId) => ({ type: 'exec.request', reqId, request }), timeoutMs, token);
  }

  /** Ask the browser to make one call to its paired runner; resolve with the HTTP status and body. */
  requestRunner(call: RunnerCall, timeoutMs: number, token?: CancellationToken): Promise<RunnerResponse> {
    return this.relay<RunnerResponse>('runner', (reqId) => ({ type: 'runner.request', reqId, call }), timeoutMs, token);
  }

  /** Deliver the browser's answer to a relay request. */
  settleExec(reqId: string, result: ExecResult): SettleOutcome {
    const p = this.pending.get(reqId);
    if (!p) { return 'unknown'; }
    let value: unknown;
    if (!result.ok) {
      this.pending.delete(reqId);
      p.reject(new Error(result.error));
      return 'ok';
    } else if (p.kind === 'exec' && 'results' in result) {
      value = result.results;
    } else if (p.kind === 'runner' && 'status' in result) {
      value = { status: result.status, body: result.body } satisfies RunnerResponse;
    } else {
      return 'invalid';
    }
    this.pending.delete(reqId);
    p.resolve(value);
    return 'ok';
  }

  private relay<T>(
    kind: RelayKind,
    makeEvent: (reqId: string) => RunStreamEvent,
    timeoutMs: number,
    token?: CancellationToken,
  ): Promise<T> {
    const reqId = randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(reqId)) {
          cancelSub?.dispose();
          reject(new Error(`Local runner request timed out after ${Math.round(timeoutMs / 1000)}s.`));
        }
      }, timeoutMs);
      const cancelSub = token?.onCancellationRequested(() => {
        const p = this.pending.get(reqId);
        if (p) {
          this.pending.delete(reqId);
          p.reject(new Error('Run cancelled.'));
        }
      });
      const cleanup = () => { clearTimeout(timer); cancelSub?.dispose(); };
      this.pending.set(reqId, {
        kind,
        resolve: (v) => { cleanup(); resolve(v as T); },
        reject: (e) => { cleanup(); reject(e); },
      });
      this.emit(makeEvent(reqId));
    });
  }

  status(): RunStatus {
    return {
      id: this.id,
      kind: this.kind,
      state: this.state,
      repo: this.repo,
      issue: this.issue,
      started_at: this.startedAt,
      finished_at: this.finishedAtMs === null ? null : new Date(this.finishedAtMs).toISOString(),
      record: this.record,
      proposal: this.proposal,
      check: this.check,
      error: this.error,
    };
  }

  private finish(state: RunState): void {
    this.state = state;
    this.finishedAtMs = this.now();
    this.cancel();
    const status = this.status();
    this.emit(state === 'succeeded' ? { type: 'run.done', status } : { type: 'run.failed', status });
  }
}

export interface RunRegistryOptions {
  /** Keep finished runs this long so clients can still read the result. Default 1 h. */
  retainMs?: number;
  now?: () => number;
}

export class RunRegistry {
  private readonly runs = new Map<string, Run>();
  private readonly retainMs: number;
  private readonly now: () => number;

  constructor(opts: RunRegistryOptions = {}) {
    this.retainMs = opts.retainMs ?? 60 * 60 * 1000;
    this.now = opts.now ?? Date.now;
  }

  create(sessionId: string, kind: RunKind, repo: string, issue: number): Run {
    const run = new Run(sessionId, kind, repo, issue, this.now);
    this.runs.set(run.id, run);
    return run;
  }

  /** A run is visible only to the session that started it. */
  get(id: string, sessionId: string): Run | undefined {
    const run = this.runs.get(id);
    return run && run.sessionId === sessionId ? run : undefined;
  }

  sweep(): void {
    const t = this.now();
    for (const [id, run] of this.runs) {
      if (run.finishedAtMs !== null && t - run.finishedAtMs > this.retainMs) { this.runs.delete(id); }
    }
  }
}
