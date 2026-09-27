// providers/index.ts — ProvidersService factory
// Owned by: T3
// Spec: 02-specs/ai-providers.md, ADR-4

import type * as runtime from '../contracts/runtime';
import type { Services, ProvidersService } from '../contracts/services';
import type { Provider, StageRequest, StageResponse } from '../contracts/provider';
import { Result as R } from '../util/result';
import type { Result } from '../util/result';
import { StubProvider } from './stub-provider';

// ── Unimplemented placeholder providers ──────────────────────────────────────

class UnimplementedProvider implements Provider {
  constructor(public readonly id: string) {}
  readonly capabilities = { images: false, implemented: false };

  async run(_req: StageRequest, _token: runtime.CancellationToken): Promise<StageResponse> {
    throw new Error(`Provider ${this.id} is not implemented yet`);
  }
}

// ── ProvidersService implementation ───────────────────────────────────────────

class ProvidersServiceImpl implements ProvidersService {
  private readonly providers: Provider[];
  private activeId: string;

  // Minimal event emitter — no vscode at construction time
  private listeners: Array<(e: { id: string }) => void> = [];
  readonly onDidChangeProvider: runtime.Event<{ id: string }> = (
    listener: (e: { id: string }) => void
  ) => {
    this.listeners.push(listener);
    return { dispose: () => { this.listeners = this.listeners.filter((l) => l !== listener); } };
  };

  constructor(workspace: Services['workspace']) {
    this.providers = [
      new StubProvider(workspace),
      new UnimplementedProvider('claude'),
      new UnimplementedProvider('bob'),
      new UnimplementedProvider('gemini'),
      new UnimplementedProvider('groq'),
    ];
    this.activeId = 'stub';
  }

  getActive(): Provider {
    return this.providers.find((p) => p.id === this.activeId) ?? this.providers[0]!;
  }

  list(): Provider[] {
    return [...this.providers];
  }

  setActive(id: string): Result<void, string> {
    const provider = this.providers.find((p) => p.id === id);
    if (!provider) return R.err(`Unknown provider: ${id}`);
    if (!provider.capabilities.implemented) {
      return R.err(`Provider ${id} is not implemented yet`);
    }
    this.activeId = id;
    for (const l of this.listeners) l({ id });
    return R.ok(undefined);
  }
}

export function createProviders(services: Omit<Services, 'providers'>): ProvidersService {
  return new ProvidersServiceImpl(services.workspace);
}

// Re-export for pipeline use
export { validateStageOutput } from './schema-validator';
