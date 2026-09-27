// providers/bob/bob-provider.ts — IBM Bob provider (R-5, ADR-4, V-6).
// Bob Shell is a CLI (`bob run`), so it cannot run in the browser: this provider
// renders the kit's runtime prompt and sends it to the paired Reprise Runner's
// POST /ai/run bridge, which runs Bob headless in the repository clone with only
// the read tool group enabled. Bob never receives the GitHub token (the runner
// strips it) and never edits files: file proposals come back in the JSON answer
// and go through the normal edit_scope + approval path (PD-10).

import type * as vscode from 'vscode';
import type { Provider, StageRequest, StageResponse } from '../../contracts/provider';
import type { RunnerClientService } from '../../contracts/services';
import type { AiRunResponse } from '../../contracts/runner-api';
import { validateStageOutput } from '../schema-validator';
import { buildPrompt, extractJsonObject, splitFiles } from './format';
import { buildStageVars, type BobContextDeps } from './context';

export interface BobProviderDeps extends BobContextDeps {
  runnerClient: Pick<RunnerClientService, 'isPaired' | 'runAi'>;
}

export class BobProvider implements Provider {
  readonly id = 'bob';
  readonly capabilities = { images: false, implemented: true };

  constructor(private readonly deps: BobProviderDeps) {}

  async run(req: StageRequest, token: vscode.CancellationToken): Promise<StageResponse> {
    const { runnerClient } = this.deps;
    if (!runnerClient.runAi) {
      throw new Error('IBM Bob needs a Reprise Runner with the Bob bridge (runner 0.1.0+).');
    }
    if (!runnerClient.isPaired()) {
      throw new Error('IBM Bob runs through the Reprise Runner. Use "Reprise: Connect Runner" first.');
    }

    const vars = await buildStageVars(req, this.deps);

    // A caller-driven repair (e.g. diagnosis.ts attempt 2) passes the error and previous answer.
    const callerRepair =
      req.vars['validation_error'] && req.previous !== undefined
        ? { error: req.vars['validation_error'], previous: JSON.stringify(req.previous) }
        : undefined;

    const usage = { calls: 0, detail: {} as Record<string, number> };
    const addUsage = (r: AiRunResponse): void => {
      usage.calls += 1;
      const d = usage.detail;
      d[req.stage] = (d[req.stage] ?? 0) + 1;
      d['input_tokens'] = (d['input_tokens'] ?? 0) + r.stats.input_tokens;
      d['output_tokens'] = (d['output_tokens'] ?? 0) + r.stats.output_tokens;
      d['tool_calls'] = (d['tool_calls'] ?? 0) + r.stats.tool_calls;
      d['bobcoins'] = Math.round(((d['bobcoins'] ?? 0) + r.stats.session_costs) * 10_000) / 10_000;
      d['duration_ms'] = (d['duration_ms'] ?? 0) + r.stats.duration_ms;
    };

    const ask = async (repair?: { error: string; previous: string }): Promise<AiRunResponse> => {
      const res = await runnerClient.runAi!(
        { provider: 'bob', stage: req.stage, prompt: buildPrompt(req.stage, vars, repair) },
        token
      );
      if (!res.ok) throw new Error(`IBM Bob (${req.stage}): ${res.error}`);
      addUsage(res.value);
      if (res.value.status !== 'success') {
        throw new Error(`IBM Bob (${req.stage}) did not finish: ${res.value.last_message.slice(0, 300) || 'no message'}`);
      }
      return res.value;
    };

    /** Parse, split files and validate; returns the error text or the parsed answer. */
    const check = (answer: AiRunResponse): { ok: true; json: unknown; files: StageResponse['files'] } | { ok: false; error: string } => {
      try {
        const { json, files } = splitFiles(req.stage, extractJsonObject(answer.last_message));
        const err = validateStageOutput(req.stage, json);
        return err ? { ok: false, error: err } : { ok: true, json, files };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    };

    // One repair attempt (ai-providers.md: invalid after at most one repair is an error).
    const first = await ask(callerRepair);
    let result = check(first);
    if (!result.ok) {
      if (token.isCancellationRequested) throw new Error('Cancelled');
      const second = await ask({ error: result.error, previous: first.last_message });
      result = check(second);
      if (!result.ok) {
        throw new Error(`IBM Bob (${req.stage}) output failed the stage schema after one repair: ${result.error}`);
      }
    }

    return {
      json: result.json,
      files: result.files,
      usage,
      provider: 'bob',
      stubbed: false,
    };
  }
}
