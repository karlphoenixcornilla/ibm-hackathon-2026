// contracts/enums.ts — every enumeration from data-contracts.md
// FROZEN after base-v1. Change only via change request (CR).

export type Platform = 'windows' | 'android' | 'ios' | 'macos' | 'linux';

export type Executor = 'local' | 'ci';

export type Method = 'repo_command' | 'driver';

export type State =
  | 'LISTED'
  | 'REPLICATING'
  | 'CONFIRMED'
  | 'FLAKY'
  | 'DUPLICATE'
  | 'NEEDS_INFO'
  | 'BLOCKED_ENV'
  | 'STOPPED'
  | 'ERROR'
  | 'FIXING'
  | 'FIX_ABANDONED'
  | 'VERIFYING'
  | 'FIX_VERIFIED'
  | 'FIX_INCOMPLETE'
  | 'REGRESSION_DETECTED'
  | 'RESOLVED';

export type Verdict = 'CONFIRMED' | 'FLAKY' | 'DUPLICATE' | 'NEEDS_INFO' | 'BLOCKED_ENV';

export type VerifyVerdict = 'FIX_VERIFIED' | 'FIX_INCOMPLETE' | 'REGRESSION_DETECTED';

export type TrialOutcome = 'PASS' | 'FAIL_MATCH' | 'FAIL_OTHER' | 'ERROR';

export type SignatureKind = 'assertion_message' | 'error_type' | 'output_regex' | 'timeout';

export type TestOrigin = 'provided' | 'user';

export type FixSource = 'provider' | 'human';

export type Evidence = 'strong' | 'limited';

export type TestClass =
  | 'UNCHANGED_PASS'
  | 'NEWLY_PASSING'
  | 'PRE_EXISTING_FAILURE'
  | 'PRE_EXISTING_FLAKY'
  | 'ADDED_PASSING'
  | 'ADDED_FAILING'
  | 'REMOVED'
  | 'REGRESSION';

export type Stage = 'intake' | 'dedupe' | 'test' | 'rootcause' | 'fix' | 'review';

export type CandidateStatus =
  | 'selected'
  | 'survived'
  | 'rejected_repro'
  | 'rejected_regression'
  | 'rejected_duplicate'
  | 'error';
