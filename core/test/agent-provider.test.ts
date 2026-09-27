// agent-provider.test.ts — the real agentic provider (pivot #32).
// Uses an injected fetch so no network is touched.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { AgentProvider, DEFAULT_AGENT_URL } from '../src/providers/agent-provider';
import { isTrustedUrl } from '../src/security/security';
import type { StageRequest } from '../src/contracts/provider';
import type { CancellationToken } from '../src/contracts/events';

const noToken: CancellationToken = {
  isCancellationRequested: false,
  onCancellationRequested: () => ({ dispose() {} }),
};

function req(stage: StageRequest['stage'], vars: Record<string, string> = {}): StageRequest {
  return { stage, issue: 7, repo: 'acme/app', vars, attempt: 1 };
}

/** Build a fake fetch that returns the given assistant text as { text }. */
function fakeFetch(text: string, opts: { status?: number; capture?: (req: unknown) => void } = {}) {
  const status = opts.status ?? 200;
  return (async (_url: string, init: RequestInit) => {
    opts.capture?.(JSON.parse(String(init.body)));
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => ({ text }),
      text: async () => text,
    } as unknown as Response;
  }) as typeof fetch;
}

describe('AgentProvider', () => {
  it('parses a valid intake completion into a schema-valid StageResponse', async () => {
    const intake = JSON.stringify({
      fingerprint: {
        platform: 'android', component: 'login', functions: ['authenticate'],
        symptom: 'crash', trigger: 'tap login', expected: 'home screen',
        actual: 'app closes', error_signature: 'NullPointerException',
      },
      attempt_possible: true, missing: [], question: '',
    });
    const p = new AgentProvider({ url: DEFAULT_AGENT_URL, fetchImpl: fakeFetch(intake) });
    const res = await p.run(req('intake'), noToken);
    assert.equal(res.provider, 'bedrock');
    assert.equal(res.stubbed, false);
    assert.equal(res.files.length, 0);
    assert.equal((res.json as { attempt_possible: boolean }).attempt_possible, true);
    assert.equal(res.usage.calls, 1);
  });

  it('strips markdown fences and separates files for the test stage', async () => {
    const body =
      '```json\n' +
      JSON.stringify({
        test_file: 'app/src/test/LoginTest.kt',
        signature: { kind: 'assertion_message', pattern: 'NullPointerException' },
        rationale: 'reproduces the crash',
        files: [{ path: 'app/src/test/LoginTest.kt', content: 'class LoginTest {}' }],
      }) +
      '\n```';
    const p = new AgentProvider({ fetchImpl: fakeFetch(body) });
    const res = await p.run(req('test'), noToken);
    assert.equal(res.files.length, 1);
    assert.equal(res.files[0].path, 'app/src/test/LoginTest.kt');
    // `files` must have been removed from the validated json
    assert.equal((res.json as Record<string, unknown>)['files'], undefined);
    assert.equal((res.json as { test_file: string }).test_file, 'app/src/test/LoginTest.kt');
  });

  it('sends messages + max_tokens and an Origin the proxy allows', async () => {
    let sent: unknown;
    const p = new AgentProvider({
      fetchImpl: fakeFetch(JSON.stringify({ same_bug: false, reason: 'different component' }), {
        capture: (b) => { sent = b; },
      }),
    });
    await p.run(req('dedupe', { candidate: '3' }), noToken);
    const body = sent as { messages: Array<{ role: string }>; max_tokens: number };
    assert.equal(body.messages[0].role, 'system');
    assert.equal(body.messages[1].role, 'user');
    assert.equal(typeof body.max_tokens, 'number');
  });

  it('throws a clear error on a non-2xx response', async () => {
    const p = new AgentProvider({ fetchImpl: fakeFetch('Forbidden', { status: 403 }) });
    await assert.rejects(() => p.run(req('intake'), noToken), /returned 403/);
  });

  it('honors cancellation', async () => {
    const cancelled: CancellationToken = { ...noToken, isCancellationRequested: true };
    const p = new AgentProvider({ fetchImpl: fakeFetch('{}') });
    await assert.rejects(() => p.run(req('intake'), cancelled), /Cancelled/);
  });
});

describe('isTrustedUrl — Lambda Function URLs', () => {
  it('trusts a lambda-url host', () => {
    assert.equal(isTrustedUrl(DEFAULT_AGENT_URL), true);
    assert.equal(isTrustedUrl('https://abc123.lambda-url.us-east-1.on.aws/'), true);
  });
  it('still rejects unrelated hosts', () => {
    assert.equal(isTrustedUrl('https://evil.example.com/steal'), false);
  });
});
