// handlers.ts — seams for the agentic proposal (#32) and PR creation (#34).
// Routes call these; the defaults are stubs until those issues provide real implementations.

import type { CoreServices } from '@reprise/core';
import type { PrCreated, PrRequest, Proposal } from './api/types';

export interface HandlerContext {
  core: CoreServices;
  repo: string;
  issue: number;
  token: string;
}

export interface ProposeHandler {
  propose(ctx: HandlerContext): Promise<Proposal>;
}

export interface PrHandler {
  createPr(ctx: HandlerContext, input: PrRequest): Promise<PrCreated>;
}

/** Thrown by a handler that is not wired yet; routes map it to 501. */
export class NotImplementedError extends Error {}

/** Until #32: build a proposal from the record's diagnosis, with no diff. */
export const diagnosisProposeHandler: ProposeHandler = {
  async propose({ core, repo, issue }) {
    const loaded = await core.store.load(repo, issue);
    if (!loaded.ok) { throw new Error(loaded.error); }
    if (!loaded.value) { throw new Error(`No record for ${repo}#${issue}: acknowledge the issue first.`); }
    const d = loaded.value.replication.diagnosis;
    return {
      locations: d.locations,
      root_cause: d.summary,
      fix_direction: d.fix_direction,
      confidence: d.confidence,
      diff: '',
      pr_draft: { title: `Fix #${issue}: ${loaded.value.title}`, body: `Fixes #${issue}.\n\n${d.summary}` },
    };
  },
};

/** Until #34: PR creation is not available. */
export const notImplementedPrHandler: PrHandler = {
  async createPr() {
    throw new NotImplementedError('PR creation is not implemented yet (#34).');
  },
};
