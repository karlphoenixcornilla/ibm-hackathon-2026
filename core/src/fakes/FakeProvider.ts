// fakes/FakeProvider.ts — echoes fixture JSON from a hardcoded stub
import type { ProvidersService } from '../contracts/services';
import type { Provider, StageRequest, StageResponse } from '../contracts/provider';
import type { CancellationToken, Event } from '../contracts/events';
import { Emitter } from '../util/events';
import { Result as R } from '../util/result';
import type { Result } from '../util/result';

const STUB_RESPONSES: Record<string, unknown> = {
  intake: {
    fingerprint: {
      platform: 'android',
      component: 'auth',
      functions: ['BiometricManager.authenticate', 'LoginActivity.onResume'],
      symptom: 'App crashes with DESTROYED activity state after biometric prompt',
      trigger: 'Lock screen shown during biometric authentication',
      expected: 'Activity resumes to login screen',
      actual: 'Activity is destroyed; crash with IllegalStateException',
      error_signature: 'IllegalStateException: Activity has been destroyed',
    },
    attempt_possible: true,
    missing: [],
    question: '',
  },
  dedupe: { same_bug: false, reason: 'No similar issues found in the database.' },
  test: {
    test_file: 'app/src/androidTest/LoginTest.kt',
    signature: { kind: 'assertion_message', pattern: 'expected activity to resume but got DESTROYED' },
    rationale: 'Stub response prepared for this demo',
  },
  rootcause: {
    summary: 'BiometricPrompt callback is called on a destroyed activity',
    locations: [{ file: 'app/src/main/java/LoginActivity.kt', start_line: 47, end_line: 55, reason: 'Activity lifecycle not checked before resuming UI' }],
    fix_direction: 'Check isFinishing() and isDestroyed() before calling UI methods in the biometric callback',
    confidence: 'high',
  },
  fix: {
    summary: 'Guard UI calls in BiometricPrompt callback with lifecycle check',
    files_changed: ['app/src/main/java/LoginActivity.kt'],
    risk_notes: 'Low risk; adds a null check.',
    tests_added: [],
  },
  review: { verdict: 'ok', findings: [] },
};

class StubProvider implements Provider {
  readonly id = 'stub';
  readonly capabilities = { images: false, implemented: true };

  async run(req: StageRequest, _token: CancellationToken): Promise<StageResponse> {
    const json = STUB_RESPONSES[req.stage] ?? null;
    if (json === null) {
      throw new Error(`No stub response for stage ${req.stage} on #${req.issue}`);
    }
    return {
      json,
      files: [],
      usage: { calls: 1, detail: { [req.stage]: 1 } },
      provider: 'stub',
      stubbed: true,
    };
  }
}

class UnimplementedProvider implements Provider {
  constructor(public readonly id: string) {}
  readonly capabilities = { images: false, implemented: false };

  async run(_req: StageRequest, _token: CancellationToken): Promise<StageResponse> {
    throw new Error(`Provider ${this.id} is not implemented yet`);
  }
}

export class FakeProvider implements ProvidersService {
  private readonly providers: Provider[] = [
    new StubProvider(),
    new UnimplementedProvider('claude'),
    new UnimplementedProvider('bob'),
    new UnimplementedProvider('gemini'),
    new UnimplementedProvider('groq'),
  ];
  private activeId = 'stub';

  private emitter = new Emitter<{ id: string }>();
  readonly onDidChangeProvider: Event<{ id: string }> = this.emitter.event;

  getActive(): Provider {
    return this.providers.find((p) => p.id === this.activeId) ?? this.providers[0]!;
  }

  list(): Provider[] {
    return [...this.providers];
  }

  setActive(id: string): Result<void, string> {
    if (!this.providers.find((p) => p.id === id)) {
      return R.err(`Unknown provider: ${id}`);
    }
    this.activeId = id;
    this.emitter.fire({ id });
    return R.ok(undefined);
  }
}
