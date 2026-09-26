// fakes/FakeFix.ts — stub fake FixService
import type { FixService } from '../contracts/services';
import type { IssueRecord } from '../contracts/records';
import type { Result } from '../util/result';
import { Result as R } from '../util/result';
import type * as vscode from 'vscode';

export class FakeFix implements FixService {
  async proposeFixes(
    _repo: string, _issue: number, _token?: vscode.CancellationToken
  ): Promise<Result<IssueRecord, string>> {
    return R.err('Not implemented yet (track T4)');
  }

  async runQuickCheck(
    _repo: string, _issue: number, _candidateK: number, _token?: vscode.CancellationToken
  ): Promise<Result<IssueRecord, string>> {
    return R.err('Not implemented yet (track T4)');
  }

  async applySelected(
    _repo: string, _issue: number, _token?: vscode.CancellationToken
  ): Promise<Result<IssueRecord, string>> {
    return R.err('Not implemented yet (track T4)');
  }
}
