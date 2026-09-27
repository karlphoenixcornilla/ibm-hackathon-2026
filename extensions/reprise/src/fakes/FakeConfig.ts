// fakes/FakeConfig.ts — in-memory fake ConfigService with a canned .reprise.yml
import type { ConfigService, RepriseConfig } from '../contracts/services';
import type { Result } from '../util/result';
import { Result as R } from '../util/result';
import type * as vscode from 'vscode';

const FAKE_CONFIG: RepriseConfig = {
  version: 3,
  issues: { labels: ['bug'] },
  components: ['auth', 'ui', 'networking'],
  defaults: {
    executor: 'local',
    trials: { min: 10, max: 20, limit: 100, max_minutes: null },
    max_test_attempts: 3,
  },
  fix: {
    candidates: 3,
    quick_runs: 5,
    max_rounds: 3,
    candidate_executor: 'auto',
    draft_pr: true,
    self_review: true,
  },
  verify: { min_runs: 3, max_runs: 200, regression_reruns: 3 },
  edit_scope: {
    test: ['app/src/androidTest/**', 'Tests/**'],
    fix: ['app/src/main/**', 'src/**'],
    never: ['.github/**', '.reprise.yml', '.reprise/**'],
  },
  platforms: {
    android: {
      shell: 'bash',
      cwd: '.',
      prereq: ['adb'],
      test: {
        pattern: '**/*Test.kt',
        single: './gradlew connectedAndroidTest -Pandroid.testInstrumentationRunnerArguments.class={file}',
        all: './gradlew connectedAndroidTest',
        report: 'junit',
        report_path: 'app/build/outputs/androidTest-results/connected/**/*.xml',
      },
      run_timeout_seconds: 300,
    },
  },
};

export class FakeConfig implements ConfigService {
  private config: RepriseConfig = FAKE_CONFIG;

  async load(): Promise<Result<RepriseConfig, string>> {
    return R.ok(this.config);
  }

  get(): RepriseConfig | null {
    return this.config;
  }

  getUri(): vscode.Uri | null {
    return null;
  }

  invalidate(): void {
    // no-op for fake
  }
}
