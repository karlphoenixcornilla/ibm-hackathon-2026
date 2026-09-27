// wiring/buildServices.ts — compose the Services container
// Owned by: Integration (after base-v1).
// After T1–T5 merge: all real factories wired; fakes retained for useFakes mode.
//
// Spec: 00-base.md §B4, architecture.md §Extension layout

import * as vscode from 'vscode';
import type { Services } from '../contracts/services';

// Fakes (used only when reprise.dev.useFakes is true)
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
import { createAuth } from '../auth/index';
import { createWorkspace } from '../workspace/index';
import { createGitHub } from '../github/index';
import { createStore } from '../store/index';
import { createViews } from '../views/index';

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

/**
 * Build the complete Services container.
 *
 * When `reprise.dev.useFakes` is true every service is a fully in-memory fake
 * so the extension can be demoed without a real repository, runner or GitHub token.
 *
 * Otherwise every module's real factory is used.
 */
export function buildServices(context: vscode.ExtensionContext): Services {
  const useFakes = vscode.workspace
    .getConfiguration('reprise.dev')
    .get<boolean>('useFakes', false);

  if (useFakes) {
    return buildFakeServices();
  }

  return buildRealServices(context);
}

function buildFakeServices(): Services {
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

function buildRealServices(context: vscode.ExtensionContext): Services {
  // We assemble Services incrementally; the container object is mutated in place
  // so that circular factory dependencies (runnerClient ↔ views, pipeline ↔ fix)
  // resolve without requiring a second pass.  Factories that accept `Omit<Services,
  // 'x'>` receive the container cast as unknown — safe because by the time each
  // factory is *called* all fields it actually reads are already populated.
  const svc = {} as Services;

  // ── Base ────────────────────────────────────────────────────────────────────
  svc.config = createConfig();

  // ── T1 ──────────────────────────────────────────────────────────────────────
  svc.auth = createAuth(context);
  svc.workspace = createWorkspace();
  svc.github = createGitHub({
    auth: svc.auth,
    config: svc.config,
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

  // ── Views placeholder — replaced after real views is constructed ─────────────
  svc.views = new FakeViews();

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

  svc.runnerClient = createRunnerClient(svc as unknown as Omit<Services, 'runnerClient'>);

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

  // ── T1 views (needs the complete container) ──────────────────────────────────
  svc.views = createViews(svc, context);

  return svc;
}
