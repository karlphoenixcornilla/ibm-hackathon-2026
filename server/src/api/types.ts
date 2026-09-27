// api/types.ts — the Reprise app API contract (issue #30).
// Types only: the Review UI (#33) can import or copy this file with no runtime deps.
// The same contract is published as server/openapi.yaml and served at /api/openapi.json.

import type {
  CoreEvent, Diagnosis, GitHubIssue, IssueRecord, RunRequest, RunResult, TrialsPolicy,
} from '@reprise/core';

export type { CoreEvent, Diagnosis, GitHubIssue, IssueRecord, RunRequest, RunResult, TrialsPolicy };

export interface ApiError { error: string }

export interface SessionRequest { token: string }
export interface SessionInfo { login: string }

export interface AcknowledgeRequest { trials?: Partial<TrialsPolicy> }
export interface RunAccepted { runId: string }

export type RunKind = 'acknowledge' | 'propose';
export type RunState = 'running' | 'succeeded' | 'failed';

export interface Proposal {
  /** Where the bug is. */
  locations: Diagnosis['locations'];
  /** Why it happens. */
  root_cause: string;
  fix_direction: string;
  confidence: 'high' | 'medium' | 'low';
  /** The proposed fix as a unified diff. */
  diff: string;
  pr_draft: { title: string; body: string };
}

export interface RunStatus {
  id: string;
  kind: RunKind;
  state: RunState;
  repo: string;
  issue: number;
  started_at: string;
  finished_at: string | null;
  record: IssueRecord | null;
  proposal: Proposal | null;
  error: string | null;
}

/** Events on GET /api/runs/:id/events (each SSE `data:` line is one JSON-encoded event). */
export type RunStreamEvent =
  | { type: 'core'; event: CoreEvent }
  | { type: 'exec.request'; reqId: string; request: RunRequest }
  | { type: 'exec.output'; reqId: string; line: string }
  | { type: 'run.done'; status: RunStatus }
  | { type: 'run.failed'; status: RunStatus };

/** Body of POST /api/runs/:id/exec/:reqId — the browser's answer to an exec.request. */
export type ExecResult =
  | { ok: true; results: RunResult[] }
  | { ok: false; error: string };

export interface PrRequest { diff: string; title: string; body: string; draft: boolean }
export interface PrCreated { number: number; html_url: string }

export interface Health { ok: true; mode: 'real' | 'mock' }
