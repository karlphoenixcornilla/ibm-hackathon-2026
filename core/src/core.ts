// core.ts — compose the Services container from host-injected dependencies.
// Replaces the extension's extension.ts + wiring/buildServices.ts.
// This is the composition root: it is the only module (with fakes/) that imports across modules.

import type { ApprovalService, NotifierService, Services } from './contracts/services';
import type { AuthProvider, ConfigSource, FileSystem, TokenStore } from './contracts/host';

import { createConfig, configSourceFromFileSystem } from './config/config';
import { createAuth } from './auth/index';
import { createWorkspace } from './workspace/index';
import { createGitHub } from './github/index';
import { createStore } from './store/index';
import { createNotifier } from './notifier/index';
import { createRunnerClient } from './runner-client/index';
import type { RunnerClientOptions } from './runner-client/index';
import { createLocalExecutor } from './exec/local/index';
import { createCiExecutor } from './exec/ci/index';
import { createProviders } from './providers/index';
import type { ProvidersOptions } from './providers/index';
import { createPipeline } from './pipeline/index';
import { createStats } from './stats/index';
import { createSecurity } from './security/index';
import { createFix } from './fix/index';
import { createVerify } from './verify/index';

import { FakeConfig } from './fakes/FakeConfig';
import { FakeAuth } from './fakes/FakeAuth';
import { FakeGitHub } from './fakes/FakeGitHub';
import { FakeWorkspace } from './fakes/FakeWorkspace';
import { FakeIssueStore } from './fakes/FakeStore';
import { FakeNotifier } from './fakes/FakeNotifier';
import { FakeApprovals } from './fakes/FakeApprovals';
import { FakeRunnerClient } from './fakes/FakeRunnerClient';
import { FakeExecutor } from './fakes/FakeExecutor';
import { FakeProvider } from './fakes/FakeProvider';
import { FakePipeline } from './fakes/FakePipeline';
import { FakeStats } from './fakes/FakeStats';
import { FakeFix } from './fakes/FakeFix';
import { FakeVerify } from './fakes/FakeVerify';
import { FakeSecurity } from './fakes/FakeSecurity';

export type CoreServices = Services;

export interface CoreDeps {
  /** The linked repository's files (runner-backed or a server clone). */
  fileSystem: FileSystem;
  /** Where the GitHub token lives. Seed a memory store with a per-request token. */
  tokenStore: TokenStore;
  /** How auth.signIn() obtains a new token. Optional when the token is pre-seeded. */
  authProvider?: AuthProvider;
  /** Override GitHub token validation during sign-in (default: GET /user). */
  validateToken?: (token: string) => Promise<boolean>;
  /** Source of .reprise.yml. Default: `.reprise.yml` at the root of `fileSystem`. */
  configSource?: ConfigSource;
  /** Human approval gate before a fix is applied. Default: deny everything. */
  approvals?: ApprovalService;
  /** Event sink for the UI/API. Default: a fresh notifier; subscribe via services.notifier.onEvent. */
  notifier?: NotifierService;
  runner?: RunnerClientOptions;
  providers?: ProvidersOptions;
  /** Replace any service outright (e.g. fakes in tests, or a scripted executor). */
  overrides?: Partial<Services>;
}

/** Approval gate used when the host supplies none: never approve a write. */
export const denyAllApprovals: ApprovalService = {
  approveFix: async () => false,
};

/**
 * Build the complete Services container from host dependencies.
 *
 * Services are created in dependency order on one shared object. Factories that
 * take the container keep a reference to it and read fields lazily, so a service
 * may depend on one created after it (e.g. executors → pipeline) as long as it
 * doesn't call it during construction.
 */
export function buildCore(deps: CoreDeps): CoreServices {
  const svc = {} as Services;
  const overrides = deps.overrides ?? {};

  function provide<K extends keyof Services>(key: K, make: () => Services[K]): void {
    svc[key] = overrides[key] ?? make();
  }

  provide('notifier', () => deps.notifier ?? createNotifier());
  provide('approvals', () => deps.approvals ?? denyAllApprovals);
  provide('config', () => createConfig(deps.configSource ?? configSourceFromFileSystem(deps.fileSystem)));
  provide('auth', () => createAuth({
    tokenStore: deps.tokenStore,
    provider: deps.authProvider,
    validateToken: deps.validateToken,
  }));
  provide('workspace', () => createWorkspace(deps.fileSystem));
  provide('github', () => createGitHub({
    auth: svc.auth,
    config: svc.config,
    workspaceReader: async (path: string) => {
      const r = await svc.workspace.readFile(path);
      if (!r.ok) { return null; }
      return new TextDecoder().decode(r.value);
    },
  }));
  provide('store', () => createStore({ github: svc.github }));
  provide('stats', () => createStats(svc));
  provide('security', () => createSecurity(svc));
  provide('runnerClient', () => createRunnerClient(svc, deps.runner));
  provide('executors', () => ({
    local: createLocalExecutor(svc),
    ci: createCiExecutor(svc),
  }));
  provide('providers', () => createProviders(svc, deps.providers));
  provide('pipeline', () => createPipeline(svc));
  provide('fix', () => createFix(svc));
  provide('verify', () => createVerify(svc));

  return svc;
}

/**
 * Build a fully in-memory Services container (every service a fake), for demos and
 * for developing the backend/UI without a repository, runner or GitHub token.
 * Approvals default to "approve"; pass overrides to swap in real services.
 */
export function buildFakeCore(overrides: Partial<Services> = {}): CoreServices {
  return {
    config: new FakeConfig(),
    auth: new FakeAuth(),
    github: new FakeGitHub(),
    store: new FakeIssueStore(),
    workspace: new FakeWorkspace(),
    notifier: new FakeNotifier(),
    approvals: new FakeApprovals(true),
    runnerClient: new FakeRunnerClient(),
    executors: {
      local: new FakeExecutor('local'),
      ci: new FakeExecutor('ci'),
    },
    providers: new FakeProvider(),
    pipeline: new FakePipeline(),
    stats: new FakeStats(),
    fix: new FakeFix(),
    verify: new FakeVerify(),
    security: new FakeSecurity(),
    ...overrides,
  };
}
