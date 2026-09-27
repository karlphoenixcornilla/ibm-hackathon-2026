// fakes/FakeViews.ts — no-op fake ViewsService
import type { ViewsService } from '../contracts/services';

export class FakeViews implements ViewsService {
  refreshBugReports(): void { /* no-op */ }
  refreshRuns(): void { /* no-op */ }
  openPanel(_repo: string, _issue: number): void { /* no-op */ }
  setStatusBar(_text: string): void { /* no-op */ }
  showInfo(message: string, ..._actions: string[]): PromiseLike<string | undefined> {
    console.info('[FakeViews] showInfo:', message);
    return Promise.resolve(undefined);
  }
  showError(message: string): void {
    console.error('[FakeViews] showError:', message);
  }
}
