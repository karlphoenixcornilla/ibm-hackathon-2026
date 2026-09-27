// routes/static.ts — serve the Review UI with an SPA fallback; unknown /api paths get JSON 404s.

import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';

export async function staticRoutes(app: FastifyInstance, opts: { webDir: string }): Promise<void> {
  // wildcard: false registers one route per file at startup (the UI is a fixed build).
  await app.register(fastifyStatic, { root: opts.webDir, wildcard: false });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/') || req.method !== 'GET') {
      return reply.code(404).send({ error: 'Not found' });
    }
    return reply.type('text/html').sendFile('index.html');
  });
}
