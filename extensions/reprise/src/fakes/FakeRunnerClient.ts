// fakes/FakeRunnerClient.ts — in-memory fake RunnerClientService (always paired)
import type { RunnerClientService } from '../contracts/services';
import type { PairResponse, StatusResponse } from '../contracts/runner-api';
import type { Result } from '../util/result';
import { Result as R } from '../util/result';
import * as vscode from 'vscode';

export class FakeRunnerClient implements RunnerClientService {
  private paired = false;
  private emitter = new vscode.EventEmitter<{ paired: boolean }>();
  readonly onDidChangePairing = this.emitter.event;

  async pair(_code: string): Promise<Result<PairResponse, string>> {
    this.paired = true;
    this.emitter.fire({ paired: true });
    return R.ok({
      session: 'fake-session-token',
      runner_version: '0.1.0-fake',
      root_name: 'demo-app',
      remote: 'https://github.com/demo-owner/demo-app.git',
      head: 'abc1234def5678',
      host_os: 'darwin',
      platforms: [
        { platform: 'android', local_possible: true, missing: [] },
        { platform: 'ios', local_possible: false, missing: ['Xcode simulator not found'] },
      ],
    });
  }

  async disconnect(): Promise<void> {
    this.paired = false;
    this.emitter.fire({ paired: false });
  }

  async getStatus(): Promise<Result<StatusResponse | null, string>> {
    if (!this.paired) return R.ok(null);
    return R.ok({
      runner_version: '0.1.0-fake',
      root_name: 'demo-app',
      remote: 'https://github.com/demo-owner/demo-app.git',
      head: 'abc1234def5678',
      host_os: 'darwin',
      platforms: [
        { platform: 'android', local_possible: true, missing: [] },
        { platform: 'ios', local_possible: false, missing: ['Xcode simulator not found'] },
      ],
      busy: false,
    });
  }

  isPaired(): boolean {
    return this.paired;
  }
}
