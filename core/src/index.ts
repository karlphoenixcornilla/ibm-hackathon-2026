// @reprise/core — public entry point.
// Headless Reprise engine: build a Services container with buildCore(deps) and drive
// the pipeline, fix and verify flows from any host (backend server, CLI, tests).

// ── Composition ───────────────────────────────────────────────────────────────
export { buildCore, buildFakeCore, denyAllApprovals } from './core';
export type { CoreDeps, CoreServices } from './core';

// ── Contracts ─────────────────────────────────────────────────────────────────
export type * from './contracts/services';
export type * from './contracts/host';
export type * from './contracts/events';
export type * from './contracts/provider';
export type * from './contracts/runner-api';
export type * from './contracts/execution';
export type {
  Platform, Executor as ExecutorId, Method, State, Verdict, VerifyVerdict, TrialOutcome,
  SignatureKind, TestOrigin, FixSource, Evidence, TestClass, Stage, CandidateStatus,
} from './contracts/enums';
export type {
  RunContext, Signature, Fingerprint, Repro, Diagnosis, ReplicationSection, QuickCheck,
  Candidate, VerificationRepro, VerificationRegression, Verification, FixIteration,
  IssueEvent, UsageRecord, IssueRecord, DashboardIndex,
} from './contracts/records';

// ── Host helpers ──────────────────────────────────────────────────────────────
export { createMemoryTokenStore } from './auth/index';
export { configSourceFromFileSystem, normaliseConfig } from './config/config';

// ── Utilities ─────────────────────────────────────────────────────────────────
export { Result } from './util/result';
export { Emitter, noopEvent } from './util/events';
export { neverCancelled, fromAbortSignal, CancellationTokenSource } from './util/cancellation';
export { sha256, sha256String } from './util/sha256';
export { createLogger } from './util/log';
export type { Logger, LogLevel } from './util/log';
export { validateStageOutput } from './util/stage-output-validator';
export { parseGitConfigOrigin, extractOwnerRepo, resolveHeadSha } from './util/git-helpers';

// ── Individual factories (for hosts composing their own container) ────────────
export { createAuth } from './auth/index';
export type { AuthDeps } from './auth/index';
export { createConfig } from './config/config';
export { createWorkspace } from './workspace/index';
export { createGitHub } from './github/index';
export { createStore } from './store/index';
export { createNotifier } from './notifier/index';
export { createRunnerClient } from './runner-client/index';
export type { RunnerClientOptions } from './runner-client/index';
export { createLocalExecutor } from './exec/local/index';
export { createCiExecutor } from './exec/ci/index';
export { createProviders } from './providers/index';
export type { ProvidersOptions } from './providers/index';
export { StubProvider } from './providers/stub-provider';
export { createPipeline } from './pipeline/index';
export { createStats } from './stats/index';
export { createSecurity } from './security/index';
export { createFix } from './fix/index';
export { createVerify, requiredRuns, classifyTestClass, buildRegressionSection } from './verify/index';

// ── Fakes ─────────────────────────────────────────────────────────────────────
export * from './fakes/index';
