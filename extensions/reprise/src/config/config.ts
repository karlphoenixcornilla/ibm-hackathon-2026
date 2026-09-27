// config/config.ts — load and validate .reprise.yml v3
// Fully implemented by base plan. All tracks depend on this.
// Spec: 02-specs/reprise-config.md

import type { ConfigService, RepriseConfig, WorkspaceService } from '../contracts/services';
import { Result } from '../util/result';

const REPRISE_YML = '.reprise.yml';

/**
 * Parses a .reprise.yml object (already parsed from YAML) into RepriseConfig,
 * applying defaults and normalising the `trials` field.
 */
function normaliseConfig(raw: Record<string, unknown>): RepriseConfig {
  const version = (raw['version'] as number | undefined) ?? 3;
  const issues = (raw['issues'] as { labels?: string[] } | undefined) ?? {};
  const defaults = (raw['defaults'] as Record<string, unknown> | undefined) ?? {};
  const fix = (raw['fix'] as Record<string, unknown> | undefined) ?? {};
  const verify = (raw['verify'] as Record<string, unknown> | undefined) ?? {};
  const editScope = (raw['edit_scope'] as Record<string, unknown> | undefined) ?? {};

  // Normalise trials: a plain number means a fixed count (min=max=n)
  let trials: RepriseConfig['defaults']['trials'];
  const rawTrials = defaults['trials'];
  if (typeof rawTrials === 'number') {
    trials = { min: rawTrials, max: rawTrials, limit: 100, max_minutes: null };
  } else if (rawTrials && typeof rawTrials === 'object') {
    const t = rawTrials as Record<string, unknown>;
    trials = {
      min: (t['min'] as number) ?? 10,
      max: (t['max'] as number) ?? 20,
      limit: (t['limit'] as number) ?? 100,
      max_minutes: (t['max_minutes'] as number | null) ?? null,
    };
  } else {
    trials = { min: 10, max: 20, limit: 100, max_minutes: null };
  }

  return {
    version,
    issues: { labels: (issues['labels'] as string[]) ?? ['bug'] },
    components: (raw['components'] as string[]) ?? [],
    defaults: {
      executor: ((defaults['executor'] as string) ?? 'local') as 'local' | 'ci',
      trials,
      max_test_attempts: (defaults['max_test_attempts'] as number) ?? 3,
    },
    fix: {
      candidates: (fix['candidates'] as number) ?? 3,
      quick_runs: (fix['quick_runs'] as number) ?? 5,
      max_rounds: (fix['max_rounds'] as number) ?? 3,
      candidate_executor: ((fix['candidate_executor'] as string) ?? 'auto') as 'auto' | 'ci' | 'local',
      draft_pr: (fix['draft_pr'] as boolean) ?? true,
      self_review: (fix['self_review'] as boolean) ?? true,
    },
    verify: {
      min_runs: (verify['min_runs'] as number) ?? 3,
      max_runs: (verify['max_runs'] as number) ?? 200,
      regression_reruns: (verify['regression_reruns'] as number) ?? 3,
    },
    edit_scope: {
      test: (editScope['test'] as string[]) ?? [],
      fix: (editScope['fix'] as string[]) ?? [],
      never: (editScope['never'] as string[]) ?? ['.github/**', '.reprise.yml', '.reprise/**'],
    },
    platforms: (raw['platforms'] as RepriseConfig['platforms']) ?? {},
  };
}

export function createConfig(workspace: WorkspaceService): ConfigService {
  let cachedConfig: RepriseConfig | null = null;
  let cachedUri: string | null = null;

  async function load(): Promise<Result<RepriseConfig, string>> {
    try {
      const result = await workspace.readFile(REPRISE_YML);
      if (!result.ok) return Result.err(result.error);
      const bytes = result.value;
      const text = new TextDecoder().decode(bytes);

      // Load the YAML parser only when configuration is requested.
      const yaml = await import('js-yaml');
      const raw = yaml.load(text) as Record<string, unknown> | null;

      if (!raw || typeof raw !== 'object') {
        return Result.err('.reprise.yml is empty or not a YAML mapping.');
      }

      const config = normaliseConfig(raw);
      cachedConfig = config;
      cachedUri = REPRISE_YML;
      return Result.ok(config);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return Result.err(`Failed to read .reprise.yml: ${msg}`);
    }
  }

  function get(): RepriseConfig | null {
    return cachedConfig;
  }

  function getUri(): string | null {
    return cachedUri;
  }

  function invalidate(): void {
    cachedConfig = null;
    cachedUri = null;
  }

  return { load, get, getUri, invalidate };
}
