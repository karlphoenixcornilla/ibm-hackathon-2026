// test/core.test.ts — the pieces added by the core extraction (#28):
// cancellation, events, host-injected auth/config/workspace, runner options,
// provider injection, and buildCore() driving a pipeline run with fakes.
// Runs with: node --test (no editor runtime needed).

import { describe, it, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  buildCore,
  buildFakeCore,
  createAuth,
  createConfig,
  createMemoryTokenStore,
  configSourceFromFileSystem,
  createWorkspace,
  createProviders,
  createRunnerClient,
  createNotifier,
  neverCancelled,
  fromAbortSignal,
  CancellationTokenSource,
  Emitter,
  FakeFileSystem,
  FakeNotifier,
  FakeApprovals,
  FakeGitHub,
  FakeIssueStore,
  FakeExecutor,
  FakeWorkspace,
} from '../src/index';
import type {
  CoreEvent,
  ConfigSource,
  Executor,
  Provider,
  RunResult,
  Services,
  TokenStore,
} from '../src/index';

const tick = () => new Promise((resolve) => setImmediate(resolve));

// ── Cancellation ──────────────────────────────────────────────────────────────

describe('cancellation', () => {
  it('neverCancelled is never cancelled and its event is inert', () => {
    assert.equal(neverCancelled.isCancellationRequested, false);
    const sub = neverCancelled.onCancellationRequested(() => assert.fail('must not fire'));
    sub.dispose();
  });

  it('fromAbortSignal reflects the signal and fires listeners on abort', () => {
    const controller = new AbortController();
    const token = fromAbortSignal(controller.signal);
    let fired = 0;
    token.onCancellationRequested(() => { fired++; });
    const disposed = token.onCancellationRequested(() => assert.fail('disposed listener fired'));
    disposed.dispose();

    assert.equal(token.isCancellationRequested, false);
    controller.abort();
    assert.equal(token.isCancellationRequested, true);
    assert.equal(fired, 1);
  });

  it('fromAbortSignal notifies late listeners of an already-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    let fired = false;
    fromAbortSignal(controller.signal).onCancellationRequested(() => { fired = true; });
    await tick();
    assert.equal(fired, true);
  });

  it('CancellationTokenSource.cancel() cancels its token and signal', () => {
    const source = new CancellationTokenSource();
    assert.equal(source.token.isCancellationRequested, false);
    source.cancel();
    assert.equal(source.token.isCancellationRequested, true);
    assert.equal(source.signal.aborted, true);
  });
});

// ── Emitter ───────────────────────────────────────────────────────────────────

describe('Emitter', () => {
  it('delivers to subscribers until disposed', () => {
    const emitter = new Emitter<number>();
    const seen: number[] = [];
    const sub = emitter.event((n) => seen.push(n));
    emitter.fire(1);
    sub.dispose();
    emitter.fire(2);
    assert.deepEqual(seen, [1]);
  });

  it('a throwing listener does not stop the others', () => {
    const emitter = new Emitter<string>();
    const seen: string[] = [];
    const originalError = console.error;
    console.error = () => undefined;
    try {
      emitter.event(() => { throw new Error('boom'); });
      emitter.event((s) => seen.push(s));
      emitter.fire('x');
    } finally {
      console.error = originalError;
    }
    assert.deepEqual(seen, ['x']);
  });
});

// ── Auth over TokenStore / AuthProvider ───────────────────────────────────────

