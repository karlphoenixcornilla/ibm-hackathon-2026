// fakes/FakeGitHub.ts — in-memory fake GitHubService listing three issues
import type { GitHubService, GitHubIssue } from '../contracts/services';
import type { IssueRecord } from '../contracts/records';
import type { Result } from '../util/result';
import { Result as R } from '../util/result';

const FAKE_ISSUES: GitHubIssue[] = [
  {
    number: 7,
    title: 'Login crashes on Android 14 with biometric enabled',
    html_url: 'https://github.com/demo-owner/demo-app/issues/7',
    state: 'open',
    labels: ['bug'],
    created_at: '2025-01-10T10:00:00Z',
    updated_at: '2025-01-15T14:30:00Z',
  },
  {
    number: 12,
    title: 'Network timeout not shown to user on iOS 17',
    html_url: 'https://github.com/demo-owner/demo-app/issues/12',
    state: 'open',
    labels: ['bug'],
    created_at: '2025-01-12T09:00:00Z',
    updated_at: '2025-01-14T11:00:00Z',
  },
  {
    number: 15,
    title: 'Dark mode toggle causes white flash on macOS',
    html_url: 'https://github.com/demo-owner/demo-app/issues/15',
    state: 'open',
    labels: ['bug'],
    created_at: '2025-01-13T08:00:00Z',
    updated_at: '2025-01-13T08:00:00Z',
  },
];

export class FakeGitHub implements GitHubService {
  async detectRepo(): Promise<Result<string, string>> {
    return R.ok('demo-owner/demo-app');
  }

  async listIssues(_repo: string): Promise<Result<GitHubIssue[], string>> {
    return R.ok([...FAKE_ISSUES]);
  }

  async readRecord(_repo: string, _issue: number): Promise<Result<IssueRecord | null, string>> {
    // Return null — no records on reprise-data yet
    return R.ok(null);
  }

  async writeRecord(_repo: string, _issue: number, _record: IssueRecord): Promise<Result<void, string>> {
    return R.ok(undefined);
  }

  async createOrUpdatePr(
    _repo: string,
    _branch: string,
    _base: string,
    _title: string,
    _body: string,
    _draft: boolean
  ): Promise<Result<{ number: number; html_url: string }, string>> {
    return R.ok({ number: 42, html_url: 'https://github.com/demo-owner/demo-app/pull/42' });
  }

  async dispatchWorkflow(
    _repo: string,
    _inputs: Record<string, string | number>
  ): Promise<Result<{ runId: number }, string>> {
    return R.ok({ runId: 99 });
  }

  async downloadArtifact(
    _url: string,
    _token: string
  ): Promise<Result<Record<string, unknown>, string>> {
    return R.ok({});
  }
}
