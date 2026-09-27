// contracts/runner-api.ts — request/response types for every runner endpoint
// Shared by T2's server (runner/) and T2's client (src/runner-client/).
// FROZEN after base-v1. Change only via change request (CR).
// Spec: 02-specs/local-runner.md §API

import type { Platform } from './enums';
import type { RunResult } from './execution';

// ── POST /pair ───────────────────────────────────────────────────────────────

export interface PairRequest {
  code: string;
}

export interface PlatformCapability {
  platform: Platform;
  local_possible: boolean;
  missing: string[];
}

export interface PairResponse {
  session: string;
  runner_version: string;
  root_name: string;
  remote: string;
  head: string;
  host_os: string;
  platforms: PlatformCapability[];
}

// ── GET /status ───────────────────────────────────────────────────────────────

/** Same as PairResponse minus session, plus busy. */
export interface StatusResponse {
  runner_version: string;
  root_name: string;
  remote: string;
  head: string;
  host_os: string;
  platforms: PlatformCapability[];
  busy: boolean;
}

// ── POST /approve ─────────────────────────────────────────────────────────────

export interface ApproveRequest {
  path: string;
  sha256: string;
}

export interface ApproveResponse {
  ok: boolean;
}

// ── POST /overlays ────────────────────────────────────────────────────────────

export interface OverlaysRequest {
  base: string;
  files: Array<{ path: string; content: string }>;
}

export interface OverlaysResponse {
  overlay_id: string;
}

// ── POST /runs ────────────────────────────────────────────────────────────────

export interface RunsRequest {
  platform: Platform;
  mode: 'single' | 'all' | 'lint';
  test_path: string;
  runs: number;
  ref: null | { base: string } | { head: string } | { overlay: string };
}

export interface RunsResponse {
  run_id: string;
}

// ── GET /runs/<id>/events (SSE) ───────────────────────────────────────────────

export type RunnerEvent =
  | { type: 'output'; line: string }
  | { type: 'result'; result: RunResult }
  | { type: 'done' }
  | { type: 'error'; message: string };

// ── DELETE /runs/<id> ─────────────────────────────────────────────────────────

export interface DeleteRunResponse {
  ok: boolean;
}

// ── POST /artifacts ───────────────────────────────────────────────────────────

export interface ArtifactsRequest {
  url: string;
}

/** Results directory contents as JSON (platform folder → run folder → file). */
export type ArtifactsResponse = Record<string, Record<string, unknown>>;

// Local file contents are byte-preserving, never interpreted as commands.
export interface FileResponse { path: string; content: string; encoding: 'base64'; }
export interface WriteFileRequest { path: string; content: string; }
