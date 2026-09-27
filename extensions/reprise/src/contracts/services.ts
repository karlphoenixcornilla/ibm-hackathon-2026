// contracts/services.ts — Services container: the central contract for all tracks.
// Shared contracts. Pivot #29 removes the obsolete editor runtime types.
// Spec: 00-base.md §B3, 01-architecture/architecture.md

import type * as runtime from './runtime';
import type { IssueRecord } from './records';
import type { Provider } from './provider';
import type { Executor, RunResult } from './execution';
import type { PairResponse, StatusResponse, ApproveResponse, RunsRequest, RunsResponse, RunnerEvent, OverlaysRequest, OverlaysResponse, FileResponse, WriteFileRequest } from './runner-api';
import type { Result } from '../util/result';

// ── Config ───────────────────────────────────────────────────────────────────

export interface TrialsPolicy {
  min: number;
  max: number;
  limit: number;
  max_minutes: number | null;
}

export interface RepriseConfig {
  version: number;
  issues: { labels: string[] };
  components: string[];
  defaults: {
    executor: 'local' | 'ci';
    trials: TrialsPolicy & { max_minutes: number | null };
    max_test_attempts: number;
  };
  fix: {
    candidates: number;
    quick_runs: number;
    max_rounds: number;
    candidate_executor: 'auto' | 'ci' | 'local';
    draft_pr: boolean;
    self_review: boolean;
  };
  verify: {
    min_runs: number;
    max_runs: number;
    regression_reruns: number;
  };
  edit_scope: {
    test: string[];
    fix: string[];
    never: string[];
  };
  platforms: Record<string, PlatformConfig>;
}

export interface PlatformConfig {
  shell?: string;
  cwd?: string;
  prereq?: string[];
  build?: string;
  test?: {
    pattern: string;
    single: string;
    all: string;
    report: string;
    report_path: string;
  };
  lint?: string;
  run_timeout_seconds?: number;
  trials?: Partial<TrialsPolicy>;
  driver?: {
    name: string;
    appium_port: number;
    capabilities: Record<string, unknown>;
  };
  device?: string;
  env_remove?: string[];
  env_keep?: string[];
}

