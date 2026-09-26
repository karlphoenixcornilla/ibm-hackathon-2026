// wiring/buildServices.ts — compose the Services container
// Owned by: Integration (after base-v1).
// At base-v1: returns fakes when reprise.dev.useFakes is true,
// otherwise returns each module's real factory — which currently returns its own fake
// until the track replaces it.
//
// Spec: 00-base.md §B4, architecture.md §Extension layout

import * as vscode from 'vscode';
import type { Services } from '../contracts/services';

// Fakes
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

// Real module factories (each returns its own fake until the track implements it)
import { createConfig } from '../config/config';

// T1 real factories
import { createAuth } from '../auth/index';
import { createWorkspace } from '../workspace/index';
import { createGitHub } from '../github/index';
import { createStore } from '../store/index';
import { createViews } from '../views/index';

/**
 * Build the complete Services container.
 *
 * When `reprise.dev.useFakes` is true, every service is a fully in-memory fake
 * so the extension can be demoed without a real repository, runner or GitHub token.
 *
 * Otherwise, each module's real factory is called. At base-v1 every factory
 * except `config/` throws "Not implemented yet (track Tn)"; each track replaces
 * only the body of its own factory.
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
  // Config is fully implemented by base.
  const config = createConfig();

  // T1: real auth (SecretStorage, G-7 built-in provider, PD-23 token)
  const auth = createAuth(context);

  // T1: real workspace (workspace.fs + .git parsing)
  const workspace = createWorkspace();

  // Partial services needed for github factory
  const partialForGitHub = { auth, config };

  // T1: real GitHub service (REST + Git Data API)
  const github = createGitHub({
    ...partialForGitHub,
    workspaceReader: async (path: string) => {
      const r = await workspace.readFile(path);
      if (!r.ok) { return null; }
      return new TextDecoder().decode(r.value);
    },
  });

  // T1: real store (reprise-data branch + IndexedDB cache)
  const store = createStore({ github });

  // Remaining stubs
  const runnerClient = new FakeRunnerClient();   // T2 replaces
  const executors = {
    local: new FakeExecutor('local'),            // T2 replaces
    ci: new FakeExecutor('ci'),                  // T4 replaces
  };
  const providers = new FakeProvider();          // T3 replaces
  const pipeline = new FakePipeline();           // T3 replaces
  const stats = new FakeStats();                 // T3 replaces
  const fix = new FakeFix();                     // T4 replaces
  const verify = new FakeVerify();               // T4 replaces
  const security = new FakeSecurity();           // T3 replaces

  // Build a partial services object so views can reference other services
  const partial: Omit<Services, 'views'> = {
    config, auth, github, store, workspace,
    runnerClient, executors, providers, pipeline, stats, fix, verify, security,
  };

  // T1: real views (trees, webview panel, status bar)
  const views = createViews(
    // views needs the full Services object; we cast here because at this point
    // all services are wired. The views factory only reads services.github,
    // services.store, and services.views (for error reporting).
    { ...partial, views: new FakeViews() } as Services,
    context
  );

  // Replace the placeholder views ref with the real one
  return { ...partial, views };
}
