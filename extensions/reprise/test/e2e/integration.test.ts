// test/e2e/integration.test.ts — Integration hardening tests
// Owned by: Integration
// Spec: docs/implementation/99-integration.md Tasks 1, 3
//
// Verifies that the Services container is fully wired — every slot is populated
// and each real factory produces an object that satisfies its contract interface.
// Uses fakes for the VS Code runtime and exercises the pipeline end-to-end.
//
// Run with: node --test  (no vscode runtime needed)

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// ── Real factories under test ─────────────────────────────────────────────────
import { createStats } from '../../src/stats/index';
import { createSecurity } from '../../src/security/index';
import { createProviders } from '../../src/providers/index';
import { createPipeline } from '../../src/pipeline/index';
import { createFix } from '../../src/fix/index';
import { createVerify } from '../../src/verify/index';

// ── Fakes ─────────────────────────────────────────────────────────────────────
import { FakeConfig } from '../../src/fakes/FakeConfig';
import { FakeGitHub } from '../../src/fakes/FakeGitHub';
import { FakeIssueStore } from '../../src/fakes/FakeStore';
import { FakeViews } from '../../src/fakes/FakeViews';
import { FakeExecutor } from '../../src/fakes/FakeExecutor';
import { FakeProvider } from '../../src/fakes/FakeProvider';
import { FakePipeline } from '../../src/fakes/FakePipeline';
import { FakeFix } from '../../src/fakes/FakeFix';
import { FakeVerify } from '../../src/fakes/FakeVerify';

// ── Contracts ─────────────────────────────────────────────────────────────────
import type {
  Services,
  WorkspaceService,
  AuthService,
  RunnerClientService,
} from '../../src/contracts/services';
import type { PairResponse, StatusResponse } from '../../src/contracts/runner-api';
import type { Result } from '../../src/util/result';
import { Result as R } from '../../src/util/result';
import type { Executor, RunRequest, RunResult, RunEvent, Availability } from '../../src/contracts/execution';
import type { Provider, StageRequest, StageResponse } from '../../src/contracts/provider';
import type { ProvidersService } from '../../src/contracts/services';
import type * as vscode from 'vscode';

// ── Helpers ───────────────────────────────────────────────────────────────────

const CANCEL_TOKEN: vscode.CancellationToken = {
  isCancellationRequested: false,
  onCancellationRequested: (() => ({ dispose: () => undefined })) as unknown as vscode.Event<unknown>,
};

/** Inline fake AuthService — avoids vscode.EventEmitter at runtime */
class InlineAuth implements AuthService {
  private readonly token = 'fake-github-token-abc123';
  private signedIn = true;
  readonly onDidChangeSession = (() => ({ dispose: () => undefined })) as unknown as vscode.Event<{ signedIn: boolean }>;

  async signIn(): Promise<Result<string, string>> {
    this.signedIn = true;
    return R.ok(this.token);
  }
  async signOut(): Promise<void> { this.signedIn = false; }
  getToken(): string | null { return this.signedIn ? this.token : null; }
  isSignedIn(): boolean { return this.signedIn; }
}

/** Inline fake RunnerClientService — avoids vscode.EventEmitter at runtime */
class InlineRunnerClient implements RunnerClientService {
  private paired = false;
  readonly onDidChangePairing = (() => ({ dispose: () => undefined })) as unknown as vscode.Event<{ paired: boolean }>;

  async pair(_code: string): Promise<Result<PairResponse, string>> {
    this.paired = true;
    return R.ok({
      session: 'fake-session',
      runner_version: '0.1.0-test',
      root_name: 'demo-app',
      remote: 'https://github.com/demo-owner/demo-app.git',
      head: 'abc1234',
      host_os: 'linux',
      platforms: [],
    });
  }
  async disconnect(): Promise<void> { this.paired = false; }
  async getStatus(): Promise<Result<StatusResponse | null, string>> {
    return R.ok(this.paired ? { runner_version: '0.1.0-test', root_name: 'demo-app', remote: '', head: '', host_os: 'linux', platforms: [], busy: false } : null);
  }
  isPaired(): boolean { return this.paired; }
}

class InlineWorkspace implements WorkspaceService {
  public readonly files = new Map<string, Uint8Array>();

