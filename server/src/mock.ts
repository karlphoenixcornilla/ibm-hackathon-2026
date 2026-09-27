// mock.ts — mock mode (REPRISE_MOCK=1): the real routes and contract over fake services,
// so the Review UI (#33) can be built with no token, repository or runner.

import { buildFakeCore, createNotifier, FakeGitHub, neverCancelled, Result } from '@reprise/core';
import type { CoreServices, IssueRecord, PipelineService, StoreService } from '@reprise/core';
import fixture from '../fixtures/record-7.json';
import type { Proposal } from './api/types';
import type { CheckHandler, PrHandler, ProposeHandler } from './handlers';

export const MOCK_LOGIN = 'mock-user';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const key = (repo: string, issue: number) => `${repo}#${issue}`;

/** The sample record, retargeted at the given issue. */
export function mockRecord(repo: string, issue: number, title: string): IssueRecord {
  const r = structuredClone(fixture) as unknown as IssueRecord;
  return { ...r, repo, issue, title, url: `https://github.com/${repo}/issues/${issue}`, updated_at: new Date().toISOString() };
}

/** FakeGitHub that remembers records written by the mock pipeline. */
class MockGitHub extends FakeGitHub {
  constructor(private readonly records: Map<string, IssueRecord>) { super(); }

  override async readRecord(repo: string, issue: number) {
    return Result.ok(this.records.get(key(repo, issue)) ?? null);
  }

  override async writeRecord(repo: string, issue: number, record: IssueRecord) {
    this.records.set(key(repo, issue), record);
    return Result.ok(undefined);
  }
}

export interface MockOptions {
  /** Delay between scripted pipeline steps. Default 800 ms; tests use 0. */
  stepMs?: number;
  /** Also send one exec.request through the relay during acknowledge (REPRISE_MOCK_RELAY=1). */
  relay?: boolean;
}

/** Shared state for one mock app instance: records persist across requests. */
export class MockWorld {
  readonly records = new Map<string, IssueRecord>();

  constructor(readonly opts: MockOptions = {}) {}

  buildCore(): CoreServices {
    const github = new MockGitHub(this.records);
    const store: StoreService = {
      load: (repo, issue) => github.readRecord(repo, issue),
      save: (record) => github.writeRecord(record.repo, record.issue, record),
      getCached: (repo, issue) => this.records.get(key(repo, issue)) ?? null,
      invalidate: () => undefined,
    };
    const core = buildFakeCore({ github, store, notifier: createNotifier() });
    core.pipeline = this.scriptedPipeline(core, github);
    return core;
  }

  private scriptedPipeline(core: CoreServices, github: MockGitHub): PipelineService {
    const stepMs = this.opts.stepMs ?? 800;
    const relay = this.opts.relay ?? false;
    const acknowledge: PipelineService['acknowledge'] = async (repo, issue, _trials, token) => {
      const issues = await github.listIssues(repo);
      const title = (issues.ok ? issues.value.find((i) => i.number === issue)?.title : undefined) ?? `Issue #${issue}`;
      for (const text of ['Intake: reading the report', 'Writing a reproduction test', 'Running trials', 'Diagnosing the root cause']) {
        core.notifier.emit({ type: 'status', text });
        await sleep(stepMs);
      }
      if (relay) {
        await core.executors.local.run(
          { platform: 'android', mode: 'single', test_path: 'app/src/androidTest/LoginBiometricTest.kt', runs: 1, ref: null },
          token ?? neverCancelled,
          () => undefined,
        );
      }
      const record = mockRecord(repo, issue, title);
      await github.writeRecord(repo, issue, record);
      core.notifier.emit({ type: 'record.updated', repo, issue, state: record.state });
      return Result.ok(record);
    };
    return {
      acknowledge,
      runMoreTrials: (repo, issue, _count, token) => acknowledge(repo, issue, undefined, token),
    };
  }
}

export const MOCK_DIFF = `--- a/app/src/main/java/LoginActivity.kt
+++ b/app/src/main/java/LoginActivity.kt
@@ -42,7 +42,10 @@ class LoginActivity : AppCompatActivity() {
     override fun onBiometricResult(result: BiometricResult) {
-        val user = session.user
+        val user = session?.user ?: run {
+            pendingResult = result
+            return
+        }
         signIn(user, result.cryptoObject)
     }
`;

export const mockProposeHandler: ProposeHandler = {
  async propose({ core, repo, issue }) {
    const loaded = await core.store.load(repo, issue);
    const rec = loaded.ok && loaded.value ? loaded.value : mockRecord(repo, issue, `Issue #${issue}`);
    const d = rec.replication.diagnosis;
    const proposal: Proposal = {
      locations: d.locations,
      root_cause: d.summary,
      fix_direction: d.fix_direction,
      confidence: d.confidence,
      diff: MOCK_DIFF,
      pr_draft: {
        title: `Fix #${issue}: guard biometric callback until session is restored`,
        body: `Fixes #${issue}.\n\n**Root cause:** ${d.summary}\n\n**Evidence:** reproduced 10/10 (Wilson 95% CI 0.72–1.00).`,
      },
    };
    return proposal;
  },
};

export const mockPrHandler: PrHandler = {
  async createPr({ repo }) {
    return { number: 999, html_url: `https://github.com/${repo}/pull/999` };
  },
};

export async function mockValidateToken(token: string): Promise<string | null> {
  return token.trim() ? MOCK_LOGIN : null;
}

/** A canned successful local check (the fix from mockProposeHandler, verified). */
export const mockCheckHandler: CheckHandler = {
  async check({ runner }) {
    return {
      base_sha: runner?.head ?? '4b825dc642cb6eb9a060e54bf8d69288fbee4904',
      overlay_id: 'mock-overlay',
      files: [{ path: 'app/src/main/java/LoginActivity.kt', sha256: '9f2c1a7e0b4d3c5a6e8f1b2d4c6a8e0f1b3d5c7a9e1f3b5d7c9a1e3f5b7d9c1a' }],
      repro: { test_file: 'app/src/androidTest/LoginBiometricTest.kt', runs: 3, failed: 0, fixed: true },
      regression: { tests_total: 42, counts: { UNCHANGED_PASS: 41, ADDED_PASSING: 1 }, blocking: [], notable: [] },
      verdict: 'FIX_VERIFIED',
    };
  },
};
