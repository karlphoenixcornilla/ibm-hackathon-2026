// fakes/FakeStore.ts — in-memory fake StoreService using a Map
import type { StoreService } from '../contracts/services';
import type { IssueRecord } from '../contracts/records';
import type { Result } from '../util/result';
import { Result as R } from '../util/result';

export class FakeIssueStore implements StoreService {
  private records = new Map<string, IssueRecord>();

  private key(repo: string, issue: number): string {
    return `${repo}#${issue}`;
  }

  async load(repo: string, issue: number): Promise<Result<IssueRecord | null, string>> {
    return R.ok(this.records.get(this.key(repo, issue)) ?? null);
  }

  async save(record: IssueRecord): Promise<Result<void, string>> {
    this.records.set(this.key(record.repo, record.issue), record);
    return R.ok(undefined);
  }

  getCached(repo: string, issue: number): IssueRecord | null {
    return this.records.get(this.key(repo, issue)) ?? null;
  }

  invalidate(repo: string, issue: number): void {
    this.records.delete(this.key(repo, issue));
  }
}
