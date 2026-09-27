// fakes/FakePipeline.ts — stub fake PipelineService
import type { PipelineService, TrialsPolicy } from '../contracts/services';
import type { IssueRecord } from '../contracts/records';
import type { Result } from '../util/result';
import { Result as R } from '../util/result';
import type * as runtime from '../contracts/runtime';

export class FakePipeline implements PipelineService {
  async acknowledge(
    _repo: string,
    _issue: number,
    _trialsOverride?: Partial<TrialsPolicy>,
    _token?: runtime.CancellationToken
  ): Promise<Result<IssueRecord, string>> {
    return R.err('Not implemented yet (track T3)');
  }

  async runMoreTrials(
    _repo: string,
    _issue: number,
    _count: number,
    _token?: runtime.CancellationToken
  ): Promise<Result<IssueRecord, string>> {
    return R.err('Not implemented yet (track T3)');
  }
}
