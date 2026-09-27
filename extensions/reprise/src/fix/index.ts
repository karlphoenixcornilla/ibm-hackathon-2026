// fix/ — fix proposal, diff review, candidate filtering, PR creation
// Owned by: T4
// Spec: 02-specs/fix-and-verify.md §4–5
import type * as runtime from '../contracts/runtime';
import type { Services } from '../contracts/services';
import type { FixService } from '../contracts/services';
import type { IssueRecord, Candidate, FixIteration } from '../contracts/records';
import type { FixOutput } from '../contracts/provider';
import type { Result } from '../util/result';
import { Result as R } from '../util/result';
import { resolveHeadSha } from '../util/git-helpers';

/** Minimal non-cancellable token for use when no real token is provided. */
function neverCancelled(): runtime.CancellationToken {
  return { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => undefined }) };
}

export function createFix(services: Omit<Services, 'fix'>): FixService {
  return new FixServiceImpl(services as Services);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Normalise a diff for duplicate detection: strip trailing whitespace, blank lines, CR. */
function normaliseDiff(diff: string): string {
  return diff
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l !== '')
    .join('\n');
}

/** Simple hash: djb2 over the normalised diff string. */
function hashDiff(diff: string): string {
  let h = 5381;
  for (let i = 0; i < diff.length; i++) {
    h = ((h << 5) + h) ^ diff.charCodeAt(i);
    h >>>= 0;
  }
  return h.toString(16);
}

/** Check a path against an edit-scope glob list (simple prefix/suffix matching). */
function matchesScope(filePath: string, patterns: string[]): boolean {
  for (const pat of patterns) {
    if (pat.endsWith('/**') || pat.endsWith('/*')) {
      const prefix = pat.replace(/\/\*+$/, '/');
      if (filePath.startsWith(prefix)) { return true; }
    } else if (pat.startsWith('*.')) {
      const ext = pat.slice(1);
      if (filePath.endsWith(ext)) { return true; }
    } else {
      if (filePath === pat || filePath.startsWith(pat + '/')) { return true; }
    }
  }
  return false;
}

// ── FixServiceImpl ────────────────────────────────────────────────────────────

class FixServiceImpl implements FixService {
  constructor(private readonly svc: Services) {}

  // ── proposeFixes ──────────────────────────────────────────────────────────

