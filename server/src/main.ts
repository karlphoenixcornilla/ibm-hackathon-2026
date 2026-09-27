// main.ts — process entrypoint: env → app → listen. Real mode by default; REPRISE_MOCK=1 for mock.

import { buildApp } from './app';
import { loadConfig } from './config';
import { mockCoreFactory, realCoreFactory } from './core-factory';
import { diagnosisProposeHandler, notImplementedPrHandler } from './handlers';
import { MockWorld, mockPrHandler, mockProposeHandler, mockValidateToken } from './mock';
import { validateWithGitHub } from './routes/session';

async function main(): Promise<void> {
  const config = loadConfig();
  const mock = config.mode === 'mock';
  const app = await buildApp({
    config,
    coreFactory: mock
      ? mockCoreFactory(new MockWorld({ relay: config.mockRelay }), config.relayTimeoutMs)
      : realCoreFactory(config.relayTimeoutMs),
    validateToken: mock ? mockValidateToken : validateWithGitHub,
    propose: mock ? mockProposeHandler : diagnosisProposeHandler,
    pr: mock ? mockPrHandler : notImplementedPrHandler,
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
