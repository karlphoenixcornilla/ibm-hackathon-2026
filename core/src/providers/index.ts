// providers/index.ts — ProvidersService factory
// Owned by: T3
// Spec: 02-specs/ai-providers.md, ADR-4

import type { CancellationToken, Event } from '../contracts/events';
import type { Services, ProvidersService } from '../contracts/services';
import type { Provider, StageRequest, StageResponse } from '../contracts/provider';
import { Result as R } from '../util/result';
import type { Result } from '../util/result';
import { Emitter } from '../util/events';
import { StubProvider } from './stub-provider';

// ── Unimplemented placeholder providers ──────────────────────────────────────

class UnimplementedProvider implements Provider {
  constructor(public readonly id: string) {}
  readonly capabilities = { images: false, implemented: false };

  async run(_req: StageRequest, _token: CancellationToken): Promise<StageResponse> {
    throw new Error(`Provider ${this.id} is not implemented yet`);
  }
}

// ── ProvidersService implementation ───────────────────────────────────────────

class ProvidersServiceImpl implements ProvidersService {
  private readonly providers: Provider[];
  private activeId: string;

  private readonly emitter = new Emitter<{ id: string }>();
  readonly onDidChangeProvider: Event<{ id: string }> = this.emitter.event;

  constructor(workspace: Services['workspace'], options: ProvidersOptions) {
    const builtIn: Provider[] = [
      new StubProvider(workspace),
      new UnimplementedProvider('claude'),
      new UnimplementedProvider('bob'),
      new UnimplementedProvider('gemini'),
      new UnimplementedProvider('groq'),
    ];
    // Injected providers replace a built-in with the same id, or are appended.
    const extra = options.providers ?? [];
    this.providers = [
      ...builtIn.map((p) => extra.find((e) => e.id === p.id) ?? p),
      ...extra.filter((e) => !builtIn.some((p) => p.id === e.id)),
    ];
    this.activeId = 'stub';
    if (options.active) {
      const r = this.setActive(options.active);
      if (!r.ok) throw new Error(r.error);
    }
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
    this.emitter.fire({ id });
    return R.ok(undefined);
  }
}

export interface ProvidersOptions {
  /** Real providers (e.g. the agentic provider) to register alongside the stub. */
  providers?: Provider[];
  /** Id of the provider to make active. Must be implemented. Default: 'stub'. */
  active?: string;
}

export function createProviders(
  services: Omit<Services, 'providers'>,
  options: ProvidersOptions = {}
): ProvidersService {
  return new ProvidersServiceImpl(services.workspace, options);
}

// Re-export for pipeline use
export { validateStageOutput } from './schema-validator';