describe('createAuth (host-injected)', () => {
  it('a synchronous pre-seeded store is signed in immediately', () => {
    const auth = createAuth({ tokenStore: createMemoryTokenStore('seeded') });
    assert.equal(auth.isSignedIn(), true);
    assert.equal(auth.getToken(), 'seeded');
  });

  it('an async store is restored after it resolves and fires onDidChangeSession', async () => {
    const store: TokenStore = {
      get: async () => 'from-async',
      set: async () => undefined,
      delete: async () => undefined,
    };
    const auth = createAuth({ tokenStore: store });
    const events: boolean[] = [];
    auth.onDidChangeSession((e) => events.push(e.signedIn));
    assert.equal(auth.getToken(), null);
    await tick();
    assert.equal(auth.getToken(), 'from-async');
    assert.deepEqual(events, [true]);
  });

  it('signIn fails without a provider', async () => {
    const auth = createAuth({ tokenStore: createMemoryTokenStore() });
    const r = await auth.signIn();
    assert.equal(r.ok, false);
  });

  it('signIn stores a validated token; signOut clears it', async () => {
    const store = createMemoryTokenStore();
    const auth = createAuth({
      tokenStore: store,
      provider: { acquireToken: async () => 'ghp_new' },
      validateToken: async (t) => t === 'ghp_new',
    });
    const events: boolean[] = [];
    auth.onDidChangeSession((e) => events.push(e.signedIn));

    const r = await auth.signIn();
    assert.equal(r.ok, true);
    assert.equal(auth.getToken(), 'ghp_new');
    assert.equal(store.get(), 'ghp_new');

    await auth.signOut();
    assert.equal(auth.isSignedIn(), false);
    assert.equal(store.get(), null);
    assert.deepEqual(events, [true, false]);
  });

  it('signIn rejects a token GitHub refuses, and reports cancellation', async () => {
    const rejected = createAuth({
      tokenStore: createMemoryTokenStore(),
      provider: { acquireToken: async () => 'bad' },
      validateToken: async () => false,
    });
    const r1 = await rejected.signIn();
    assert.equal(r1.ok, false);
    assert.match(r1.ok ? '' : r1.error, /rejected by GitHub/);
    assert.equal(rejected.isSignedIn(), false);

    const cancelled = createAuth({
      tokenStore: createMemoryTokenStore(),
      provider: { acquireToken: async () => null },
    });
    const r2 = await cancelled.signIn();
    assert.equal(r2.ok ? '' : r2.error, 'Sign in cancelled.');
  });
});

// ── Config over ConfigSource ──────────────────────────────────────────────────

const REPRISE_YML = `
version: 3
issues:
  labels: [bug, crash]
defaults:
  executor: local
  trials: 5
platforms:
  android:
    shell: bash
    cwd: .
    test:
      pattern: "**/*Test.kt"
      single: ./gradlew test --tests {file}
      all: ./gradlew test
      report: junit
      report_path: build/test-results/**/*.xml
`;

describe('createConfig (ConfigSource)', () => {
  it('parses and normalises .reprise.yml text', async () => {
    const config = createConfig({ read: async () => REPRISE_YML, location: () => 'mem/.reprise.yml' });
    const r = await config.load();
    assert.equal(r.ok, true, r.ok ? '' : r.error);
    const cfg = config.get()!;
    assert.deepEqual(cfg.issues.labels, ['bug', 'crash']);
    assert.deepEqual(cfg.defaults.trials, { min: 5, max: 5, limit: 100, max_minutes: null });
    assert.equal(config.getPath(), 'mem/.reprise.yml');
  });

  it('reports a missing file', async () => {
    const config = createConfig({ read: async () => null, location: () => 'repo/.reprise.yml' });
    const r = await config.load();
    assert.equal(r.ok, false);
    assert.match(r.ok ? '' : r.error, /No \.reprise\.yml found at repo\/\.reprise\.yml/);
  });

  it('invalidates its cache when the source reports a change', async () => {
    const changed = new Emitter<void>();
    const source: ConfigSource = { read: async () => REPRISE_YML, location: () => null, onDidChange: changed.event };
    const config = createConfig(source);
    await config.load();
    assert.ok(config.get());
    changed.fire();
    assert.equal(config.get(), null);
  });

  it('configSourceFromFileSystem reads .reprise.yml at the repository root', async () => {
    const fs = new FakeFileSystem({ '.reprise.yml': REPRISE_YML }, '/repos/demo/');
    const source = configSourceFromFileSystem(fs);
    assert.equal(await source.read(), REPRISE_YML);
    assert.equal(source.location(), '/repos/demo/.reprise.yml');
    assert.equal(await configSourceFromFileSystem(new FakeFileSystem()).read(), null);
  });
});

