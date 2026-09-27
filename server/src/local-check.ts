// local-check.ts — apply a fix on the user's runner and test it there (issue #31).
// The fix is staged next to the reproduction test and sent as an overlay on the runner's
// HEAD; the tests run on a worktree. The user's clone is never modified.

import { createHash } from 'node:crypto';
import { buildRegressionSection } from '@reprise/core';
import type { VerificationRegression } from '@reprise/core';
import type { LocalCheck } from './api/types';
import type { CheckContext, CheckHandler } from './handlers';
import { applyUnifiedDiff } from './patch';

export const REACKNOWLEDGE_MESSAGE =
  'The reproduction test for this issue is no longer staged (the server restarted or slept). ' +
  'Acknowledge this issue again, then test the fix.';

/** edit_scope.never when .reprise.yml doesn't set it (matches core and the runner). */
const DEFAULT_NEVER = ['.github/**', '.reprise.yml', '.reprise/**'];

/** Same glob dialect as the runner: `**` spans directories, `*` does not. */
function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '§DSTAR§')
    .replace(/\*/g, '[^/]*')
    .replace(/§DSTAR§/g, '.*');
  return new RegExp(`^${escaped}$`);
}

const matchesAny = (path: string, globs: string[]) => globs.some((g) => globToRegExp(g).test(path));
const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const noop = () => undefined;

export async function runLocalCheck(ctx: CheckContext): Promise<LocalCheck> {
  const { core, runner, executor, repo, issue, cancel } = ctx;
  if (!runner) { throw new Error('Connect your local runner to test a fix locally.'); }
  const status = (text: string) => core.notifier.emit({ type: 'status', text });

  const loaded = await core.store.load(repo, issue);
  if (!loaded.ok) { throw new Error(loaded.error); }
  const record = loaded.value;
  if (!record) { throw new Error(`No record for ${repo}#${issue}: acknowledge the issue first.`); }
  const repro = record.replication.repro;
  if (!repro.test_file) { throw new Error(`${repo}#${issue} has no reproduction test yet: acknowledge the issue first.`); }
  if (!runner.stage.has(repro.test_file)) {
    // A test committed in the repository is fine; a generated one must still be staged.
    try {
      await runner.relay.readFile(repro.test_file, runner.head);
    } catch {
      throw new Error(REACKNOWLEDGE_MESSAGE);
    }
  }

  const config = core.config.get();
  status('Applying the fix on your runner');
  runner.stage.setFix([]); // read originals without the previous fix
  const files = await applyUnifiedDiff(ctx.diff, async (path) => {
    const read = await core.workspace.readFile(path);
    if (!read.ok) { throw new Error(read.error); }
    return new TextDecoder().decode(read.value);
  });
  const fixScope = config?.edit_scope.fix ?? [];
  const neverScope = config?.edit_scope.never ?? DEFAULT_NEVER;
  for (const f of files) {
    if (f.path === repro.test_file) { throw new Error(`The fix must not change the reproduction test (${f.path}).`); }
    if (matchesAny(f.path, neverScope)) { throw new Error(`${f.path} is in edit_scope.never and cannot be changed.`); }
    if (fixScope.length > 0 && !matchesAny(f.path, fixScope)) { throw new Error(`${f.path} is outside edit_scope.fix.`); }
  }
  runner.stage.setFix(files);

  const platform = repro.run_context.platform;
  const runs = Math.max(1, config?.fix.quick_runs ?? 3);
  status(`Running the reproduction test ×${runs} with the fix`);
  const reproResults = await executor.run(
    { platform, mode: 'single', test_path: repro.test_file, runs, ref: null }, cancel, noop,
  );
  const failed = reproResults.filter((r) => core.stats.classifyTrial(r, repro.signature) !== 'PASS').length;
  const fixed = reproResults.length > 0 && failed === 0;

  let regression: VerificationRegression | null = null;
  if (config?.platforms[platform]?.test?.all) {
    status('Running the test suite without the fix');
    const base = await executor.run(
      { platform, mode: 'all', test_path: '', runs: 1, ref: { base: runner.head } }, cancel, noop,
    );
    status('Running the test suite with the fix');
    const head = await executor.run({ platform, mode: 'all', test_path: '', runs: 1, ref: null }, cancel, noop);
    regression = buildRegressionSection(base, head);
  }

  const verdict: LocalCheck['verdict'] = !fixed
    ? 'FIX_INCOMPLETE'
    : regression && regression.blocking.length > 0 ? 'REGRESSION_DETECTED' : 'FIX_VERIFIED';

  return {
    base_sha: runner.head,
    overlay_id: (await executor.overlayId()) ?? '',
    files: files.map((f) => ({ path: f.path, sha256: sha256(f.content) })),
    repro: { test_file: repro.test_file, runs: reproResults.length, failed, fixed },
    regression,
    verdict,
  };
}

export const localCheckHandler: CheckHandler = { check: runLocalCheck };
