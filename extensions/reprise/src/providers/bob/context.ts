// providers/bob/context.ts — fill the runtime-prompt variables for one stage.
// Pipeline callers pass only a few `vars`; the rest comes from the issue on
// GitHub, the record in the store, .reprise.yml and the opened folder.
// Values the caller passes always win over derived ones.

import type { StageRequest } from '../../contracts/provider';
import type { IssueRecord } from '../../contracts/records';
import type {
  ConfigService,
  GitHubService,
  StoreService,
  WorkspaceService,
} from '../../contracts/services';

export interface BobContextDeps {
  config: Pick<ConfigService, 'get'>;
  store: Pick<StoreService, 'getCached' | 'load'>;
  github: Pick<GitHubService, 'getIssue'>;
  workspace: Pick<WorkspaceService, 'readFile'>;
}

const NONE = '(none)';

async function loadRecord(deps: BobContextDeps, repo: string, issue: number): Promise<IssueRecord | null> {
  const cached = deps.store.getCached(repo, issue);
  if (cached) return cached;
  try {
    const r = await deps.store.load(repo, issue);
    return r.ok ? r.value : null;
  } catch {
    return null;
  }
}

async function readText(deps: BobContextDeps, path: string): Promise<string | null> {
  if (!path) return null;
  try {
    const r = await deps.workspace.readFile(path);
    return r.ok ? new TextDecoder().decode(r.value) : null;
  } catch {
    return null;
  }
}

/** The reporter's words: title, body and comments, as plain text. */
async function reportText(deps: BobContextDeps, repo: string, issue: number, fallbackTitle: string): Promise<string> {
  if (!deps.github.getIssue) return `Title: ${fallbackTitle}\n\n(The issue body could not be loaded.)`;
  const r = await deps.github.getIssue(repo, issue).catch(() => null);
  if (!r || !r.ok) return `Title: ${fallbackTitle}\n\n(The issue body could not be loaded.)`;
  const d = r.value;
  const lines = [`Title: ${d.title}`, `Reported by: ${d.user}`, '', d.body || '(empty body)'];
  for (const c of d.comments) {
    lines.push('', `Comment by ${c.user} (${c.created_at}):`, c.body);
  }
  return lines.join('\n');
}

function fingerprintText(record: IssueRecord | null): string {
  const fp = record?.replication?.fingerprint;
  if (!fp || (!fp.symptom && !fp.component)) return NONE;
  return JSON.stringify(fp);
}

function platformOf(record: IssueRecord | null, req: StageRequest): string {
  return (
    req.vars['platform'] ??
    (record?.replication?.repro?.run_context?.platform as string | undefined) ??
    (record?.replication?.fingerprint?.platform as string | undefined) ??
    'unknown'
  );
}

function diagnosisText(record: IssueRecord | null): string {
  const d = record?.replication?.diagnosis;
  if (!d || !d.summary) return NONE;
  return JSON.stringify({
    summary: d.summary,
    locations: d.locations,
    fix_direction: d.fix_direction,
    confidence: d.confidence,
  });
}

function trialsSummary(record: IssueRecord | null): string {
  const r = record?.replication?.repro;
  if (!r || !r.trials) return NONE;
  return `Signature ${r.signature.kind} /${r.signature.pattern}/ matched in ${r.failed} of ${r.trials} runs (sequence ${r.sequence}).`;
}

/**
 * Build every variable the stage template declares. Unknown values become
 * "(none)" or "" rather than failing, because a partial context still gives
 * Bob enough to work from the repository it can read.
 */