export interface ConfigService {
  /** Load (or reload) .reprise.yml from the open workspace folder. */
  load(): Promise<Result<RepriseConfig, string>>;
  /** Return the last successfully loaded config, or null if not yet loaded. */
  get(): RepriseConfig | null;
  /** Return the identifier of the loaded .reprise.yml file, or null. */
  getUri(): string | null;
  /** Invalidate the cache so the next load() re-reads from disk. */
  invalidate(): void;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export interface AuthService {
  /** Sign the user in and return the GitHub token. */
  signIn(): Promise<Result<string, string>>;
  /** Sign the user out and clear stored credentials. */
  signOut(): Promise<void>;
  /** Return the current token, or null if not signed in. */
  getToken(): string | null;
  /** True if a valid session exists. */
  isSignedIn(): boolean;
  /** Fire when sign-in state changes. */
  onDidChangeSession: runtime.Event<{ signedIn: boolean }>;
}

// ── GitHub ────────────────────────────────────────────────────────────────────

export interface GitHubIssue {
  number: number;
  title: string;
  html_url: string;
  state: 'open' | 'closed';
  labels: string[];
  created_at: string;
  updated_at: string;
}

export interface GitHubService {
  /** Detect owner/repo from .git/config in the opened folder. */
  detectRepo(): Promise<Result<string, string>>;
  /** List open issues with the configured labels, newest first. */
  listIssues(repo: string): Promise<Result<GitHubIssue[], string>>;
  /** Read the raw JSON of an issue record from the reprise-data branch. */
  readRecord(repo: string, issue: number): Promise<Result<IssueRecord | null, string>>;
  /** Write (create or update) an issue record on the reprise-data branch. */
  writeRecord(repo: string, issue: number, record: IssueRecord): Promise<Result<void, string>>;
  /** Create or update a PR for a fix branch. */
  createOrUpdatePr(repo: string, branch: string, base: string, title: string, body: string, draft: boolean): Promise<Result<{ number: number; html_url: string }, string>>;
  /** Dispatch reprise-run.yml with the given inputs. */
  dispatchWorkflow(repo: string, inputs: Record<string, string | number>): Promise<Result<{ runId: number }, string>>;
  /** Download a workflow artifact by URL and return unpacked JSON. */
  downloadArtifact(url: string, token: string): Promise<Result<Record<string, unknown>, string>>;
}

// ── Workspace ─────────────────────────────────────────────────────────────────

export interface WorkspaceService {
  /** Read a file from the opened folder (path relative to folder root). */
  readFile(path: string): Promise<Result<Uint8Array, string>>;
  /** Write a file (only inside edit_scope, after approval). */
  writeFile(path: string, content: Uint8Array): Promise<Result<void, string>>;
  /** Compute SHA-256 of bytes using crypto.subtle. */
  sha256(bytes: Uint8Array): Promise<string>;
  /** Return the root URI of the opened folder, or null. */
  getRootUri(): string | null;
  /** Live repository metadata when provided by a local bridge. */
  getRepository?(): Promise<Result<StatusResponse | null, string>>;
}

// ── Store ─────────────────────────────────────────────────────────────────────

export interface StoreService {
  /** Load an issue record from the reprise-data branch (via GitHub service). */
  load(repo: string, issue: number): Promise<Result<IssueRecord | null, string>>;
  /** Save a record back to reprise-data. */
  save(record: IssueRecord): Promise<Result<void, string>>;
  /** Return a cached record if available, without network access. */
  getCached(repo: string, issue: number): IssueRecord | null;
  /** Clear the in-memory cache. */
  invalidate(repo: string, issue: number): void;
}

// ── Views ─────────────────────────────────────────────────────────────────────

export interface ViewsService {
  /** Show or refresh the Bug Reports tree. */
  refreshBugReports(): void;
  /** Show or refresh the Runs tree. */
  refreshRuns(): void;
  /** Open the Reprise report panel for a specific issue. */
  openPanel(repo: string, issue: number): void;
  /** Update the status bar text. */
  setStatusBar(text: string): void;
  /** Show an information message with optional actions. */
  showInfo(message: string, ...actions: string[]): PromiseLike<string | undefined>;
  /** Show an error message. */
  showError(message: string): void;
}

// ── Runner client ─────────────────────────────────────────────────────────────

export interface RunnerClientService {
  /** Attempt to pair with the runner using the given pairing code. */
  pair(code: string): Promise<Result<PairResponse, string>>;
  /** Disconnect from the runner. */
  disconnect(): Promise<void>;
  /** Return the current status from the runner, or null if not paired. */
  getStatus(): Promise<Result<StatusResponse | null, string>>;
  /** True if currently paired. */
  isPaired(): boolean;
  // Optional for older host adapters; consumers report unsupported capabilities explicitly.
  approve?(path: string, sha256: string): Promise<Result<ApproveResponse, string>>;
  readFile?(path: string): Promise<Result<FileResponse, string>>;
  writeFile?(request: WriteFileRequest): Promise<Result<ApproveResponse, string>>;
  createOverlay?(request: OverlaysRequest): Promise<Result<OverlaysResponse, string>>;
  startRun?(request: RunsRequest): Promise<Result<RunsResponse, string>>;
  openEventStream?(runId: string, onEvent: (event: RunnerEvent) => void): () => void;
  cancelRun?(runId: string): Promise<void>;
  /** Fire when pairing state changes. */
  onDidChangePairing: runtime.Event<{ paired: boolean }>;
}

// ── Executors ─────────────────────────────────────────────────────────────────

export interface ExecutorsService {
  local: Executor;
  ci: Executor;
}

// ── Providers ─────────────────────────────────────────────────────────────────

export interface ProvidersService {
  /** Return the active provider (default: stub). */
  getActive(): Provider;
  /** Return all registered providers. */
  list(): Provider[];
  /** Set the active provider by id. Emits onDidChangeProvider. */
  setActive(id: string): Result<void, string>;
  /** Fire when the active provider changes. */
  onDidChangeProvider: runtime.Event<{ id: string }>;
}

// ── Pipeline ──────────────────────────────────────────────────────────────────

export interface PipelineService {
  /**
   * Start the full replication pipeline for an issue.
   * Runs intake → dedupe → test → trials → verdict → diagnosis.
   */
  acknowledge(
    repo: string,
    issue: number,
    trialsOverride?: Partial<TrialsPolicy>,
    token?: runtime.CancellationToken
  ): Promise<Result<IssueRecord, string>>;