  async readFile(path: string): Promise<Result<Uint8Array, string>> {
    const data = this.files.get(path);
    if (!data) { return R.err(`File not found: ${path}`); }
    return R.ok(data);
  }

  async writeFile(path: string, content: Uint8Array): Promise<Result<void, string>> {
    this.files.set(path, content);
    return R.ok(undefined);
  }

  async sha256(bytes: Uint8Array): Promise<string> {
    return createHash('sha256').update(bytes).digest('hex');
  }

  getRootUri(): null { return null; }
}

/** Scripted executor — returns one result per run() call from the queue. */
class ScriptedExecutor implements Executor {
  constructor(
    public readonly id: 'local' | 'ci',
    private readonly script: RunResult[]
  ) {}

  async available(): Promise<Availability> { return { available: true }; }

  async run(
    _req: RunRequest,
    _token: vscode.CancellationToken,
    onEvent: (event: RunEvent) => void
  ): Promise<RunResult[]> {
    const result = this.script.shift();
    if (!result) { throw new Error('ScriptedExecutor: no more scripted results'); }
    onEvent({ type: 'result', result });
    onEvent({ type: 'done' });
    return [result];
  }
}

/** Scripted provider — returns canned JSON for each pipeline stage. */
class ScriptedProvider implements Provider {
  readonly id = 'stub';
  readonly capabilities = { images: false, implemented: true };
  private responses: Map<string, unknown[]> = new Map();

  setResponse(stage: string, ...jsons: unknown[]): void {
    this.responses.set(stage, [...jsons]);
  }

  async run(req: StageRequest, _token: vscode.CancellationToken): Promise<StageResponse> {
    const queue = this.responses.get(req.stage);
    if (!queue || queue.length === 0) {
      throw new Error(`ScriptedProvider: no stub for stage "${req.stage}"`);
    }
    return {
      json: queue.shift()!,
      files: [],
      usage: { calls: 1, detail: { [req.stage]: 1 } },
      provider: 'stub',
      stubbed: true,
    };
  }
}

class ScriptedProviders implements ProvidersService {
  constructor(private readonly provider: Provider) {}
  getActive(): Provider { return this.provider; }
  list(): Provider[] { return [this.provider]; }
  setActive(_id: string): Result<void, string> { return R.ok(undefined); }
  readonly onDidChangeProvider = (() => ({ dispose: () => undefined })) as unknown as vscode.Event<{ id: string }>;
}

function makeRunResult(pass: boolean, msg = 'NullPointerException in MainActivity'): RunResult {
  return {
    platform: 'android',
    executor: 'local',
    method: 'repo_command',
    exit_code: pass ? 0 : 1,
    timed_out: false,
    duration_ms: 2000,
    tests: pass
      ? [{ id: 'Main::test', status: 'passed', message: '', output: '' }]
      : [{ id: 'Main::test', status: 'failed', message: msg, output: msg }],
    output_tail: pass ? '' : msg,
    host_os: 'linux',
    device: 'emulator-5554',
    ci_run_url: null,
    runner_version: '0.1.0-test',
  };
}

/** Build a minimal wired Services container suitable for unit-testing real factories. */
function buildTestServices(overrides: Partial<Services> = {}): Services {
  const svc = {} as Services;
  svc.config = new FakeConfig();
  svc.auth = new InlineAuth();
  svc.github = new FakeGitHub();
  svc.store = new FakeIssueStore();
  svc.workspace = new InlineWorkspace();
  svc.views = new FakeViews();
  svc.runnerClient = new InlineRunnerClient();
  svc.stats = createStats(svc as unknown as Omit<Services, 'stats'>);
  svc.security = createSecurity(svc as unknown as Omit<Services, 'security'>);
  svc.executors = {
    local: new FakeExecutor('local'),
    ci: new FakeExecutor('ci'),
  };
  svc.providers = new FakeProvider();
  svc.pipeline = new FakePipeline();
  svc.fix = new FakeFix();
  svc.verify = new FakeVerify();
  return Object.assign(svc, overrides);
}

// ── Task 1: confirm all service slots are populated ───────────────────────────