// ── Workspace over FileSystem ─────────────────────────────────────────────────

describe('createWorkspace (FileSystem)', () => {
  it('reads and writes through the FileSystem', async () => {
    const fs = new FakeFileSystem({ 'a.txt': 'hello' });
    const ws = createWorkspace(fs);
    const r = await ws.readFile('a.txt');
    assert.equal(r.ok && new TextDecoder().decode(r.value), 'hello');
    assert.equal((await ws.writeFile('b.txt', new TextEncoder().encode('x'))).ok, true);
    assert.ok(fs.files.has('b.txt'));
    assert.equal(ws.getRoot(), 'memory:///repo');
  });

  it('wraps read errors and refuses when no repository is linked', async () => {
    const missing = await createWorkspace(new FakeFileSystem()).readFile('nope');
    assert.match(missing.ok ? '' : missing.error, /^Cannot read nope: File not found/);

    const unlinked = createWorkspace(new FakeFileSystem({}, null));
    const r = await unlinked.readFile('a.txt');
    assert.equal(r.ok ? '' : r.error, 'No repository is linked.');
  });

  it('sha256 hashes only the bytes in a view, not the whole backing buffer', async () => {
    const backing = new TextEncoder().encode('xxhelloyy');
    const view = backing.subarray(2, 7);
    const expected = createHash('sha256').update('hello').digest('hex');
    assert.equal(await createWorkspace(new FakeFileSystem()).sha256(view), expected);
  });
});

// ── Runner client options + notifier ──────────────────────────────────────────

describe('createRunnerClient (options, notifier)', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('probes from the configured start port and emits status on disconnect', async () => {
    const urls: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      urls.push(String(input));
      throw new Error('fetch failed: ECONNREFUSED');
    }) as typeof fetch;

    const notifier = new FakeNotifier();
    const svc = buildFakeCore({ notifier });
    const client = createRunnerClient(svc, { startPort: 50100 });

    const r = await client.pair('123456');
    assert.equal(r.ok, false);
    assert.equal(urls[0], 'http://127.0.0.1:50100/pair');
    assert.equal(urls.length, 10);
    assert.equal(urls[9], 'http://127.0.0.1:50109/pair');

    await client.disconnect();
    assert.deepEqual(notifier.events.at(-1), { type: 'status', text: 'Reprise Runner: disconnected' });
  });
});

// ── Provider injection ────────────────────────────────────────────────────────

describe('createProviders (options)', () => {
  const agent: Provider = {
    id: 'claude',
    capabilities: { images: false, implemented: true },
    run: async () => ({ json: {}, files: [], usage: { calls: 1, detail: {} }, provider: 'claude', stubbed: false }),
  };

  it('an injected provider replaces the placeholder with the same id and can be made active', () => {
    const providers = createProviders(buildFakeCore(), { providers: [agent], active: 'claude' });
    assert.equal(providers.getActive(), agent);
    assert.equal(providers.list().filter((p) => p.id === 'claude').length, 1);
  });

  it('refuses to activate an unimplemented provider', () => {
    assert.throws(() => createProviders(buildFakeCore(), { active: 'gemini' }), /not implemented/);
  });
});

// ── buildCore ─────────────────────────────────────────────────────────────────

const ALL_KEYS: Array<keyof Services> = [
  'config', 'auth', 'github', 'store', 'workspace', 'notifier', 'approvals',
  'runnerClient', 'executors', 'providers', 'pipeline', 'stats', 'fix', 'verify', 'security',
];

