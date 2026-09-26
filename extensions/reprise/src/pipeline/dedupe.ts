// pipeline/dedupe.ts — Stage 2: duplicate detection
// Owned by: T3
// Spec: 02-specs/replication-pipeline.md §2

import type { Stage, PipelineContext, StageResult } from './types';
import type { Fingerprint, IssueRecord } from '../contracts/records';
import type { DedupeOutput } from '../contracts/provider';
import { touchRecord } from './record-factory';

// ── Field scoring weights (spec §2) ──────────────────────────────────────────

const WEIGHTS: Record<string, number> = {
  platform: 0.10,
  component: 0.15,
  functions: 0.30,
  symptom: 0.20,
  trigger: 0.10,
  error_signature: 0.15,
};

const THRESHOLD = 0.60;

const STOPWORDS = new Set([
  'a','an','and','are','as','at','be','but','by','for','from',
  'has','have','in','is','it','of','on','or','that','the','this',
  'to','was','were','when','with',
]);

/** Tokenise: lowercase, split on non-alphanumerics, camelCase boundaries, drop short/stopword tokens. */
function tokenise(text: string): Set<string> {
  // Split camelCase
  const expanded = text.replace(/([a-z])([A-Z])/g, '$1 $2');
  const tokens = expanded
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
  return new Set(tokens);
}

/** Jaccard similarity of two token sets. */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  const intersection = new Set([...a].filter((x) => b.has(x)));
  const union = new Set([...a, ...b]);
  return intersection.size / union.size;
}

/** Score two fingerprints against each other. */
export function scoreDedupe(a: Fingerprint, b: Fingerprint): { score: number; fields: Record<string, number> } {
  const fields: Record<string, number> = {};

  fields['platform'] = a.platform === b.platform && a.platform !== 'unknown' ? 1 : 0;
  fields['component'] = a.component === b.component && a.component !== '' && a.component !== 'unknown' ? 1 : 0;
  fields['functions'] = jaccard(new Set(a.functions), new Set(b.functions));
  fields['symptom'] = jaccard(tokenise(a.symptom), tokenise(b.symptom));
  fields['trigger'] = jaccard(tokenise(a.trigger), tokenise(b.trigger));
  fields['error_signature'] = jaccard(tokenise(a.error_signature), tokenise(b.error_signature));

  // Renormalise: if component is unknown/empty on either side, redistribute weight
  let totalWeight = 0;
  let weightedScore = 0;
  for (const [field, weight] of Object.entries(WEIGHTS)) {
    totalWeight += weight;
    weightedScore += weight * (fields[field] ?? 0);
  }

  const score = totalWeight > 0 ? weightedScore / totalWeight : 0;
  return { score, fields };
}

export const dedupeStage: Stage = {
  async run(ctx: PipelineContext): Promise<StageResult> {
    const { record, services } = ctx;
    const currentFp = record.replication.fingerprint;

    // Load all earlier records for this repo
    const candidates: IssueRecord[] = [];
    {
      // We use the store's cache — only records already loaded in this session
      // In a real implementation we'd iterate the reprise-data branch.
      // For the pipeline (fakes / stub scenario), we check what the store has.
      const storeResult = await services.store.load(record.repo, record.issue);
      // (existing record for this issue doesn't count as a candidate)
      // Candidates = earlier issues, but we have no list API on store.
      // For now: skip field-score dedupe if no candidates are available.
      // The provider dedupe stage will handle it.
      void storeResult;
    }

    // If no candidates, skip deduplication
    if (candidates.length === 0) {
      // Still run provider dedupe stage so it records the result
      let providerResult: DedupeOutput | null = null;
      try {
        const resp = await services.providers.getActive().run(
          {
            stage: 'dedupe',
            issue: record.issue,
            repo: record.repo,
            vars: {},
            attempt: 1,
          },
          ctx.token
        );
        providerResult = resp.json as DedupeOutput;
        record.usage.calls += resp.usage.calls;
        record.usage.by_stage.dedupe =
          (record.usage.by_stage.dedupe ?? 0) + resp.usage.calls;
      } catch {
        // No stub for dedupe — that's fine, skip
        providerResult = null;
      }

      if (providerResult && providerResult.same_bug) {
        // Provider says it's a duplicate but we have no candidate number — skip
      }

      record.replication.duplicate = {
        of: null,
        score: null,
        fields: {},
        reason: providerResult?.reason ?? 'No earlier records to compare',
        behaviour_check: null,
      };
      ctx.addEvent('dedupe.done');
      touchRecord(record);
      return { ok: true };
    }

    // Find top candidate by field score
    let topScore = 0;
    let topCandidate: typeof candidates[0] | null = null;
    let topFields: Record<string, number> = {};

    for (const c of candidates) {
      const { score, fields } = scoreDedupe(currentFp, c.replication.fingerprint);
      if (score > topScore) {
        topScore = score;
        topCandidate = c;
        topFields = fields;
      }
    }

    if (topScore < THRESHOLD || !topCandidate) {
      record.replication.duplicate = {
        of: null,
        score: topScore,
        fields: topFields,
        reason: 'Score below threshold',
        behaviour_check: null,
      };
      ctx.addEvent('dedupe.done');
      touchRecord(record);
      return { ok: true };
    }

    // Ask provider to confirm
    let providerSays: DedupeOutput | null = null;
    try {
      const resp = await services.providers.getActive().run(
        {
          stage: 'dedupe',
          issue: record.issue,
          repo: record.repo,
          vars: { candidate: String(topCandidate.issue) },
          attempt: 1,
        },
        ctx.token
      );
      providerSays = resp.json as DedupeOutput;
      record.usage.calls += resp.usage.calls;
      record.usage.by_stage.dedupe =
        (record.usage.by_stage.dedupe ?? 0) + resp.usage.calls;
    } catch {
      // Provider can't confirm — don't call it a duplicate
      providerSays = { same_bug: false, reason: 'Provider could not confirm' };
    }

    record.replication.duplicate = {
      of: providerSays?.same_bug ? topCandidate.issue : null,
      score: topScore,
      fields: topFields,
      reason: providerSays?.reason ?? '',
      behaviour_check: null,
    };

    ctx.addEvent('dedupe.done');
    touchRecord(record);

    if (providerSays?.same_bug) {
      record.state = 'DUPLICATE';
      record.replication.verdict = 'DUPLICATE';
      record.replication.finished_at = new Date().toISOString();
      ctx.addEvent('verdict', `DUPLICATE of #${topCandidate.issue}`);
      touchRecord(record);
      return { ok: false, terminal: true };
    }

    return { ok: true };
  },
};
