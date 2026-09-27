// test/t1.test.ts — Unit tests for T1: GitHub client (mocked fetch), store, .git parsing
// Runs with: node --test (no Node-only APIs in the tested code paths)

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── .git parsing (pure helpers) ───────────────────────
import {
  parseGitConfigOrigin,
  extractOwnerRepo,
  resolveHeadSha,
} from '../src/util/git-helpers';

describe('parseGitConfigOrigin', () => {
  it('extracts https origin url', () => {
    const config = `
[core]
  repositoryformatversion = 0
[remote "origin"]
  url = https://github.com/owner/repo.git
  fetch = +refs/heads/*:refs/remotes/origin/*
[branch "main"]
  remote = origin
`;
    assert.equal(parseGitConfigOrigin(config), 'https://github.com/owner/repo.git');
  });

  it('extracts ssh origin url', () => {
    const config = `[remote "origin"]\n\turl = git@github.com:owner/repo.git\n`;
    assert.equal(parseGitConfigOrigin(config), 'git@github.com:owner/repo.git');
  });

  it('returns null when no origin remote', () => {
    const config = `[core]\n  bare = false\n`;
    assert.equal(parseGitConfigOrigin(config), null);
  });

  it('handles multiple remotes, finds origin', () => {
    const config = `
[remote "upstream"]
  url = https://github.com/other/repo.git
[remote "origin"]
  url = https://github.com/mine/myrepo.git
`;
    assert.equal(parseGitConfigOrigin(config), 'https://github.com/mine/myrepo.git');
  });
});

describe('extractOwnerRepo', () => {
  it('parses HTTPS url without .git', () => {
    assert.equal(extractOwnerRepo('https://github.com/owner/repo'), 'owner/repo');
  });

  it('parses HTTPS url with .git', () => {
    assert.equal(extractOwnerRepo('https://github.com/owner/repo.git'), 'owner/repo');
  });

  it('parses SSH url', () => {
    assert.equal(extractOwnerRepo('git@github.com:owner/repo.git'), 'owner/repo');
  });

  it('returns null for non-github url', () => {
    assert.equal(extractOwnerRepo('https://gitlab.com/owner/repo.git'), null);
  });

  it('returns null for empty string', () => {
    assert.equal(extractOwnerRepo(''), null);
  });
});

describe('resolveHeadSha', () => {
  it('returns SHA directly for detached HEAD', async () => {
    const sha = 'a'.repeat(40);
    const result = await resolveHeadSha(sha, async () => null, '');
    assert.equal(result, sha);
  });

  it('resolves symbolic ref via loose ref file', async () => {
    const sha = 'b'.repeat(40);
    const result = await resolveHeadSha(
      'ref: refs/heads/main',
      async (ref) => (ref === 'refs/heads/main' ? sha + '\n' : null),
      ''
    );
    assert.equal(result, sha);
  });

  it('resolves symbolic ref via packed-refs fallback', async () => {
    const sha = 'c'.repeat(40);
    const packedRefs = `# pack-refs with: peeled fully-peeled sorted\n${sha} refs/heads/main\n`;
    const result = await resolveHeadSha(
      'ref: refs/heads/main',
      async () => null,
      packedRefs
    );
    assert.equal(result, sha);
  });

  it('returns null when ref not found', async () => {
    const result = await resolveHeadSha('ref: refs/heads/missing', async () => null, '');
    assert.equal(result, null);
  });

  it('returns null for unrecognised HEAD content', async () => {
    const result = await resolveHeadSha('not-a-sha-or-ref', async () => null, '');
    assert.equal(result, null);
  });
});

// ── GitHub client (mocked fetch) ──────────────────────────────────────────────
import { createGitHub } from '../src/github/index';
import type { AuthService, ConfigService } from '../src/contracts/services';

function makeAuth(token: string | null): AuthService {
  const emitter = { event: (_: unknown) => ({ dispose: () => {} }) } as unknown;
  return {
    getToken: () => token,
    isSignedIn: () => token !== null,
    signIn: async () => ({ ok: true as const, value: token ?? '' }),
    signOut: async () => {},
    onDidChangeSession: (emitter as { event: AuthService['onDidChangeSession'] }).event,
  };
}

function makeConfig(labels = ['bug']): ConfigService {
  const cfg = {
    version: 3, issues: { labels }, components: [],
    defaults: { executor: 'local' as const, trials: { min: 10, max: 20, limit: 100, max_minutes: null }, max_test_attempts: 3 },
    fix: { candidates: 3, quick_runs: 5, max_rounds: 3, candidate_executor: 'auto' as const, draft_pr: true, self_review: true },
    verify: { min_runs: 3, max_runs: 200, regression_reruns: 3 },
    edit_scope: { test: [], fix: [], never: [] },
    platforms: {},
  };
  return {
    load: async () => ({ ok: true as const, value: cfg }),
    get: () => cfg,
    getPath: () => null,
    invalidate: () => {},
  };
}

/** Minimal fetch mock that records calls and returns scripted responses. */
function mockFetch(responses: Map<string, { status: number; body: unknown }>): typeof fetch {
  return async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    // Match by URL substring
    for (const [key, resp] of responses) {
      if (url.includes(key)) {
        const bodyText = JSON.stringify(resp.body);
        return new Response(bodyText, {
          status: resp.status,
          headers: { 'content-type': 'application/json' },
        });
      }
    }
    return new Response('{"message":"Not Found"}', { status: 404 });
  };
}

