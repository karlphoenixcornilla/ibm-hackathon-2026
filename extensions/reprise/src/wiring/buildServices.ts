// wiring/buildServices.ts — compose the Services container
// Owned by: Integration (after base-v1).
// Host adapters are supplied explicitly; fakes are available for tests.
//
// Spec: 00-base.md §B4, architecture.md §Extension layout

import type { Services } from '../contracts/services';

// Explicit test/demo implementations
import { FakeConfig } from '../fakes/FakeConfig';
import { FakeAuth } from '../fakes/FakeAuth';
import { FakeGitHub } from '../fakes/FakeGitHub';
import { FakeWorkspace } from '../fakes/FakeWorkspace';
import { FakeIssueStore } from '../fakes/FakeStore';
import { FakeViews } from '../fakes/FakeViews';
import { FakeRunnerClient } from '../fakes/FakeRunnerClient';
import { FakeExecutor } from '../fakes/FakeExecutor';
import { FakeProvider } from '../fakes/FakeProvider';
import { FakePipeline } from '../fakes/FakePipeline';
import { FakeStats } from '../fakes/FakeStats';
import { FakeFix } from '../fakes/FakeFix';
import { FakeVerify } from '../fakes/FakeVerify';
import { FakeSecurity } from '../fakes/FakeSecurity';

// Real module factories
import { createConfig } from '../config/config';

// T1 real factories
import { createGitHub } from '../github/index';
import { createStore } from '../store/index';

// T2 real factories
import { createRunnerClient } from '../runner-client/index';
import { createLocalExecutor } from '../exec/local/index';

// T3 real factories
import { createProviders } from '../providers/index';
import { createPipeline } from '../pipeline/index';
import { createStats } from '../stats/index';
import { createSecurity } from '../security/index';

// T4 real factories
import { createFix } from '../fix/index';
import { createVerify } from '../verify/index';
import { createCiExecutor } from '../exec/ci/index';

/** Host adapters are explicit; no editor, filesystem or credential store is assumed. */
export interface HostServices {
  auth: Services['auth'];
  workspace: Services['workspace'];
  views: Services['views'];
  runnerPort?: number;
}
export function buildServices(host: HostServices): Services {
  return buildRealServices(host);
}

export function buildFakeServices(): Services {
  return {
    config: new FakeConfig(),
    auth: new FakeAuth(),
    github: new FakeGitHub(),
    store: new FakeIssueStore(),
    workspace: new FakeWorkspace(),
    views: new FakeViews(),
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
  };
}

function buildRealServices(host: HostServices): Services {
  // We assemble Services incrementally; the container object is mutated in place
  // so that circular factory dependencies (runnerClient ↔ views, pipeline ↔ fix)
  // resolve without requiring a second pass.  Factories that accept `Omit<Services,
  // 'x'>` receive the container cast as unknown — safe because by the time each
  // factory is *called* all fields it actually reads are already populated.
  const svc = {} as Services;

  // ── Base ────────────────────────────────────────────────────────────────────
  svc.config = createConfig(host.workspace);

  // ── T1 ──────────────────────────────────────────────────────────────────────
  svc.auth = host.auth;
  svc.workspace = host.workspace;
  svc.github = createGitHub({
    auth: svc.auth,
    config: svc.config,
    repositoryRemote: host.workspace.getRepository ? async () => {
      const result = await host.workspace.getRepository?.();
      return result?.ok ? result.value?.remote ?? null : null;
    } : undefined,
    workspaceReader: async (path: string) => {
      const r = await svc.workspace.readFile(path);
      if (!r.ok) { return null; }
      return new TextDecoder().decode(r.value);
    },
  });
  svc.store = createStore({ github: svc.github });

  // ── T3 — stateless services (no circular deps) ───────────────────────────────
  svc.stats = createStats(svc as unknown as Omit<Services, 'stats'>);
  svc.security = createSecurity(svc as unknown as Omit<Services, 'security'>);

  // Host UI adapter
  svc.views = host.views;

  // ── T2 ──────────────────────────────────────────────────────────────────────
  // Placeholder executors satisfy the executors.local/ci contract during
  // runnerClient construction; replaced below once the real executors are ready.
  svc.executors = {
    local: new FakeExecutor('local'),
    ci: new FakeExecutor('ci'),
  };
  // Placeholder pipeline / fix / verify / providers needed by executors at build time.
  svc.pipeline = new FakePipeline();
  svc.providers = new FakeProvider();
  svc.fix = new FakeFix();
  svc.verify = new FakeVerify();

  svc.runnerClient = createRunnerClient(svc as unknown as Omit<Services, 'runnerClient'>, host.runnerPort);

  svc.executors = {
    local: createLocalExecutor(svc),
    ci: createCiExecutor(svc),
  };

  // ── T3 — providers and pipeline (executors must be real) ─────────────────────
  svc.providers = createProviders(svc as unknown as Omit<Services, 'providers'>);
  svc.pipeline = createPipeline(svc as unknown as Omit<Services, 'pipeline'>);

  // ── T4 ──────────────────────────────────────────────────────────────────────
  svc.fix = createFix(svc as unknown as Omit<Services, 'fix'>);
  svc.verify = createVerify(svc as unknown as Omit<Services, 'verify'>);

  return svc;
}
