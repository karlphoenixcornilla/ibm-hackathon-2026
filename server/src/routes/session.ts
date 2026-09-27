// routes/session.ts — exchange a GitHub token for an in-memory session (httpOnly cookie).

import type { FastifyInstance } from 'fastify';
import { requireSession, SESSION_COOKIE } from '../session';
import type { AppContext } from '../app';
import type { SessionRequest } from '../api/types';

export async function sessionRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const cookieOpts = {
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: ctx.config.secureCookies,
    path: '/api',
  };

  app.post<{ Body: SessionRequest }>('/api/session', {
    schema: {
      body: {
        type: 'object',
        required: ['token'],
        properties: { token: { type: 'string', minLength: 1 } },
      },
    },
  }, async (req, reply) => {
    const login = await ctx.validateToken(req.body.token);
    if (!login) { return reply.code(401).send({ error: 'GitHub rejected the token.' }); }
    if (req.session) { ctx.sessions.delete(req.session.id); }
    const session = ctx.sessions.create(req.body.token, login);
    reply.setCookie(SESSION_COOKIE, session.id, cookieOpts);
    return { login };
  });

  app.get('/api/session', async (req) => ({ login: requireSession(req).login }));

  app.delete('/api/session', async (req, reply) => {
    ctx.sessions.delete(requireSession(req).id);
    reply.clearCookie(SESSION_COOKIE, cookieOpts);
    return reply.code(204).send();
  });
}

/** Real-mode validator: GET /user with the token; return the login, or null on non-200. */
export async function validateWithGitHub(token: string): Promise<string | null> {
  const res = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
  });
  if (!res.ok) { return null; }
  const body = (await res.json()) as { login?: string };
  return body.login ?? null;
}
