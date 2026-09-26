// pipeline/record-factory.ts — create a blank IssueRecord scaffold
// Owned by: T3

import type { IssueRecord } from '../contracts/records';

export function makeBlankRecord(
  repo: string,
  issue: number,
  title: string,
  url: string,
  acknowledgedBy: string
): IssueRecord {
  const now = new Date().toISOString();
  return {
    schema: 3,
    repo,
    issue,
    title,
    url,
    state: 'REPLICATING',
    provider: 'stub',
    stubbed: true,
    created_at: now,
    updated_at: now,
    replication: {
      verdict: 'NEEDS_INFO',
      acknowledged_by: acknowledgedBy,
      started_at: now,
      finished_at: now,
      duration_ms: 0,
      fingerprint: {
        platform: 'unknown',
        component: '',
        functions: [],
        symptom: '',
        trigger: '',
        expected: '',
        actual: '',
        error_signature: '',
      },
      duplicate: {
        of: null,
        score: null,
        fields: {},
        reason: '',
        behaviour_check: null,
      },
      question: '',
      repro: {
        test_origin: 'provided',
        test_file: '',
        test_sha256: '',
        branch: `reprise/repro-${issue}`,
        signature: { kind: 'assertion_message', pattern: '' },
        attempts: 0,
        run_context: {
          platform: 'android',
          executor: 'local',
          method: 'repo_command',
          host_os: '',
          device: '',
          ci_run_url: null,
          runner_version: null,
        },
        trials: 0,
        failed: 0,
        invalid: 0,
        sequence: '',
        trials_policy: {
          min: 10,
          max: 20,
          limit: 100,
          max_minutes: null,
          source: 'config',
          stopped_by: 'max_reached',
        },
        rate: 0,
        wilson_low: 0,
        wilson_high: 0,
      },
      diagnosis: {
        summary: '',
        locations: [],
        fix_direction: '',
        confidence: 'medium',
        accepted_by: '',
        edited: false,
      },
    },
    fix: { iterations: [] },
    resolution_note: '',
    usage: { provider: 'stub', calls: 0, by_stage: {} },
    events: [],
  };
}

/** Touch the record's updated_at and return it. */
export function touchRecord(record: IssueRecord): IssueRecord {
  record.updated_at = new Date().toISOString();
  return record;
}
