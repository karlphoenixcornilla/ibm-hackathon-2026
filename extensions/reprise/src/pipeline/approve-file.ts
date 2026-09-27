// pipeline/approve-file.ts — the PD-10 path for a provider-proposed test file:
// edit_scope.test check → diff + user approval → write → register the approval
// with the security service and the runner. Nothing is written or run otherwise.

import type { PipelineContext } from './types';
import { inEditScope } from '../util/glob';

export type ApproveResult = { ok: true; sha256: string } | { ok: false; error: string; rejected: boolean };

export async function approveAndWriteTest(
  ctx: PipelineContext,
  file: { path: string; content: string },
  provider: string
): Promise<ApproveResult> {
  const { services } = ctx;
  const cfg = services.config.get();
  const allowed = cfg?.edit_scope?.test ?? [];
  const never = cfg?.edit_scope?.never ?? [];

  if (!inEditScope(file.path, allowed, never)) {
    return { ok: false, rejected: false, error: `Proposed test ${file.path} is outside edit_scope.test` };
  }

  // Views without approveFile are the in-memory fakes used by unit tests.
  if (services.views.approveFile) {
    const approved = await services.views.approveFile(
      file.path,
      file.content,
      `Reproduction test for #${ctx.issue}, proposed by ${provider}.`
    );
    if (!approved) {
      return { ok: false, rejected: true, error: `You rejected the proposed test ${file.path}` };
    }
  }

  const bytes = new TextEncoder().encode(file.content);
  const write = await services.workspace.writeFile(file.path, bytes);
  if (!write.ok) return { ok: false, rejected: false, error: `Failed to write test file: ${write.error}` };

  const sha256 = await services.workspace.sha256(bytes);
  services.security.recordApproval(file.path, sha256);
  if (services.runnerClient.approve && services.runnerClient.isPaired()) {
    const r = await services.runnerClient.approve(file.path, sha256);
    if (!r.ok) return { ok: false, rejected: false, error: `Runner refused the approval: ${r.error}` };
  }
  ctx.addEvent('test.approved', file.path);
  return { ok: true, sha256 };
}