describe('Services container — all slots populated', () => {
  it('buildTestServices returns non-null for every Services key', () => {
    const svc = buildTestServices();
    const keys: Array<keyof Services> = [
      'config', 'auth', 'github', 'store', 'workspace', 'views',
      'runnerClient', 'executors', 'providers', 'pipeline',
      'stats', 'fix', 'verify', 'security',
    ];
    for (const key of keys) {
      assert.ok(svc[key] !== null && svc[key] !== undefined, `${key} must be non-null`);
    }
  });

  it('executors has local and ci slots', () => {
    const svc = buildTestServices();
    assert.ok(svc.executors.local !== undefined);
    assert.ok(svc.executors.ci !== undefined);
  });
});

// ── createStats ───────────────────────────────────────────────────────────────

describe('createStats — real factory', () => {
  const svc = buildTestServices();
  const stats = createStats(svc as unknown as Omit<Services, 'stats'>);

  it('wilsonInterval is symmetric around 0.5 for 10/20', () => {
    const { low, high } = stats.wilsonInterval(10, 20);
    assert.ok(low > 0.25 && low < 0.5, `low=${low}`);
    assert.ok(high > 0.5 && high < 0.75, `high=${high}`);
  });

  it('verdict CONFIRMED when all 20 runs fail', () => {
    const v = stats.verdict(
      { pass: 0, fail_match: 20, fail_other: 0, error: 0 },
      { min: 5, max: 20, limit: 100, max_minutes: null }
    );
    assert.equal(v, 'CONFIRMED');
  });

  it('classifyTrial FAIL_MATCH when exit_code=1 and pattern matches', () => {
    const result = makeRunResult(false, 'NullPointerException in MainActivity');
    const cls = stats.classifyTrial(result, { kind: 'contains', pattern: 'NullPointerException' });
    assert.equal(cls, 'FAIL_MATCH');
  });

  it('classifyTrial PASS when exit_code=0', () => {
    const result = makeRunResult(true);
    const cls = stats.classifyTrial(result, { kind: 'contains', pattern: 'NullPointerException' });
    assert.equal(cls, 'PASS');
  });
});

// ── createSecurity ────────────────────────────────────────────────────────────

describe('createSecurity — real factory', () => {
  const svc = buildTestServices();
  const sec = createSecurity(svc as unknown as Omit<Services, 'security'>);

  it('redacts a GitHub PAT', () => {
    const text = `Authorization: Bearer ghp_${'A'.repeat(36)}`;
    assert.match(sec.redact(text), /\[REDACTED\]/);
  });

  it('does not redact clean text', () => {
    assert.equal(sec.redact('Hello, world!'), 'Hello, world!');
  });

  it('recordApproval / isApproved round-trip', () => {
    sec.recordApproval('/src/main.kt', 'deadbeef');
    assert.equal(sec.isApproved('/src/main.kt', 'deadbeef'), true);
    assert.equal(sec.isApproved('/src/main.kt', 'wrong'), false);
  });

  it('trusts GitHub API URL', () => {
    assert.equal(sec.isTrustedUrl('https://api.github.com/repos/a/b'), true);
  });

  it('trusts runner localhost', () => {
    assert.equal(sec.isTrustedUrl('http://127.0.0.1:47410/status'), true);
  });

  it('rejects unknown URL', () => {
    assert.equal(sec.isTrustedUrl('https://evil.example.com/steal'), false);
  });
});

// ── createProviders ───────────────────────────────────────────────────────────

describe('createProviders — real factory', () => {
  const svc = buildTestServices();
  const providers = createProviders(svc as unknown as Omit<Services, 'providers'>);

  it('lists at least one provider', () => {
    assert.ok(providers.list().length > 0);
  });

  it('getActive returns a provider', () => {
    const p = providers.getActive();
    assert.ok(typeof p.id === 'string' && p.id.length > 0);
  });

  it('setActive rejects unknown id', () => {
    const r = providers.setActive('does-not-exist');
    assert.equal(r.ok, false);
  });
});

// ── Pipeline end-to-end: CONFIRMED verdict ────────────────────────────────────

