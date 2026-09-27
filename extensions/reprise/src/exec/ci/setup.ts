// exec/ci/setup.ts — "Reprise: Set Up CI Runs" (PD-14): commit the CI workflow and
// run loop to a branch through the Git Data API and open a PR for the maintainer.
// Spec: 02-specs/test-execution.md §CI executor, 04-fix-verify-and-ci.md task 1

import type { Services } from '../../contracts/services';
import type { Result } from '../../util/result';
import { Result as R } from '../../util/result';
import { CI_TEMPLATES } from './templates';

export const SETUP_BRANCH = 'reprise/setup-ci';

export async function setUpCiRuns(
  services: Pick<Services, 'github'>,
  repo: string,
): Promise<Result<{ pr: string }, string>> {
  const gh = services.github;
  if (!gh.commitFiles || !gh.getDefaultBranch) {
    return R.err('This GitHub service cannot commit files.');
  }

  const base = await gh.getDefaultBranch(repo);
  if (!base.ok) { return R.err(`Could not read the default branch: ${base.error}`); }

  const commit = await gh.commitFiles(
    repo,
    SETUP_BRANCH,
    base.value,
    [...CI_TEMPLATES],
    'Add Reprise CI runs\n\nWorkflow reprise-run.yml (workflow_dispatch only, contents: read) and its run loop.',
  );
  if (!commit.ok) {
    const hint = /workflow/i.test(commit.error)
      ? ' The GitHub token needs the "Workflows: Read and write" permission to add workflow files.'
      : '';
    return R.err(`Could not commit the CI files: ${commit.error}.${hint}`);
  }

  const pr = await gh.createOrUpdatePr(
    repo,
    SETUP_BRANCH,
    base.value,
    'Add Reprise CI runs',
    [
      'This adds the files Reprise needs to run reproduction tests on GitHub Actions:',
      '',
      '- `.github/workflows/reprise-run.yml` — runs only on `workflow_dispatch`, with `contents: read`.',
      '- `.reprise/ci/run-loop.mjs` — runs one test `runs` times and uploads `results/*.json`.',
      '',
      'Nothing runs until someone dispatches the workflow from Reprise IDE. Merge to enable CI runs.',
    ].join('\n'),
    false,
  );
  if (!pr.ok) { return R.err(`Committed to ${SETUP_BRANCH}, but opening the PR failed: ${pr.error}`); }
  return R.ok({ pr: pr.value.html_url });
}