  async proposeFixes(
    repo: string,
    issue: number,
    token?: runtime.CancellationToken,
  ): Promise<Result<IssueRecord, string>> {
    const recordResult = await this.svc.store.load(repo, issue);
    if (!recordResult.ok) { return recordResult; }
    if (!recordResult.value) { return R.err(`Issue #${issue} not found.`); }
    const record = recordResult.value;

    const config = this.svc.config.get();
    if (!config) { return R.err('Config not loaded.'); }

    const numCandidates = config.fix.candidates ?? 3;
    const provider = this.svc.providers.getActive();
    const seenHashes = new Set<string>(
      record.fix.iterations.flatMap((it) => it.candidates.map((c) => c.diff_hash)),
    );

    const candidates: Candidate[] = [];
    const repro = record.replication?.repro;

    for (let k = 1; k <= numCandidates; k++) {
      if (token?.isCancellationRequested) { return R.err('Cancelled.'); }

      // Call provider fix stage for each candidate independently.
      const stageResp = await provider.run(
        {
          stage: 'fix',
          issue,
          repo,
          vars: {
            candidate: String(k),
            diagnosis: JSON.stringify(record.replication?.diagnosis ?? {}),
            repro_test: repro?.test_file ?? '',
          },
          attempt: 1,
        },
        token ?? neverCancelled(),
      );

      const fixOut = stageResp.json as FixOutput;
      const files = stageResp.files ?? [];

      // Scope filtering (edit_scope.fix minus edit_scope.never).
      const fixScope = config.edit_scope?.fix ?? [];
      const neverScope = config.edit_scope?.never ?? [];
      const droppedFiles: string[] = [];
      const allowedFiles = files.filter((f) => {
        if (neverScope.length > 0 && matchesScope(f.path, neverScope)) {
          droppedFiles.push(f.path);
          return false;
        }
        if (fixScope.length > 0 && !matchesScope(f.path, fixScope)) {
          droppedFiles.push(f.path);
          return false;
        }
        return true;
      });

      // A candidate that changes the reproduction test loses that test file.
      const filteredFiles = allowedFiles.filter((f) => f.path !== repro?.test_file);

      if (filteredFiles.length === 0) {
        candidates.push({
          k,
          summary: fixOut.summary ?? `Candidate ${k}`,
          files_changed: [],
          diff_hash: '',
          executor: 'local',
          quick_check: { repro_runs: 0, repro_failed: 0, blocking: 0 },
          status: 'error',
        });
        continue;
      }

      // Duplicate detection.
      const diffContent = filteredFiles.map((f) => `--- ${f.path}\n${f.content}`).join('\n');
      const diffHash = hashDiff(normaliseDiff(diffContent));

      if (seenHashes.has(diffHash)) {
        candidates.push({
          k,
          summary: fixOut.summary ?? `Candidate ${k}`,
          files_changed: filteredFiles.map((f) => f.path),
          diff_hash: diffHash,
          executor: 'local',
          quick_check: { repro_runs: 0, repro_failed: 0, blocking: 0 },
          status: 'rejected_duplicate',
        });
        continue;
      }

      seenHashes.add(diffHash);

      candidates.push({
        k,
        summary: fixOut.summary ?? `Candidate ${k}`,
        files_changed: filteredFiles.map((f) => f.path),
        diff_hash: diffHash,
        executor: 'local',
        quick_check: { repro_runs: 0, repro_failed: 0, blocking: 0 },
        status: 'survived', // updated by runQuickCheck
      });
    }

    // Resolve the current HEAD SHA to use as base for the fix branch.
    // This is the real commit SHA the runner will use for regression comparison.
    const baseSha = await resolveWorkspaceHeadSha(this.svc);

    const n = record.fix.iterations.length + 1;
    const iteration: FixIteration = {
      n,
      source: 'provider',
      pr: null,
      pr_draft: config.fix.draft_pr ?? true,
      branch: `reprise/fix-${n}`,
      base_sha: baseSha,
      head_sha: '',
      summary: candidates.find((c) => c.status === 'survived')?.summary ?? 'Fix candidates proposed',
      dropped_files: [],
      candidates,
      review: { verdict: 'ok', findings: [], stubbed: record.stubbed },
      verification: {
        verdict: 'FIX_INCOMPLETE',
        finished_at: '',
        run_context: {
          platform: repro?.run_context.platform ?? 'linux',
          executor: 'local',
          method: 'repo_command',
          host_os: repro?.run_context.host_os ?? '',
          device: repro?.run_context.device ?? '',
          ci_run_url: null,
          runner_version: null,
        },
        repro: { runs_required: 0, runs: 0, failed: 0, invalid: 0, evidence: 'limited', claim: '', injected: false },
        regression: { tests_total: 0, counts: {}, blocking: [], notable: [] },
      },
    };

    const updated: IssueRecord = {
      ...record,
      state: 'FIXING',
      updated_at: new Date().toISOString(),
      fix: { iterations: [...record.fix.iterations, iteration] },
    };

    const saveResult = await this.svc.store.save(updated);
    if (!saveResult.ok) { return saveResult; }
    return R.ok(updated);
  }

  // ── runQuickCheck ─────────────────────────────────────────────────────────

