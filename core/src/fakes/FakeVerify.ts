// fakes/FakeVerify.ts — stub fake VerifyService
import type { VerifyService } from '../contracts/services';
import type { IssueRecord } from '../contracts/records';
import type { Result } from '../util/result';
import { Result as R } from '../util/result';
import type { CancellationToken } from '../contracts/events';

export class FakeVerify implements VerifyService {
  async verify(
    _repo: string, _issue: number, _token?: CancellationToken
  ): Promise<Result<IssueRecord, string>> {
    return R.err('Not implemented yet (track T4)');
  }
}