export async function buildStageVars(req: StageRequest, deps: BobContextDeps): Promise<Record<string, string>> {
  const { stage, repo, issue } = req;
  const v = req.vars;
  const record = await loadRecord(deps, repo, issue);
  const config = deps.config.get();
  const platform = platformOf(record, req);
  const pc = config?.platforms?.[platform];
  const repro = record?.replication?.repro;
  const previous = (req.previous ?? {}) as Record<string, unknown>;

  const base: Record<string, string> = {
    repo,
    issue_number: String(issue),
    platform,
    fingerprint: fingerprintText(record),
  };

  switch (stage) {
    case 'intake':
      return {
        ...base,
        platforms: Object.keys(config?.platforms ?? {}).join(', ') || 'unknown',
        components: (config?.components ?? []).join(', ') || 'unknown',
        untrusted_report: v['untrusted_report'] ?? (await reportText(deps, repo, issue, record?.title ?? `#${issue}`)),
        mode: v['mode'] ?? 'normal',
        tried_summary: v['tried_summary'] ?? '',
      };

    case 'dedupe': {
      const candidate = Number(v['candidate'] ?? v['candidate_issue'] ?? NaN);
      let candidateTitle = v['candidate_title'] ?? '';
      let candidateFingerprint = v['candidate_fingerprint'] ?? NONE;
      if (Number.isFinite(candidate)) {
        const other = await loadRecord(deps, repo, candidate);
        if (other) {
          candidateTitle ||= other.title;
          if (candidateFingerprint === NONE) candidateFingerprint = fingerprintText(other);
        }
        if (!candidateTitle && deps.github.getIssue) {
          const gh = await deps.github.getIssue(repo, candidate).catch(() => null);
          if (gh?.ok) candidateTitle = gh.value.title;
        }
      }
      return {
        ...base,
        new_issue: String(issue),
        new_fingerprint: v['new_fingerprint'] ?? base['fingerprint'],
        candidate_issue: Number.isFinite(candidate) ? String(candidate) : 'unknown',
        candidate_title: candidateTitle || 'unknown',
        candidate_fingerprint: candidateFingerprint,
        untrusted_report: v['untrusted_report'] ?? (await reportText(deps, repo, issue, record?.title ?? `#${issue}`)),
      };
    }

    case 'test': {
      const testFile = v['test_file'] ?? (previous['test_file'] as string | undefined) ?? repro?.test_file ?? '';
      const functions = record?.replication?.fingerprint?.functions ?? [];
      return {
        ...base,
        untrusted_report: v['untrusted_report'] ?? (await reportText(deps, repo, issue, record?.title ?? `#${issue}`)),
        test_file: testFile || `(choose a path matching ${pc?.test?.pattern ?? 'the existing test layout'})`,
        test_pattern: pc?.test?.pattern ?? '(see existing tests)',
        single_test_command: pc?.test?.single ?? '(not configured)',
        source_files: v['source_files'] ?? (functions.length ? `files defining ${functions.join(', ')}` : NONE),
        attempt: String(req.attempt),
        max_attempts: String(config?.defaults?.max_test_attempts ?? 3),
        previous_outcome: req.attempt > 1 ? v['outcome'] ?? '' : '',
        previous_failure_message: req.attempt > 1 ? v['failure_message'] ?? '' : '',
        previous_output_tail: req.attempt > 1 ? v['output_tail'] ?? '' : '',
      };
    }

    case 'rootcause': {
      const testFile = v['test_file'] ?? repro?.test_file ?? '';
      return {
        ...base,
        test_file: testFile || NONE,
        test_source: v['test_source'] ?? (await readText(deps, testFile)) ?? NONE,
        failure_output: v['failure_output'] ?? v['output_tail'] ?? trialsSummary(record),
      };
    }

    case 'fix': {
      const neverPaths = [...(config?.edit_scope?.never ?? [])];
      if (repro?.test_file) neverPaths.push(repro.test_file);
      const iterations = record?.fix?.iterations ?? [];
      return {
        ...base,
        diagnosis: v['diagnosis'] ?? diagnosisText(record),
        test_file: v['repro_test'] ?? repro?.test_file ?? NONE,
        failure_message: v['failure_message'] ?? trialsSummary(record),
        allowed_paths: (config?.edit_scope?.fix ?? []).join(', ') || '(any source file)',
        forbidden_paths: neverPaths.join(', ') || NONE,
        base_suite_summary: v['base_suite_summary'] ?? NONE,
        iteration: v['iteration'] ?? String(iterations.length + 1),
        max_iterations: String(config?.fix?.max_rounds ?? 3),
        previous_results:
          v['previous_results'] ??
          (iterations.length
            ? JSON.stringify(iterations.map((it) => ({
                n: it.n,
                summary: it.summary,
                verdict: it.verification?.verdict,
                candidates: it.candidates.map((c) => ({ k: c.k, status: c.status, quick_check: c.quick_check })),
              })))
            : ''),
      };
    }

    case 'review': {
      const last = record?.fix?.iterations?.[record.fix.iterations.length - 1];
      return {
        ...base,
        diagnosis: v['diagnosis'] ?? diagnosisText(record),
        pr_diff: v['pr_diff'] ?? (last ? `Fix "${last.summary}" on branch ${last.branch} (${last.pr ?? 'no PR yet'}). Files: ${last.candidates.find((c) => c.status === 'selected')?.files_changed.join(', ') ?? 'unknown'}. Read these files in the repository to review the change.` : NONE),
        verification_summary:
          v['verification_summary'] ??
          (last?.verification ? `${last.verification.verdict}: ${last.verification.repro.claim}` : NONE),
        lint_output: v['lint_output'] ?? '',
      };
    }
  }
}
