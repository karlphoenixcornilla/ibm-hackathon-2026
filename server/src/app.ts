// app.ts — assemble the Fastify app. No listen(); main.ts does that, tests use inject().

import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import { SESSION_COOKIE, SessionStore } from './session';
import type { Session } from './session';
import { RunRegistry } from './runs';
import type { CoreFactory } from './core-factory';
import type { PrHandler, ProposeHandler } from './handlers';
import { PACKAGE_ROOT } from './config';
import type { ServerConfig } from './config';
import { sessionRoutes } from './routes/session';
import { issueRoutes } from './routes/issues';
import { runRoutes } from './routes/runs';
import { staticRoutes } from './routes/static';

declare module 'fastify' {
  interface FastifyRequest {
    session: Session | null;
  }
}

export interface AppOptions {
  config: ServerConfig;
  coreFactory: CoreFactory;
  /** Resolve a GitHub token to its login, or null if GitHub rejects it. */
  validateToken(token: string): Promise<string | null>;
  propose: ProposeHandler;
  pr: PrHandler;
  sessions?: SessionStore;
  runs?: RunRegistry;
  /** false to disable logging, or pino options (e.g. { level, stream }). */
  logger?: false | Record<string, unknown>;
}

export interface AppContext extends AppOptions {
  sessions: SessionStore;
  runs: RunRegistry;
}

/** "METHOD /route" pairs reachable without a session. */
const PUBLIC_API = new Set(['GET /api/health', 'GET /api/openapi.json', 'POST /api/session']);
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
/** Never log credentials: the session cookie or any Authorization header. */
const REDACT = ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'];

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const ctx: AppContext = {
    ...options,
    sessions: options.sessions ?? new SessionStore({ idleMs: 60 * 60 * 1000, absoluteMs: 8 * 60 * 60 * 1000 }),
    runs: options.runs ?? new RunRegistry(),
  };

  const app = Fastify({
    logger: options.logger === false ? false : { redact: REDACT, ...options.logger },
    trustProxy: true,
  });

  await app.register(fastifyCookie);
  app.decorateRequest('session', null);

  // CSRF defence in depth (on top of SameSite=Strict): unsafe methods need a known Origin or none.
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/') || !UNSAFE.has(req.method)) { return; }
    const origin = req.headers.origin;
    if (origin && !ctx.config.allowedOrigins.includes(origin)) {
      return reply.code(403).send({ error: 'Origin not allowed' });
    }
  });

  // Attach the session when present; require it for every API route except the public ones.
  // Unknown paths have no route URL and fall through to the 404 handler.
  app.addHook('preHandler', async (req, reply) => {
    req.session = ctx.sessions.get(req.cookies[SESSION_COOKIE]) ?? null;
    const route = req.routeOptions.url;
    if (!route?.startsWith('/api/') || PUBLIC_API.has(`${req.method} ${route}`)) { return; }
    if (!req.session) { return reply.code(401).send({ error: 'Not signed in' }); }
  });

  const spec = yaml.load(fs.readFileSync(path.join(PACKAGE_ROOT, 'openapi.yaml'), 'utf8'));
  app.get('/api/health', async () => ({ ok: true, mode: ctx.config.mode }));
  app.get('/api/openapi.json', async () => spec);

  await sessionRoutes(app, ctx);
  await issueRoutes(app, ctx);
  await runRoutes(app, ctx);
  await staticRoutes(app, { webDir: ctx.config.webDir });

  const sweeper = setInterval(() => { ctx.sessions.sweep(); ctx.runs.sweep(); }, 60_000);
  sweeper.unref();
  app.addHook('onClose', async () => clearInterval(sweeper));

  return app;
}
