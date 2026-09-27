// routes/runs.ts — run status, the SSE event stream, and the relay's result endpoint.

import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app';
import type { ExecResult } from '../api/types';
import { requireSession } from '../session';

interface RunParams { id: string }
interface ExecParams extends RunParams { reqId: string }

/** Keep idle proxies (Render's included) from closing a quiet stream. */
const HEARTBEAT_MS = 15_000;

const execResultBody = {
  oneOf: [
    { type: 'object', required: ['ok', 'results'], properties: { ok: { const: true }, results: { type: 'array', items: { type: 'object' } } } },
    { type: 'object', required: ['ok', 'error'], properties: { ok: { const: false }, error: { type: 'string' } } },
  ],
};

export async function runRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get<{ Params: RunParams }>('/api/runs/:id', async (req, reply) => {
    const run = ctx.runs.get(req.params.id, requireSession(req).id);
    if (!run) { return reply.code(404).send({ error: 'Run not found' }); }
    return run.status();
  });

  app.get<{ Params: RunParams }>('/api/runs/:id/events', async (req, reply) => {
    const run = ctx.runs.get(req.params.id, requireSession(req).id);
    if (!run) { return reply.code(404).send({ error: 'Run not found' }); }

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    let closed = false;
    const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
    heartbeat.unref();
    // subscribe() replays synchronously, before `unsubscribe` is assigned, so a terminal
    // event only schedules close() for after subscribe() returns.
    const unsubscribe = run.subscribe((event) => {
      if (closed) { return; }
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      if (event.type === 'run.done' || event.type === 'run.failed') { queueMicrotask(close); }
    });
    function close(): void {
      if (closed) { return; }
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      res.end();
    }
    req.raw.on('close', close);
  });

  app.post<{ Params: ExecParams; Body: ExecResult }>('/api/runs/:id/exec/:reqId', {
    schema: { body: execResultBody },
  }, async (req, reply) => {
    const run = ctx.runs.get(req.params.id, requireSession(req).id);
    if (!run || !run.settleExec(req.params.reqId, req.body)) {
      return reply.code(404).send({ error: 'No pending request with that id' });
    }
    return reply.code(204).send();
  });
}
