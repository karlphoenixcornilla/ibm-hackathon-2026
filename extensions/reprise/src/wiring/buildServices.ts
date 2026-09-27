// wiring/buildServices.ts — compose the Services container
// Owned by: Integration (99-integration.md task 1).
// Real implementations by default; `reprise.dev.useFakes` switches to the
// in-memory fakes for demos without a repository, runner or GitHub token.
//
// Spec: 00-base.md §B4, architecture.md §Extension layout

import * as vscode from 'vscode';
import type { Services, ViewsService } from '../contracts/services';
import type { Executor, RunEvent, RunRequest } from '../contracts/execution';

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

// Real module factories
import { createConfig } from '../config/config';
import { createAuth } from '../auth/index';
import { createWorkspace } from '../workspace/index';
import { createGitHub } from '../github/index';
import { createStore } from '../store/index';
import { createViews } from '../views/index';
import { createRunnerClient } from '../runner-client/index';
import { createLocalExecutor } from '../exec/local/index';
import { createCiExecutor } from '../exec/ci/index';
import { createProviders } from '../providers/index';
import { createPipeline } from '../pipeline/index';
import { createStats } from '../stats/index';
import { createSecurity } from '../security/index';
import { createFix } from '../fix/index';
import { createVerify } from '../verify/index';

/**
 * Build the complete Services container.
 *
 * When `reprise.dev.useFakes` is true, every service is a fully in-memory fake
 * so the extension can be demoed without a real repository, runner or GitHub token.
 */
export function buildServices(context: vscode.ExtensionContext): Services {
  const useFakes = vscode.workspace
    .getConfiguration('reprise.dev')
    .get<boolean>('useFakes', false);

  return useFakes ? buildFakeServices() : buildRealServices(context);
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

/** Run tracking that the real views expose beyond the contract. */
interface RunTracking {
  onRunStarted(key: number, label: string): void;
  onRunFinished(key: number): void;
}

/**
 * Wrap an executor so every run appears in the Runs view and its output
 * streams to the "Reprise Runs" output channel.
 */
function trackRuns(exec: Executor, views: ViewsService & Partial<RunTracking>, out: vscode.OutputChannel): Executor {
  let seq = 0;
  return {
    id: exec.id,
    available: () => exec.available(),
    async run(req: RunRequest, token: vscode.CancellationToken, onEvent: (e: RunEvent) => void) {
      const key = Date.now() * 1000 + (seq++ % 1000);
      const what = req.mode === 'single' ? req.test_path : `test.${req.mode}`;
      const label = `${exec.id === 'local' ? 'This machine' : 'CI'}: ${req.platform} ${what} ×${req.runs}`;
      views.onRunStarted?.(key, label);
      out.appendLine(`▶ ${label}${req.ref ? ` @ ${JSON.stringify(req.ref)}` : ''}`);
      try {
        const results = await exec.run(req, token, (e) => {
          if (e.type === 'output') out.appendLine(e.line);
          else if (e.type === 'result') out.appendLine(`  result: exit ${e.result.exit_code}${e.result.timed_out ? ' (timed out)' : ''}, ${e.result.duration_ms} ms`);
          else if (e.type === 'error') out.appendLine(`  error: ${e.message}`);
          onEvent(e);
        });
        out.appendLine(`■ ${label}: ${results.length} result(s)`);
        return results;
      } catch (err) {
        out.appendLine(`✖ ${label}: ${err instanceof Error ? err.message : String(err)}`);
        throw err;
      } finally {
        views.onRunFinished?.(key);
      }
    },
  };
}

function buildRealServices(context: vscode.ExtensionContext): Services {
  // One container, filled in dependency order. Factories keep a reference to it
  // and read the services they call at call time, so late entries are visible.
  const s = {} as Services;

  s.config = createConfig();
  s.auth = createAuth(context);
  s.workspace = createWorkspace();
  s.github = createGitHub({
    auth: s.auth,
    config: s.config,
    workspaceReader: async (path: string) => {
      const r = await s.workspace.readFile(path);
      return r.ok ? new TextDecoder().decode(r.value) : null;
    },
    workspaceRoot: () => s.workspace.getRootUri()?.toString() ?? null,
  });
  s.store = createStore({ github: s.github });
  s.security = createSecurity(s);
  s.stats = createStats(s);
  s.views = createViews(s, context);

  const port = vscode.workspace.getConfiguration('reprise').get<number>('runnerPort', 47410);
  s.runnerClient = createRunnerClient(s, port);

  const runsOutput = vscode.window.createOutputChannel('Reprise Runs');
  context.subscriptions.push(runsOutput);
  const views = s.views as ViewsService & Partial<RunTracking>;
  s.executors = {
    local: trackRuns(createLocalExecutor(s), views, runsOutput),
    ci: trackRuns(createCiExecutor(s), views, runsOutput),
  };

  s.providers = createProviders(s);
  s.pipeline = createPipeline(s);
  s.fix = createFix(s);
  s.verify = createVerify(s);

  applyProviderSetting(s);
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('reprise.provider')) applyProviderSetting(s);
    })
  );

  return s;
}

/** Activate the provider named by `reprise.provider` (default: bob). */
function applyProviderSetting(s: Services): void {
  const id = vscode.workspace.getConfiguration('reprise').get<string>('provider', 'bob');
  if (id === s.providers.getActive().id) return;
  const r = s.providers.setActive(id);
  if (!r.ok) {
    vscode.window.showWarningMessage(`Reprise: ${r.error}. Using ${s.providers.getActive().id}.`);
  }
}