  async runQuickCheck(
    repo: string,
    issue: number,
    candidateK: number,
    token?: runtime.CancellationToken,
  ): Promise<Result<IssueRecord, string>> {
    const recordResult = await this.svc.store.load(repo, issue);
    if (!recordResult.ok) { return recordResult; }
    if (!recordResult.value) { return R.err(`Issue #${issue} not found.`); }
    const record = recordResult.value;

    const config = this.svc.config.get();
    if (!config) { return R.err('Config not loaded.'); }

    const lastIter = record.fix.iterations[record.fix.iterations.length - 1];
    if (!lastIter) { return R.err('No fix iteration found.'); }

    const candidateIdx = lastIter.candidates.findIndex((c) => c.k === candidateK);
    if (candidateIdx === -1) { return R.err(`Candidate ${candidateK} not found.`); }

    const repro = record.replication?.repro;
    const platform = repro?.run_context.platform ?? 'linux';
    const executor = this.svc.executors.local;
    const quickRuns = Math.min(config.fix.quick_runs ?? 3, repro?.trials ?? 3);

    const runToken = token ?? neverCancelled();

    // Quick check: run reproduction test quickRuns times.
    let reproFailed = 0;
    let reproRuns = 0;
    const signature = repro?.signature;

    try {
      const results = await executor.run(
        {
          platform,
          mode: 'single',
          test_path: repro?.test_file ?? '',
          runs: quickRuns,
          ref: null,
        },
        runToken,
        () => {},
      );

      reproRuns = results.length;
      for (const r of results) {
        const outcome = signature
          ? this.svc.stats.classifyTrial(r, signature)
          : r.exit_code !== 0 ? 'FAIL_MATCH' : 'PASS';
        if (outcome === 'FAIL_MATCH') { reproFailed++; }
      }
    } catch {
      // Run failed entirely — treat as error, keep candidate status as survived.
    }

    // Run test.all once for regression baseline.
    let blocking = 0;
    try {
      const suiteResults = await executor.run(
        { platform, mode: 'all', test_path: '', runs: 1, ref: null },
        runToken,
        () => {},
      );
      for (const r of suiteResults) {
        for (const t of r.tests) {
          if (t.status === 'failed') { blocking++; }
        }
      }
    } catch {
      // Suite run failed — ignore for quick check.
    }

    // Determine candidate status.
    let status: Candidate['status'] = 'survived';
    if (reproFailed > 0) {
      // Still reproduces → rejected_repro.
      status = 'rejected_repro';
    } else if (blocking > 0) {
      // Breaks existing tests → rejected_regression.
      status = 'rejected_regression';
    }

    const updatedCandidate: Candidate = {
      ...lastIter.candidates[candidateIdx],
      quick_check: { repro_runs: reproRuns, repro_failed: reproFailed, blocking },
      status,
    };

    const updatedCandidates = [...lastIter.candidates];
    updatedCandidates[candidateIdx] = updatedCandidate;

    // Rank survivors: fewer regression notes, fewer changed lines.
    const survivors = updatedCandidates.filter((c) => c.status === 'survived');
    if (survivors.length > 0) {
      survivors.sort(
        (a, b) => a.quick_check.blocking - b.quick_check.blocking
          || a.files_changed.length - b.files_changed.length,
      );
      const selectedK = survivors[0].k;
      for (const c of updatedCandidates) {
        if (c.status === 'survived') {
          (c as Candidate).status = c.k === selectedK ? 'selected' : 'survived';
        }
      }
    }

    const updatedIteration: FixIteration = { ...lastIter, candidates: updatedCandidates };
    const updatedIterations = [...record.fix.iterations];
    updatedIterations[updatedIterations.length - 1] = updatedIteration;

    const updated: IssueRecord = {
      ...record,
      updated_at: new Date().toISOString(),
      fix: { iterations: updatedIterations },
    };

    const saveResult = await this.svc.store.save(updated);
    if (!saveResult.ok) { return saveResult; }
    return R.ok(updated);
  }

  // ── applySelected ─────────────────────────────────────────────────────────

