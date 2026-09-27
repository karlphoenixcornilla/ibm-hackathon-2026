// contracts/records.ts — IssueRecord (schema 3) and DashboardIndex
// FROZEN after base-v1. Change only via change request (CR).
// Spec: 02-specs/data-contracts.md

import type {
  Platform,
  Executor,
  Method,
  State,
  Verdict,
  VerifyVerdict,
  SignatureKind,
  TestOrigin,
  FixSource,
  Evidence,
  TestClass,
  CandidateStatus,
} from './enums';

export interface RunContext {
  platform: Platform;
  executor: Executor;
  method: Method;
  host_os: string;
  device: string;
  ci_run_url: string | null;
  runner_version: string | null;
}

export interface Signature {
  kind: SignatureKind;
  pattern: string;
}

export interface TrialsPolicy {
  min: number;
  max: number;
  limit: number;
  max_minutes: number | null;
  source: 'config' | 'user';
  stopped_by: 'all_failed_at_min' | 'max_reached' | 'time_budget' | 'user_extended';
}

export interface Fingerprint {
  platform: Platform | 'unknown';
  component: string;
  functions: string[];
  symptom: string;
  trigger: string;
  expected: string;
  actual: string;
  error_signature: string;
}

export interface Repro {
  test_origin: TestOrigin;
  test_file: string;
  test_sha256: string;
  branch: string;
  signature: Signature;
  attempts: number;
  run_context: RunContext;
  trials: number;
  failed: number;
  invalid: number;
  sequence: string;
  trials_policy: TrialsPolicy;
  rate: number;
  wilson_low: number;
  wilson_high: number;
}

export interface Diagnosis {
  summary: string;
  locations: Array<{ file: string; start_line: number; end_line: number; reason: string }>;
  fix_direction: string;
  confidence: 'high' | 'medium' | 'low';
  accepted_by: string;
  edited: boolean;
}

export interface ReplicationSection {
  verdict: Verdict;
  acknowledged_by: string;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  fingerprint: Fingerprint;
  duplicate: {
    of: number | null;
    score: number | null;
    fields: Record<string, unknown>;
    reason: string;
    behaviour_check: unknown | null;
  };
  question: string;
  repro: Repro;
  diagnosis: Diagnosis;
}

export interface QuickCheck {
  repro_runs: number;
  repro_failed: number;
  blocking: number;
}

export interface Candidate {
  k: number;
  summary: string;
  files_changed: string[];
  diff_hash: string;
  executor: Executor;
  quick_check: QuickCheck;
  status: CandidateStatus;
}

export interface VerificationRepro {
  runs_required: number;
  runs: number;
  failed: number;
  invalid: number;
  evidence: Evidence;
  claim: string;
  injected: boolean;
}

export interface VerificationRegression {
  tests_total: number;
  counts: Partial<Record<TestClass, number>>;
  blocking: string[];
  notable: string[];
}

export interface Verification {
  verdict: VerifyVerdict;
  finished_at: string;
  run_context: RunContext;
  repro: VerificationRepro;
  regression: VerificationRegression;
}

export interface FixIteration {
  n: number;
  source: FixSource;
  pr: string | null;
  pr_draft: boolean;
  branch: string;
  base_sha: string;
  head_sha: string;
  summary: string;
  dropped_files: string[];
  candidates: Candidate[];
  review: {
    verdict: 'ok' | 'changes_needed';
    findings: Array<{ file: string; line: number; severity: 'high' | 'medium' | 'low'; message: string }>;
    stubbed: boolean;
  };
  verification: Verification;
}

export interface IssueEvent {
  at: string;
  type: string;
  detail: string;
}

export interface UsageRecord {
  provider: string;
  calls: number;
  by_stage: Partial<Record<'intake' | 'dedupe' | 'test' | 'rootcause' | 'fix', number>>;
}

/** Schema version 3 issue record — lives at issues/<N>.json on reprise-data branch. */
export interface IssueRecord {
  schema: 3;
  repo: string;
  issue: number;
  title: string;
  url: string;
  state: State;
  provider: string;
  stubbed: boolean;
  created_at: string;
  updated_at: string;
  replication: ReplicationSection;
  fix: { iterations: FixIteration[] };
  resolution_note: string;
  usage: UsageRecord;
  events: IssueEvent[];
}

/** Dashboard index — generated at site build, lives at dashboard/index.json. */
export interface DashboardIndex {
  generated_at: string;
  data_source: 'live' | 'sample';
  repos: string[];
  totals: {
    issues: number;
    by_state: Partial<Record<State, number>>;
    by_platform: Partial<Record<Platform, number>>;
    median_time_to_verdict_ms: number;
    fixes_verified: number;
    regressions_caught: number;
  };
  issues: Array<{
    repo: string;
    issue: number;
    title: string;
    platform: string;
    state: string;
    verdict: string;
    rate: number;
    sequence: string;
    stubbed: boolean;
    updated_at: string;
    pr: string | null;
  }>;
}
