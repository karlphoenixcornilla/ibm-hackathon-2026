// api/types.ts — the Reprise app API contract (issues #30, #31).
// Types only: the Review UI (#33) can import or copy this file with no runtime deps.
// The same contract is published as server/openapi.yaml and served at /api/openapi.json.

import type {
  ApproveRequest, CoreEvent, Diagnosis, GitHubIssue, IssueRecord, OverlaysRequest, RunRequest,
  RunResult, TrialsPolicy, VerificationRegression,
} from '@reprise/core';

export type {
  ApproveRequest, CoreEvent, Diagnosis, GitHubIssue, IssueRecord, OverlaysRequest, RunRequest,
  RunResult, TrialsPolicy, VerificationRegression,
};

export interface ApiError { error: string }

export interface SessionRequest { token: string }
export interface SessionInfo { login: string }

export interface AcknowledgeRequest { trials?: Partial<TrialsPolicy> }
export interface RunAccepted { runId: string }

export type RunKind = 'acknowledge' | 'propose' | 'check';
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

/** Body of POST /api/repos/:owner/:repo/issues/:n/check — the (possibly edited) fix to try locally. */
export interface CheckRequest { diff: string }

/** Result of applying a fix on a runner worktree and testing it there. */
export interface LocalCheck {
  /** The commit the overlay was applied to (the runner's HEAD). */
  base_sha: string;
  overlay_id: string;
  /** The fix files as applied (the reproduction test is staged separately). */
  files: Array<{ path: string; sha256: string }>;
  repro: { test_file: string; runs: number; failed: number; fixed: boolean };
  /** Suite on base vs. with the fix; null when the platform has no test.all. */
  regression: VerificationRegression | null;
  verdict: 'FIX_VERIFIED' | 'FIX_INCOMPLETE' | 'REGRESSION_DETECTED';
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
  check: LocalCheck | null;
  error: string | null;
}

/**
 * A call the browser makes to its paired runner on the backend's behalf.
 * The browser must refuse anything else.
 */
export type RunnerCall =
  | { method: 'GET'; path: '/status' | `/file?${string}` }
  | { method: 'POST'; path: '/approve'; body: ApproveRequest }
  | { method: 'POST'; path: '/overlays'; body: OverlaysRequest };

/** The runner's HTTP answer to a RunnerCall, whatever its status. */
export interface RunnerResponse { status: number; body: unknown }

/** GET /file on the runner. */
export interface RunnerFile { path: string; ref: string; sha256: string; content: string }

/**
 * Events on GET /api/runs/:id/events (each SSE `data:` line is one JSON-encoded event).
 * The browser must handle exec.request / runner.request one at a time, in order.
 */
export type RunStreamEvent =
  | { type: 'core'; event: CoreEvent }
  | { type: 'exec.request'; reqId: string; request: RunRequest }
  | { type: 'runner.request'; reqId: string; call: RunnerCall }
  | { type: 'exec.output'; reqId: string; line: string }
  | { type: 'run.done'; status: RunStatus }
  | { type: 'run.failed'; status: RunStatus };

/** Body of POST /api/runs/:id/exec/:reqId — the browser's answer to a relay request. */
export type ExecResult =
  | { ok: true; results: RunResult[] }            // answers exec.request
  | { ok: true; status: number; body: unknown }   // answers runner.request
  | { ok: false; error: string };                 // the runner could not be reached

export interface PrRequest { diff: string; title: string; body: string; draft: boolean }
export interface PrCreated { number: number; html_url: string }

export interface Health { ok: true; mode: 'real' | 'mock' }