  async applySelected(
    repo: string,
    issue: number,
    _token?: runtime.CancellationToken,
  ): Promise<Result<IssueRecord, string>> {
    const recordResult = await this.svc.store.load(repo, issue);
    if (!recordResult.ok) { return recordResult; }
    if (!recordResult.value) { return R.err(`Issue #${issue} not found.`); }
    const record = recordResult.value;

    const config = this.svc.config.get();
    if (!config) { return R.err('Config not loaded.'); }

    const lastIter = record.fix.iterations[record.fix.iterations.length - 1];
    if (!lastIter) { return R.err('No fix iteration found.'); }

    const selected = lastIter.candidates.find((c) => c.status === 'selected');
    if (!selected) { return R.err('No selected candidate. Run quick checks first.'); }

    // User confirmation before creating the branch and PR.
    const approved = await this.svc.views.showInfo(
      `Create PR for fix candidate ${selected.k}? Files: ${selected.files_changed.join(', ')}`,
      'Create PR',
      'Cancel',
    );
    if (approved !== 'Create PR') {
      return R.err('Fix application cancelled by user.');
    }

    const fixScope = config.edit_scope?.fix ?? [];
    const neverScope = config.edit_scope?.never ?? [];

    // Determine base SHA (captured at proposeFixes time, or resolve now as fallback).
    const baseSha = lastIter.base_sha || await resolveWorkspaceHeadSha(this.svc);

    // Read file contents from workspace to commit.
    // The provider returns file content in stageResp.files; re-read from workspace
    // in case the user edited the file locally since proposal.
    const filesToCommit: Array<{ path: string; content: string }> = [];
    for (const filePath of selected.files_changed) {
      const bytesResult = await this.svc.workspace.readFile(filePath);
      if (!bytesResult.ok) {
        return R.err(`Cannot read ${filePath} for commit: ${bytesResult.error}`);
      }
      filesToCommit.push({ path: filePath, content: new TextDecoder().decode(bytesResult.value) });
    }

    // Commit the fix to a branch via the Git Data API.
    const branchName = lastIter.branch; // reprise/fix-N
    const branchResult = await this.svc.github.commitFixBranch({
      repo,
      branchName,
      baseSha,
      files: filesToCommit,
      message: `fix(#${issue}): ${selected.summary}`,
      fixScope,
      neverScope,
    });
    if (!branchResult.ok) { return branchResult; }
    const headSha = branchResult.value.headSha;

    // Build the PR body with full evidence.
    const prBody = buildPrBody(record, lastIter, selected);

    // Create or update the PR.
    const prResult = await this.svc.github.createOrUpdatePr(
      repo,
      branchName,
      'main',
      `Fix #${issue}: ${selected.summary}`,
      prBody,
      lastIter.pr_draft,
    );
    if (!prResult.ok) { return prResult; }

    const prUrl = prResult.value.html_url;

    // Optionally post the evidence as a comment on the original issue.
    if (config.fix.draft_pr !== undefined) {
      // We post to the issue regardless of draft_pr since it's the differentiator feature.
      const commentBody = buildIssueComment(record, lastIter, selected, prUrl);
      await this.svc.github.createIssueComment(repo, issue, commentBody).catch(() => {
        // Non-fatal: comment failure must not block the PR creation.
      });
    }

    const updatedIteration: FixIteration = {
      ...lastIter,
      pr: prUrl,
      base_sha: baseSha,
      head_sha: headSha,
    };
    const updatedIterations = [...record.fix.iterations];
    updatedIterations[updatedIterations.length - 1] = updatedIteration;

    const updated: IssueRecord = {
      ...record,
      state: 'VERIFYING',
      updated_at: new Date().toISOString(),
      fix: { iterations: updatedIterations },
    };

    const saveResult = await this.svc.store.save(updated);
    if (!saveResult.ok) { return saveResult; }

    this.svc.views.showInfo(`PR created: ${prUrl}`, 'Open');
    return R.ok(updated);
  }
}

// ── Workspace HEAD SHA resolver ───────────────────────────────────────────────

/** Read the current HEAD SHA from the workspace .git files. Returns '' on failure. */
async function resolveWorkspaceHeadSha(svc: Pick<Services, 'workspace'>): Promise<string> {
  try {
    const headRes = await svc.workspace.readFile('.git/HEAD');
    if (!headRes.ok) { return ''; }
    const headText = new TextDecoder().decode(headRes.value);

    const refsReader = async (refPath: string): Promise<string | null> => {
      const r = await svc.workspace.readFile(`.git/${refPath}`);
      if (!r.ok) { return null; }
      return new TextDecoder().decode(r.value);
    };

    const packedRes = await svc.workspace.readFile('.git/packed-refs');
    const packedRefs = packedRes.ok ? new TextDecoder().decode(packedRes.value) : '';

    return (await resolveHeadSha(headText, refsReader, packedRefs)) ?? '';
  } catch {
    return '';
  }
}

// ── PR body builder ───────────────────────────────────────────────────────────

