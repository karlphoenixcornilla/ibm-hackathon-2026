// providers/index.ts — ProvidersService factory
// Owned by: T3
// Spec: 02-specs/ai-providers.md, ADR-4

import type * as vscode from 'vscode';
import type { Services, ProvidersService } from '../contracts/services';
import type { Provider, StageRequest, StageResponse } from '../contracts/provider';
import { Result as R } from '../util/result';
import type { Result } from '../util/result';
import { StubProvider } from './stub-provider';

// ── Unimplemented placeholder providers ──────────────────────────────────────

class UnimplementedProvider implements Provider {
  constructor(public readonly id: string) {}
  readonly capabilities = { images: false, implemented: false };

  async run(_req: StageRequest, _token: vscode.CancellationToken): Promise<StageResponse> {
    throw new Error(`Provider ${this.id} is not implemented yet`);
  }
}

// ── ProvidersService implementation ───────────────────────────────────────────

class ProvidersServiceImpl implements ProvidersService {
  private readonly providers: Provider[];
  private activeId: string;

  // Minimal event emitter — no vscode at construction time
  private listeners: Array<(e: { id: string }) => void> = [];
  readonly onDidChangeProvider: vscode.Event<{ id: string }> = (
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

/**
 * Handler for the "Reprise: Select Provider" command.
 * The command is pre-declared in package.json (base frozen).
 * Shows a quick-pick and calls providers.setActive().
 */
export async function handleSelectProvider(
  providers: ProvidersService,
  vscodeApi: typeof vscode
): Promise<void> {
  const items = providers.list().map((p) => ({
    label: p.id,
    description: p.capabilities.implemented ? 'active' : 'not implemented',
    detail: p.id === providers.getActive().id ? '$(check) Current' : undefined,
  }));

  const picked = await vscodeApi.window.showQuickPick(items, {
    title: 'Reprise: Select Provider',
    placeHolder: 'Choose AI provider',
  });

  if (!picked) return;

  if (picked.description === 'not implemented') {
    vscodeApi.window.showInformationMessage(
      `Provider ${picked.label} is not implemented yet. Keeping ${providers.getActive().id}.`
    );
    return;
  }

  const result = providers.setActive(picked.label);
  if (!result.ok) {
    vscodeApi.window.showErrorMessage(`Failed to set provider: ${result.error}`);
  }
}

// Re-export for pipeline use
export { validateStageOutput } from './schema-validator';
