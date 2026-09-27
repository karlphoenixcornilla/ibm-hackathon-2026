// fakes/FakeApprovals.ts — ApprovalService with a fixed answer that records each request
import type { ApprovalService, FixApprovalRequest } from '../contracts/services';

export class FakeApprovals implements ApprovalService {
  readonly requests: FixApprovalRequest[] = [];

  constructor(private readonly answer = true) {}

  async approveFix(req: FixApprovalRequest): Promise<boolean> {
    this.requests.push(req);
    return this.answer;
  }
}