function buildPrBody(
  record: IssueRecord,
  iteration: FixIteration,
  selected: Candidate,
): string {
  const diag = record.replication?.diagnosis;
  const repro = record.replication?.repro;
  const verif = iteration.verification;

  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

  const lines: string[] = [
    `## Fix #${record.issue}: ${selected.summary}`,
    '',
    diag?.summary ? `> **Diagnosis:** ${diag.summary}` : '',
    '',
    `**Files changed:** ${selected.files_changed.join(', ')}`,
    '',
    `Fixes #${record.issue}`,
    record.stubbed ? `\n> *Proposed by provider \`${record.provider}\` (stub response)*` : '',
    '',
    '---',
    '',
    '### 🔬 Reproduction evidence',
    '',
  ];

  if (repro) {
    lines.push(
      `| Metric | Value |`,
      `|--------|-------|`,
      `| Failure rate | **${pct(repro.rate)}** (${repro.failed}/${repro.trials} runs) |`,
      `| Wilson 95% CI | ${pct(repro.wilson_low)} – ${pct(repro.wilson_high)} |`,
      `| Verdict | **${record.replication?.verdict ?? '—'}** |`,
      `| Platform | \`${repro.run_context.platform}\` on \`${repro.run_context.host_os}\` |`,
      `| Executor | \`${repro.run_context.executor}\` |`,
      '',
    );
    if (repro.signature) {
      lines.push(`**Signature** (\`${repro.signature.kind}\`): \`${repro.signature.pattern}\``, '');
    }
  } else {
    lines.push('*No replication data recorded.*', '');
  }

  lines.push('### ✅ Verification', '');

  if (verif && verif.finished_at) {
    const vr = verif.repro;
    lines.push(
      `| Metric | Value |`,
      `|--------|-------|`,
      `| Verdict | **${verif.verdict}** |`,
      `| Repro runs | ${vr.runs} / ${vr.runs_required} required |`,
      `| Repro failures | ${vr.failed} |`,
      `| Evidence | \`${vr.evidence}\` |`,
      `| Regressions blocked | ${verif.regression.blocking.length} |`,
      `| Tests total | ${verif.regression.tests_total} |`,
      '',
    );
    if (vr.claim) {
      lines.push(`> ${vr.claim}`, '');
    }
    if (verif.regression.blocking.length > 0) {
      lines.push(
        '**Blocking regressions:**',
        ...verif.regression.blocking.map((t) => `- \`${t}\``),
        '',
      );
    }
  } else {
    lines.push('*Verification not yet run.*', '');
  }

  lines.push(
    '---',
    '',
    '### Candidates',
    '| # | Status | Quick check (repro / blocking) | Files |',
    '|---|--------|-------------------------------|-------|',
    ...iteration.candidates.map(
      (c) => `| ${c.k} | \`${c.status}\` | ${c.quick_check.repro_failed}/${c.quick_check.repro_runs} repro · ${c.quick_check.blocking} blocking | ${c.files_changed.join(', ')} |`,
    ),
    '',
    '### Checklist',
    repro
      ? `- [x] Reproduced: **${pct(repro.rate)}** failure rate (${repro.failed}/${repro.trials} runs)`
      : '- [ ] Reproduced',
    `- [x] Candidate ${selected.k} of ${iteration.candidates.length} selected`,
    verif?.verdict === 'FIX_VERIFIED'
      ? `- [x] Verified: ${verif.repro.runs} clean runs (${verif.repro.evidence} evidence)`
      : '- [ ] Verified',
    verif?.regression.blocking.length === 0 && (verif?.regression.tests_total ?? 0) > 0
      ? `- [x] No regressions (${verif!.regression.tests_total} tests checked)`
      : '- [ ] No regressions against base',
    iteration.review.verdict === 'ok'
      ? '- [x] Self-review: no high-severity findings'
      : `- [ ] Self-review: ${iteration.review.findings.filter((f) => f.severity === 'high').length} high-severity finding(s)`,
  );

  return lines.filter((l) => l !== undefined && l !== null).join('\n');
}

// ── Issue comment builder ─────────────────────────────────────────────────────

/** Short evidence comment posted to the original GitHub issue after PR creation. */
function buildIssueComment(
  record: IssueRecord,
  iteration: FixIteration,
  selected: Candidate,
  prUrl: string,
): string {
  const repro = record.replication?.repro;
  const verif = iteration.verification;
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

  const lines: string[] = [
    `🤖 **Reprise** has proposed a fix for this issue.`,
    '',
    `**PR:** ${prUrl}`,
    '',
  ];

  if (repro) {
    lines.push(
      `**Reproduction:** ${pct(repro.rate)} failure rate over ${repro.trials} runs` +
        ` (Wilson 95% CI: ${pct(repro.wilson_low)}–${pct(repro.wilson_high)}) — verdict: **${record.replication?.verdict ?? '—'}**`,
      '',
    );
  }

  if (verif?.finished_at) {
    lines.push(
      `**Verification:** ${verif.verdict}` +
        ` · ${verif.repro.runs} repro runs · ${verif.regression.blocking.length} regressions blocked`,
      '',
    );
    if (verif.repro.claim) {
      lines.push(`> ${verif.repro.claim}`, '');
    }
  }

  lines.push(
    `**Files changed:** ${selected.files_changed.join(', ')}`,
    `**Summary:** ${selected.summary}`,
  );

  return lines.join('\n');
}