function makeResult(pass: boolean): RunResult {
  const msg = 'AssertionError: expected activity to resume but got DESTROYED';
  return {
    platform: 'android',
    executor: 'local',
    method: 'repo_command',
    exit_code: pass ? 0 : 1,
    timed_out: false,
    duration_ms: 1000,
    tests: pass
      ? [{ id: 'LoginTest.kt::test', status: 'passed', message: '', output: '' }]
      : [{ id: 'LoginTest.kt::test', status: 'failed', message: msg, output: '' }],
    output_tail: pass ? '' : msg,
    host_os: 'linux',
    device: 'emulator-5554',
    ci_run_url: null,
    runner_version: '0.1.0-test',
  };
}

/** Executor that always reports the bug reproducing. */
const failingExecutor: Executor = {
  id: 'local',
  available: async () => ({ available: true }),
  run: async (req) => Array.from({ length: req.runs }, () => makeResult(false)),
};

/** A repository with .reprise.yml and stub-provider fixtures for issue #7. */
function demoRepo(): FakeFileSystem {
  const stubs = '.reprise/stubs/7';
  return new FakeFileSystem({
    '.reprise.yml': REPRISE_YML.replace('trials: 5', 'trials: { min: 10, max: 20 }'),
    [`${stubs}/intake.json`]: JSON.stringify({
      fingerprint: {
        platform: 'android', component: 'auth', functions: ['BiometricManager.authenticate'],
        symptom: 'App crashes after biometric prompt', trigger: 'Lock screen during biometric',
        expected: 'Activity resumes', actual: 'Activity destroyed',
        error_signature: 'expected activity to resume but got DESTROYED',
      },
      attempt_possible: true, missing: [], question: '',
    }),
    [`${stubs}/test.json`]: JSON.stringify({
      test_file: 'app/src/androidTest/LoginTest.kt',
      signature: { kind: 'assertion_message', pattern: 'expected activity to resume but got DESTROYED' },
      rationale: 'Reproduces the biometric crash',
    }),
    [`${stubs}/test/app/src/androidTest/LoginTest.kt`]: 'fun testBiometricLogin() {}\n',
    [`${stubs}/rootcause.json`]: JSON.stringify({
      summary: 'Activity lifecycle not checked in BiometricPrompt callback',
      locations: [{ file: 'app/src/main/java/LoginActivity.kt', start_line: 47, end_line: 55, reason: 'no lifecycle guard' }],
      fix_direction: 'Add isFinishing() check',
      confidence: 'high',
    }),
  });
}

