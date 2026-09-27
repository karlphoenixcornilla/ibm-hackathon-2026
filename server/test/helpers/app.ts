// Builds a mock-mode app for route tests.
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app';
import type { AppOptions } from '../../src/app';
import { loadConfig } from '../../src/config';
import { MockWorld, mockPrHandler, mockProposeHandler, mockValidateToken } from '../../src/mock';
import type { MockOptions } from '../../src/mock';
import { mockCoreFactory } from '../../src/core-factory';
import type { RunStatus } from '../../src/api/types';

export async function mockApp(overrides: Partial<AppOptions> = {}, world: MockOptions = {}): Promise<FastifyInstance> {
  const config = { ...loadConfig({ REPRISE_MOCK: '1' }), relayTimeoutMs: 5000 };
  return buildApp({
    config,
    coreFactory: mockCoreFactory(new MockWorld({ stepMs: 0, ...world }), config.relayTimeoutMs),
    validateToken: mockValidateToken,
    propose: mockProposeHandler,
    pr: mockPrHandler,
    logger: false,
    ...overrides,
  });
}

/** Sign in and return the cookie header value to send on later requests. */
export async function signIn(app: FastifyInstance, token = 'tok'): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/session', payload: { token } });
  if (res.statusCode !== 200) { throw new Error(`sign-in failed: ${res.statusCode} ${res.body}`); }
  const c = res.cookies.find((x) => x.name === 'reprise_sid');
  if (!c) { throw new Error('no session cookie'); }
  return `reprise_sid=${c.value}`;
}

/** Poll GET /api/runs/:id until the run leaves `running`. */
export async function waitForRun(app: FastifyInstance, cookie: string, runId: string): Promise<RunStatus> {
  for (let i = 0; i < 200; i++) {
    const res = await app.inject({ method: 'GET', url: `/api/runs/${runId}`, headers: { cookie } });
    const st = res.json() as RunStatus;
    if (st.state !== 'running') { return st; }
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('run did not finish');
}