describe('GitHubService.listIssues', () => {
  it('filters out pull requests and maps fields', async () => {
    const fakeIssues = [
      { number: 1, title: 'Bug A', html_url: 'https://github.com/o/r/issues/1', state: 'open', labels: [{ name: 'bug' }], created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-02T00:00:00Z' },
      { number: 2, title: 'PR B', html_url: 'https://github.com/o/r/pull/2', state: 'open', labels: [{ name: 'bug' }], created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-02T00:00:00Z', pull_request: {} },
    ];

    const responses = new Map([
      ['/issues?', { status: 200, body: fakeIssues }],
    ]);

    const origFetch = globalThis.fetch;
    (globalThis as Record<string, unknown>)['fetch'] = mockFetch(responses);

    try {
      const gh = createGitHub({
        auth: makeAuth('tok'),
        config: makeConfig(),
        workspaceReader: async () => null,
      });
      const r = await gh.listIssues('o/r');
      assert.ok(r.ok);
      assert.equal(r.value.length, 1);
      assert.equal(r.value[0].number, 1);
      assert.deepEqual(r.value[0].labels, ['bug']);
    } finally {
      (globalThis as Record<string, unknown>)['fetch'] = origFetch;
    }
  });

  it('returns err when not signed in', async () => {
    const gh = createGitHub({
      auth: makeAuth(null),
      config: makeConfig(),
      workspaceReader: async () => null,
    });
    await assert.rejects(() => gh.listIssues('o/r'), /Not signed in/);
  });

  it('returns err on rate limit (403)', async () => {
    const responses = new Map([['/issues?', { status: 403, body: { message: 'API rate limit exceeded' } }]]);
    const origFetch = globalThis.fetch;
    (globalThis as Record<string, unknown>)['fetch'] = mockFetch(responses);
    try {
      const gh = createGitHub({ auth: makeAuth('tok'), config: makeConfig(), workspaceReader: async () => null });
      const r = await gh.listIssues('o/r');
      assert.equal(r.ok, false);
      assert.match(r.error, /rate limit/i);
    } finally {
      (globalThis as Record<string, unknown>)['fetch'] = origFetch;
    }
  });
});

describe('GitHubService.readRecord', () => {
  it('returns null for 404 (no record yet)', async () => {
    const responses = new Map([['/contents/issues/7.json', { status: 404, body: { message: 'Not Found' } }]]);
    const origFetch = globalThis.fetch;
    (globalThis as Record<string, unknown>)['fetch'] = mockFetch(responses);
    try {
      const gh = createGitHub({ auth: makeAuth('tok'), config: makeConfig(), workspaceReader: async () => null });
      const r = await gh.readRecord('o/r', 7);
      assert.ok(r.ok);
      assert.equal(r.value, null);
    } finally {
      (globalThis as Record<string, unknown>)['fetch'] = origFetch;
    }
  });

  it('decodes base64 content and returns parsed record', async () => {
    const record = {
      schema: 3, repo: 'o/r', issue: 7, title: 'Bug', url: 'https://github.com/o/r/issues/7',
      state: 'LISTED', provider: 'stub', stubbed: true, created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z',
    };
    const encoded = btoa(JSON.stringify(record));
    const responses = new Map([['/contents/issues/7.json', { status: 200, body: { content: encoded, encoding: 'base64' } }]]);
    const origFetch = globalThis.fetch;
    (globalThis as Record<string, unknown>)['fetch'] = mockFetch(responses);
    try {
      const gh = createGitHub({ auth: makeAuth('tok'), config: makeConfig(), workspaceReader: async () => null });
      const r = await gh.readRecord('o/r', 7);
      assert.ok(r.ok);
      assert.equal(r.value?.issue, 7);
      assert.equal(r.value?.state, 'LISTED');
    } finally {
      (globalThis as Record<string, unknown>)['fetch'] = origFetch;
    }
  });
});

describe('GitHubService.detectRepo', () => {
  it('parses HTTPS origin from .git/config', async () => {
    const gitConfig = `[core]\n  bare = false\n[remote "origin"]\n  url = https://github.com/owner/testrepo.git\n`;
    const gh = createGitHub({
      auth: makeAuth('tok'),
      config: makeConfig(),
      workspaceReader: async (p) => (p === '.git/config' ? gitConfig : null),
    });
    const r = await gh.detectRepo();
    assert.ok(r.ok);
    assert.equal(r.value, 'owner/testrepo');
  });

  it('returns err when .git/config missing', async () => {
    const gh = createGitHub({ auth: makeAuth('tok'), config: makeConfig(), workspaceReader: async () => null });
    const r = await gh.detectRepo();
    assert.equal(r.ok, false);
    assert.match(r.error, /\.git\/config/);
  });
});

// ── Store validation ──────────────────────────────────────────────────────────
import { FakeGitHub } from '../src/fakes/FakeGitHub';
import { createStore } from '../src/store/index';

describe('createStore', () => {
  it('load returns null when github returns null', async () => {
    const store = createStore({ github: new FakeGitHub() });
    const r = await store.load('demo-owner/demo-app', 999);
    assert.ok(r.ok);
    assert.equal(r.value, null);
  });

  it('getCached returns null before a load', () => {
    const store = createStore({ github: new FakeGitHub() });
    assert.equal(store.getCached('o/r', 1), null);
  });

  it('save rejects a record with wrong schema version', async () => {
    const store = createStore({ github: new FakeGitHub() });
    const bad = { schema: 2, repo: 'o/r', issue: 1, title: 'X', url: 'https://github.com/o/r/issues/1', state: 'LISTED', provider: 'stub', stubbed: false, created_at: '', updated_at: '' };
    const r = await store.save(bad as unknown as import('../src/contracts/records').IssueRecord);
    assert.equal(r.ok, false);
    assert.match(r.error, /schema/);
  });
});
