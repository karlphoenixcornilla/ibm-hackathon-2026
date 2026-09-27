// main.ts — process entrypoint: env → app → listen. Real mode by default; REPRISE_MOCK=1 for mock.

import { buildApp } from './app';
import type { AppOptions } from './app';
import { loadConfig } from './config';
import { mockCoreFactory, realCoreFactory } from './core-factory';
import { diagnosisProposeHandler, notImplementedPrHandler } from './handlers';
import { localCheckHandler } from './local-check';
import { MockWorld, mockCheckHandler, mockPrHandler, mockProposeHandler, mockValidateToken } from './mock';
import { connectRunner } from './repo-context';
import { validateWithGitHub } from './routes/session';

/** How long a run waits for the Review UI to attach before giving up on the runner. */
const CONNECT_GRACE_MS = 10_000;

async function main(): Promise<void> {
  const config = loadConfig();
  const mock = config.mode === 'mock';

  // Real mode always goes through the user's runner; mock mode only when exercising the relay,
  // and then without the same-repo check (the demo repo isn't what the runner serves).
  const useRunner = !mock || config.mockRelay;
  const connector: AppOptions['connectRunner'] = useRunner
    ? (run, repo, stage) => connectRunner(run, repo, stage, {
      graceMs: CONNECT_GRACE_MS, timeoutMs: config.relayTimeoutMs, checkRepo: !mock,
    })
    : undefined;

  const app = await buildApp({
    config,
    coreFactory: mock
      ? mockCoreFactory(new MockWorld({ relay: config.mockRelay }), config.relayTimeoutMs)
      : realCoreFactory(config.relayTimeoutMs),
    validateToken: mock ? mockValidateToken : validateWithGitHub,
    propose: mock ? mockProposeHandler : diagnosisProposeHandler,
    pr: mock ? mockPrHandler : notImplementedPrHandler,
    check: mock ? mockCheckHandler : localCheckHandler,
    connectRunner: connector,
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => { void app.close().then(() => process.exit(0)); });
  }

  await app.listen({ port: config.port, host: config.host });
  app.log.info({ mode: config.mode, webDir: config.webDir, allowedOrigins: config.allowedOrigins }, 'reprise server ready');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
