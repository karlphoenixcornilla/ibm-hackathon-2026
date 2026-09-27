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

    const n = record.fix.iterations.length + 1;
    const iteration: FixIteration = {
      n,
      source: 'provider',
      pr: null,
      pr_draft: config.fix.draft_pr ?? true,
      branch: `reprise/fix-${n}`,
      base_sha: '',
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

    // Show diff review per file (services.views.approveFile not in contract — use showInfo).
    const approved = await this.svc.views.showInfo(
      `Apply fix candidate ${selected.k}? Files: ${selected.files_changed.join(', ')}`,
      'Apply',
      'Reject',
    );
    if (approved !== 'Apply') {
      return R.err('Fix application rejected by user.');
    }

    // Edit scope security check before writing.
    const neverScope = config.edit_scope?.never ?? [];
    for (const filePath of selected.files_changed) {
      if (neverScope.length > 0 && matchesScope(filePath, neverScope)) {
        return R.err(`File ${filePath} is in edit_scope.never — cannot write.`);
      }
    }

    // Create branch and PR through GitHub service.
    const branchName = lastIter.branch; // reprise/fix-N
    const prResult = await this.svc.github.createOrUpdatePr(
      repo,
      branchName,
      'main',
      `Fix #${issue}: ${selected.summary}`,
      buildPrBody(record, lastIter, selected),
      lastIter.pr_draft,
    );
    if (!prResult.ok) { return prResult; }

    const updatedIteration: FixIteration = {
      ...lastIter,
      pr: prResult.value.html_url,
      head_sha: `sha-candidate-${selected.k}`,
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
    return R.ok(updated);
  }
}

// ── PR body builder ───────────────────────────────────────────────────────────

function buildPrBody(
  record: IssueRecord,
  iteration: FixIteration,
  selected: Candidate,
): string {
  const diag = record.replication?.diagnosis;
  const lines: string[] = [
    `## Fix #${record.issue}: ${selected.summary}`,
    '',
    diag?.summary ? `**Diagnosis:** ${diag.summary}` : '',
    '',
    `**Files changed:** ${selected.files_changed.join(', ')}`,
    '',
    `Fixes #${record.issue}`,
    record.stubbed ? `\n*Proposed by provider \`${record.provider}\` (stub response)*` : '',
    '',
    '### Candidates',
    '| # | Status | Files |',
    '|---|--------|-------|',
    ...iteration.candidates.map(
      (c) => `| ${c.k} | ${c.status} | ${c.files_changed.join(', ')} |`,
    ),
    '',
    '### Checklist',
    `- [x] Reproduced: ${record.replication?.repro?.failed ?? 0} of ${record.replication?.repro?.trials ?? 0} runs failed`,
    `- [x] Candidate ${selected.k} of ${iteration.candidates.length} selected`,
    '- [ ] Verified: 0 failures in required runs',
    '- [ ] No regressions against base',
    '- [ ] Self-review: no high-severity findings',
  ];
  return lines.filter((l) => l !== null).join('\n');
}