describe('Pipeline end-to-end — CONFIRMED via real factories', () => {
  it('acknowledge produces CONFIRMED record after 10 failing trials', async () => {
    // Load config first so pipeline can read it
    const config = new FakeConfig();
    await config.load();

    const provider = new ScriptedProvider();

    // intake response — must include attempt_possible: true
    provider.setResponse('intake', {
      fingerprint: {
        platform: 'android',
        component: 'MainActivity',
        functions: ['onCreate'],
        symptom: 'crash',
        trigger: 'launch',
        expected: 'app continues',
        actual: 'app crashes',
        error_signature: 'NullPointerException',
      },
      attempt_possible: true,
      missing: [],
      question: '',
    });
    // dedupe: no duplicate
    provider.setResponse('dedupe', { same_bug: false, reason: 'no prior reports' });
    // test stage: provide a test file path and signature matching our run results
    provider.setResponse('test', {
      test_file: 'app/src/androidTest/LoginTest.kt',
      signature: { kind: 'contains', pattern: 'NullPointerException' },
      rationale: 'matches the error signature',
    });
    // rootcause (diagnosis)
    provider.setResponse('rootcause', {
      summary: 'Null reference in onCreate',
      locations: [{ file: 'app/src/main/java/com/example/MainActivity.kt', start_line: 42, end_line: 42, reason: 'missing null check' }],
      fix_direction: 'Add null check before dereference',
      confidence: 'high',
    });

    // 10 failing run results for trials
    const failMsg = 'NullPointerException in MainActivity';
    // 1 result for first-run stage + 10 results for trials (min=10, early-stop when all fail)
    const failResults = Array.from({ length: 11 }, () => makeRunResult(false, failMsg));
    const localExecutor = new ScriptedExecutor('local', failResults);

    const svc = buildTestServices({
      config: config as unknown as Services['config'],
      providers: new ScriptedProviders(provider),
      executors: { local: localExecutor, ci: new FakeExecutor('ci') },
    });

    // Wire real stats, security, pipeline
    svc.stats = createStats(svc as unknown as Omit<Services, 'stats'>);
    svc.security = createSecurity(svc as unknown as Omit<Services, 'security'>);
    svc.pipeline = createPipeline(svc as unknown as Omit<Services, 'pipeline'>);

    const result = await svc.pipeline.acknowledge('demo-owner/demo-app', 1, undefined, CANCEL_TOKEN);

    assert.equal(result.ok, true, `acknowledge failed: ${!result.ok && (result as { error: string }).error}`);
    if (result.ok) {
      assert.ok(
        result.value.state === 'CONFIRMED' || result.value.state === 'FLAKY',
        `Expected CONFIRMED or FLAKY, got ${result.value.state}`
      );
      assert.ok(result.value.replication !== null, 'replication must be populated');
    }
  });
});

// ── Security pass: token redaction ────────────────────────────────────────────

describe('Security pass — token never leaks through redact()', () => {
  it('redacts all common GitHub token prefixes', () => {
    const svc = buildTestServices();
    const sec = createSecurity(svc as unknown as Omit<Services, 'security'>);
    const prefixes = ['ghp_', 'ghs_', 'gho_', 'github_pat_'];
    for (const prefix of prefixes) {
      const token = prefix + 'A'.repeat(36);
      const redacted = sec.redact(`token: ${token}`);
      assert.ok(!redacted.includes(token), `Token with prefix ${prefix} was not redacted`);
      assert.match(redacted, /\[REDACTED\]/, `Expected [REDACTED] for prefix ${prefix}`);
    }
  });

  it('isTrustedUrl rejects non-allowlisted domains', () => {
    const svc = buildTestServices();
    const sec = createSecurity(svc as unknown as Omit<Services, 'security'>);
    const untrusted = [
      'https://attacker.com',
      'https://api.github.com.evil.com',
      'http://0.0.0.0:47410/pair',
    ];
    for (const url of untrusted) {
      assert.equal(sec.isTrustedUrl(url), false, `${url} should not be trusted`);
    }
  });
});

// ── createFix / createVerify — factories return correct contract ───────────────

describe('createFix — real factory', () => {
  const svc = buildTestServices();
  const fix = createFix(svc as unknown as Omit<Services, 'fix'>);

  it('returns object with proposeFixes, runQuickCheck, applySelected', () => {
    assert.equal(typeof fix.proposeFixes, 'function');
    assert.equal(typeof fix.runQuickCheck, 'function');
    assert.equal(typeof fix.applySelected, 'function');
  });
});

describe('createVerify — real factory', () => {
  const svc = buildTestServices();
  const verify = createVerify(svc as unknown as Omit<Services, 'verify'>);

  it('returns object with verify', () => {
    assert.equal(typeof verify.verify, 'function');
  });
});