describe('buildCore', () => {
  it('populates every Services slot and defaults approvals to deny', async () => {
    const core = buildCore({ fileSystem: new FakeFileSystem(), tokenStore: createMemoryTokenStore('t') });
    for (const key of ALL_KEYS) {
      assert.ok(core[key], `${key} must be set`);
    }
    assert.equal(
      await core.approvals.approveFix({ repo: 'o/r', issue: 1, candidate: 1, summary: '', files: [] }),
      false,
    );
    assert.equal(core.auth.getToken(), 't');
  });

  it('uses overrides in place of the real services', () => {
    const github = new FakeGitHub();
    const workspace = new FakeWorkspace();
    const core = buildCore({
      fileSystem: new FakeFileSystem(),
      tokenStore: createMemoryTokenStore(),
      overrides: { github, workspace },
    });
    assert.equal(core.github, github);
    assert.equal(core.workspace, workspace);
  });

  it('drives a full pipeline run with fakes: real pipeline, stats, stub provider', async () => {
    const fs = demoRepo();
    const notifier = createNotifier();
    const events: CoreEvent[] = [];
    notifier.onEvent((e) => events.push(e));

    const core = buildCore({
      fileSystem: fs,
      tokenStore: createMemoryTokenStore('fake-token'),
      notifier,
      overrides: {
        github: new FakeGitHub(),
        store: new FakeIssueStore(),
        executors: { local: failingExecutor, ci: new FakeExecutor('ci') },
      },
    });

    const loaded = await core.config.load();
    assert.equal(loaded.ok, true, loaded.ok ? '' : loaded.error);

    const source = new CancellationTokenSource();
    const result = await core.pipeline.acknowledge('demo-owner/demo-app', 7, undefined, source.token);
    assert.equal(result.ok, true, result.ok ? '' : result.error);
    const record = result.ok ? result.value : null;
    assert.equal(record?.state, 'CONFIRMED');
    assert.equal(record?.replication.verdict, 'CONFIRMED');
    assert.equal(record?.replication.repro.test_file, 'app/src/androidTest/LoginTest.kt');

    // The stub provider's proposed test was written through the injected FileSystem.
    assert.ok(fs.files.has('app/src/androidTest/LoginTest.kt'));

    // Watchers were told about the record as it progressed.
    const updates = events.filter((e) => e.type === 'record.updated');
    assert.ok(updates.length > 0);
    assert.deepEqual(updates.at(-1), { type: 'record.updated', repo: 'demo-owner/demo-app', issue: 7, state: 'CONFIRMED' });
  });

  it('stops the pipeline when the token is cancelled', async () => {
    const source = new CancellationTokenSource();
    const core = buildCore({
      fileSystem: demoRepo(),
      tokenStore: createMemoryTokenStore('fake-token'),
      overrides: {
        github: new FakeGitHub(),
        store: new FakeIssueStore(),
        executors: { local: failingExecutor, ci: new FakeExecutor('ci') },
      },
    });
    await core.config.load();
    source.cancel();
    const result = await core.pipeline.acknowledge('demo-owner/demo-app', 7, undefined, source.token);
    assert.equal(result.ok ? '' : result.error, 'Cancelled');
  });
});

// ── Fix approval gate ─────────────────────────────────────────────────────────

describe('fix.applySelected consults ApprovalService', () => {
  async function coreWithSelectedCandidate(approvals: FakeApprovals) {
    const store = new FakeIssueStore();
    const github = new FakeGitHub();
    const core = buildCore({
      fileSystem: demoRepo(),
      tokenStore: createMemoryTokenStore('fake-token'),
      approvals,
      overrides: { github, store, executors: { local: failingExecutor, ci: new FakeExecutor('ci') } },
    });
    await core.config.load();
    const ack = await core.pipeline.acknowledge('demo-owner/demo-app', 7);
    assert.equal(ack.ok, true);
    const record = ack.ok ? ack.value : null!;
    record.fix.iterations.push({
      n: 1,
      branch: 'reprise/fix-7',
      pr: null,
      pr_draft: true,
      head_sha: null,
      candidates: [{
        k: 1, status: 'selected', summary: 'Guard lifecycle', files_changed: ['app/src/main/java/LoginActivity.kt'],
        diff: '', risk_notes: '', quick_check: null,
      }],
      verification: null,
      review: null,
    } as unknown as typeof record.fix.iterations[number]);
    await store.save(record);
    return core;
  }

  it('refuses to apply when the host denies approval', async () => {
    const approvals = new FakeApprovals(false);
    const core = await coreWithSelectedCandidate(approvals);
    const r = await core.fix.applySelected('demo-owner/demo-app', 7);
    assert.equal(r.ok ? '' : r.error, 'Fix application rejected by user.');
    assert.deepEqual(approvals.requests, [{
      repo: 'demo-owner/demo-app', issue: 7, candidate: 1, summary: 'Guard lifecycle',
      files: ['app/src/main/java/LoginActivity.kt'],
    }]);
  });

  it('opens the PR when approved', async () => {
    const core = await coreWithSelectedCandidate(new FakeApprovals(true));
    const r = await core.fix.applySelected('demo-owner/demo-app', 7);
    assert.equal(r.ok, true, r.ok ? '' : r.error);
    assert.equal(r.ok && r.value.state, 'VERIFYING');
  });
});
