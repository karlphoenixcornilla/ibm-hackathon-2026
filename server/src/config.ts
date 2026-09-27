// config.ts — server configuration from environment variables.

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface ServerConfig {
  port: number;
  host: string;
  mode: 'real' | 'mock';
  /** Origins allowed to make state-changing requests (the deployed site, plus dev servers). */
  allowedOrigins: string[];
  /** Whether to mark the session cookie Secure (true when served over https). */
  secureCookies: boolean;
  /** Directory with the built Review UI. */
  webDir: string;
  relayTimeoutMs: number;
  mockRelay: boolean;
}

/** server/ — compiled files live in server/out/src. */
export const PACKAGE_ROOT = path.resolve(__dirname, '../..');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const port = Number(env['PORT'] ?? 8787);
  const publicOrigin = (
    env['PUBLIC_ORIGIN'] ??
    env['RENDER_EXTERNAL_URL'] ??
    (env['RENDER_EXTERNAL_HOSTNAME'] ? `https://${env['RENDER_EXTERNAL_HOSTNAME']}` : `http://localhost:${port}`)
  ).replace(/\/$/, '');
  const extra = (env['EXTRA_ORIGINS'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const builtUi = path.resolve(PACKAGE_ROOT, '../web/dist');
  return {
    port,
    host: env['HOST'] ?? '0.0.0.0',
    mode: env['REPRISE_MOCK'] === '1' ? 'mock' : 'real',
    allowedOrigins: [publicOrigin, ...extra],
    secureCookies: publicOrigin.startsWith('https://'),
    webDir: env['WEB_DIR'] ?? (fs.existsSync(builtUi) ? builtUi : path.join(PACKAGE_ROOT, 'public')),
    relayTimeoutMs: Number(env['RELAY_TIMEOUT_MS'] ?? 10 * 60 * 1000),
    mockRelay: env['REPRISE_MOCK_RELAY'] === '1',
  };
}
