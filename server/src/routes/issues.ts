// routes/issues.ts — repository issues and the issue-scoped operations.

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppContext } from '../app';
import type { AcknowledgeRequest, CheckRequest, PrRequest, RunAccepted, RunKind } from '../api/types';
import { NotImplementedError } from '../handlers';
import type { RelayExecutor } from '../relay-executor';
import type { Run } from '../runs';
import { requireSession } from '../session';
import type { Session } from '../session';

interface RepoParams { owner: string; repo: string }
interface IssueParams extends RepoParams { n: number }

const NAME = { type: 'string', pattern: '^[A-Za-z0-9_.-]+$' };
const repoParams = { type: 'object', required: ['owner', 'repo'], properties: { owner: NAME, repo: NAME } };
const issueParams = {
  type: 'object',
  required: ['owner', 'repo', 'n'],
  properties: { owner: NAME, repo: NAME, n: { type: 'integer', minimum: 1 } },
};
const prBody = {
  type: 'object',
  required: ['diff', 'title', 'body', 'draft'],
  properties: {
    diff: { type: 'string' },
    title: { type: 'string', minLength: 1 },
    body: { type: 'string' },
    draft: { type: 'boolean' },
  },
};

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const repoOf = (p: RepoParams) => `${p.owner}/${p.repo}`;

export async function issueRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  /** Start background work as a run; the client follows it via /api/runs/:id. */
  function start(session: Session, kind: RunKind, repo: string, issue: number, work: (run: Run) => Promise<void>): RunAccepted {
    const run = ctx.runs.create(session.id, kind, repo, issue);
    work(run).catch((err) => run.fail(message(err)));
    return { runId: run.id };
  }

  function coreFor(req: FastifyRequest, repo: string) {
    return ctx.coreFactory({ token: requireSession(req).token, repo });
  }

  app.get<{ Params: RepoParams }>('/api/repos/:owner/:repo/issues', { schema: { params: repoParams } }, async (req, reply) => {
    const repo = repoOf(req.params);
    const core = coreFor(req, repo);
    await core.config.load(); // labels come from .reprise.yml; defaults to ['bug'] without one
    const res = await core.github.listIssues(repo);
    if (!res.ok) { return reply.code(502).send({ error: res.error }); }
    return res.value;
  });

  app.get<{ Params: IssueParams }>('/api/repos/:owner/:repo/issues/:n/record', { schema: { params: issueParams } }, async (req, reply) => {
    const repo = repoOf(req.params);
    const res = await coreFor(req, repo).store.load(repo, req.params.n);
    if (!res.ok) { return reply.code(502).send({ error: res.error }); }
    if (!res.value) { return reply.code(404).send({ error: `No record for ${repo}#${req.params.n}` }); }
    return res.value;
  });

  app.post<{ Params: IssueParams; Body: AcknowledgeRequest | undefined }>('/api/repos/:owner/:repo/issues/:n/acknowledge', {
    schema: { params: issueParams, body: { type: ['object', 'null'], properties: { trials: { type: 'object' } } } },
  }, async (req, reply) => {
    const session = requireSession(req);
    const repo = repoOf(req.params);
    const issue = req.params.n;
    const trials = req.body?.trials;
    return reply.code(202).send(start(session, 'acknowledge', repo, issue, async (run) => {
      // A fresh acknowledge starts from nothing staged: the generated test lands here.
      const stage = ctx.staging.reset(repo, issue);
      const runner = await ctx.connectRunner?.(run, repo, stage);
      const core = ctx.coreFactory({ token: session.token, repo, run, runner });
      await core.config.load();
      const res = await core.pipeline.acknowledge(repo, issue, trials, run.token);
      if (res.ok) { run.succeed({ record: res.value }); } else { run.fail(res.error); }
    }));
  });

  app.post<{ Params: IssueParams }>('/api/repos/:owner/:repo/issues/:n/propose', { schema: { params: issueParams } }, async (req, reply) => {
    const session = requireSession(req);
    const repo = repoOf(req.params);
    const issue = req.params.n;
    return reply.code(202).send(start(session, 'propose', repo, issue, async (run) => {
      const core = ctx.coreFactory({ token: session.token, repo, run });
      await core.config.load();
      run.succeed({ proposal: await ctx.propose.propose({ core, repo, issue, token: session.token }) });
    }));
  });

  app.post<{ Params: IssueParams; Body: CheckRequest }>('/api/repos/:owner/:repo/issues/:n/check', {
    schema: {
      params: issueParams,
      body: { type: 'object', required: ['diff'], properties: { diff: { type: 'string', minLength: 1 } } },
    },
  }, async (req, reply) => {
    const session = requireSession(req);
    const repo = repoOf(req.params);
    const issue = req.params.n;
    const diff = req.body.diff;
    return reply.code(202).send(start(session, 'check', repo, issue, async (run) => {
      const runner = await ctx.connectRunner?.(run, repo, ctx.staging.for(repo, issue));
      const core = ctx.coreFactory({ token: session.token, repo, run, runner });
      await core.config.load();
      const executor = core.executors.local as RelayExecutor;
      run.succeed({
        check: await ctx.check.check({ core, repo, issue, token: session.token, diff, runner, executor, cancel: run.token }),
      });
    }));
  });

  app.post<{ Params: IssueParams; Body: PrRequest }>('/api/repos/:owner/:repo/issues/:n/pr', {
    schema: { params: issueParams, body: prBody },
  }, async (req, reply) => {
    const repo = repoOf(req.params);
    const issue = req.params.n;
    try {
      const core = coreFor(req, repo);
      await core.config.load();
      const created = await ctx.pr.createPr({ core, repo, issue, token: requireSession(req).token }, req.body);
      return reply.code(201).send(created);
    } catch (err) {
      if (err instanceof NotImplementedError) { return reply.code(501).send({ error: err.message }); }
      return reply.code(502).send({ error: message(err) });
    }
  });
}