  /** Add more trials to an existing replication. */
  runMoreTrials(
    repo: string,
    issue: number,
    count: number,
    token?: runtime.CancellationToken
  ): Promise<Result<IssueRecord, string>>;
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export interface TrialCounts {
  pass: number;
  fail_match: number;
  fail_other: number;
  error: number;
}

export interface StatsService {
  /** Classify a run result against a signature. Returns the TrialOutcome. */
  classifyTrial(result: RunResult, signature: { kind: string; pattern: string }): 'PASS' | 'FAIL_MATCH' | 'FAIL_OTHER' | 'ERROR';
  /** Compute the Wilson score 95% confidence interval. */
  wilsonInterval(failures: number, trials: number): { low: number; high: number };
  /** Decide the replication verdict from counts. */
  verdict(counts: TrialCounts, policy: TrialsPolicy): 'CONFIRMED' | 'FLAKY' | 'NEEDS_INFO';
}

// ── Fix ───────────────────────────────────────────────────────────────────────

export interface FixService {
  /** Propose fix candidates for an issue (calls the provider fix stage). */
  proposeFixes(repo: string, issue: number, token?: runtime.CancellationToken): Promise<Result<IssueRecord, string>>;
  /** Run the quick check on a specific candidate. */
  runQuickCheck(repo: string, issue: number, candidateK: number, token?: runtime.CancellationToken): Promise<Result<IssueRecord, string>>;
  /** Apply the selected candidate (write files and create PR). */
  applySelected(repo: string, issue: number, token?: runtime.CancellationToken): Promise<Result<IssueRecord, string>>;
}

// ── Verify ────────────────────────────────────────────────────────────────────

export interface VerifyService {
  /** Run the full verification suite (repro check + regression comparison). */
  verify(repo: string, issue: number, token?: runtime.CancellationToken): Promise<Result<IssueRecord, string>>;
}

// ── Security ──────────────────────────────────────────────────────────────────

export interface SecurityService {
  /** Redact secrets (tokens, keys) from a string before it is stored or shown. */
  redact(text: string): string;
  /** Record that the user approved this exact file at this SHA-256. */
  recordApproval(path: string, sha256: string): void;
  /** Check if the given (path, sha256) pair is approved. */
  isApproved(path: string, sha256: string): boolean;
  /** Check that a URL is on the allow-list (GitHub, runner, known AI providers). */
  isTrustedUrl(url: string): boolean;
}

// ── Services container ────────────────────────────────────────────────────────

/**
 * The central service container.
 * Created by the host through wiring/buildServices.
 * Every module receives only the subset it needs.
 * Host adapters provide UI, authentication and workspace access.
 */
export interface Services {
  config: ConfigService;
  auth: AuthService;
  github: GitHubService;
  store: StoreService;
  workspace: WorkspaceService;
  views: ViewsService;
  runnerClient: RunnerClientService;
  executors: ExecutorsService;
  providers: ProvidersService;
  pipeline: PipelineService;
  stats: StatsService;
  fix: FixService;
  verify: VerifyService;
  security: SecurityService;
}
