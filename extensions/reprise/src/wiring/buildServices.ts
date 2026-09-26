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

function buildRealServices(_context: vscode.ExtensionContext): Services {
  // Config is fully implemented by base.
  const config = createConfig();

  // All other modules: factory stubs that throw until their track implements them.
  // Each factory is in its own module folder and will be replaced in-place.
  return {
    config,
    auth: new FakeAuth(),                   // T1 replaces
    github: new FakeGitHub(),               // T1 replaces
    store: new FakeIssueStore(),            // T1 replaces
    workspace: new FakeWorkspace(),         // T1 replaces
    views: new FakeViews(),                 // T1 replaces
    runnerClient: new FakeRunnerClient(),   // T2 replaces
    executors: {
      local: new FakeExecutor('local'),     // T2 replaces
      ci: new FakeExecutor('ci'),           // T4 replaces
    },
    providers: new FakeProvider(),          // T3 replaces
    pipeline: new FakePipeline(),           // T3 replaces
    stats: new FakeStats(),                 // T3 replaces (StatsService is partially implemented in fake)
    fix: new FakeFix(),                     // T4 replaces
    verify: new FakeVerify(),               // T4 replaces
    security: new FakeSecurity(),           // T3 replaces
  };
}
