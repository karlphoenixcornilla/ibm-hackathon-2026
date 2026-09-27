// providers/stub-provider.ts — Stub provider reading from workspace.fs
// Owned by: T3
// Spec: 02-specs/ai-providers.md §Stub provider, PD-11

import type { CancellationToken } from '../contracts/events';
import type { Provider, StageRequest, StageResponse } from '../contracts/provider';
import type { WorkspaceService } from '../contracts/services';
import { validateStageOutput } from './schema-validator';

export class StubProvider implements Provider {
  readonly id = 'stub';
  readonly capabilities = { images: false, implemented: true };

  constructor(private readonly workspace: WorkspaceService) {}

  async run(req: StageRequest, _token: CancellationToken): Promise<StageResponse> {
    const { stage, issue, vars } = req;

    // Determine the stub file path
    // fix stage: support candidates via vars.candidate
    let filename = `${stage}.json`;
    if (stage === 'fix' && vars['candidate'] && vars['candidate'] !== '1') {
      filename = `fix-${vars['candidate']}.json`;
    }

    const stubPath = `.reprise/stubs/${issue}/${filename}`;
    const fileResult = await this.workspace.readFile(stubPath);

    if (!fileResult.ok) {
      throw new Error(`No stub response for stage ${stage} on #${issue}`);
    }

    let json: unknown;
    try {
      const text = new TextDecoder().decode(fileResult.value);
      json = JSON.parse(text);
    } catch (e) {
      throw new Error(`Stub file ${stubPath} is not valid JSON: ${String(e)}`);
    }

    // Validate against stage schema; attempt one repair pass (stubs should be valid)
    const validationError = validateStageOutput(stage, json);
    if (validationError) {
      throw new Error(
        `Stub ${stubPath} failed schema validation: ${validationError}. ` +
          `Stubs cannot revise; edit the test or choose your own.`
      );
    }

    // Collect any associated file(s) for the stage
    const files: Array<{ path: string; content: string }> = [];
    if (stage === 'test') {
      const testOutput = json as { test_file?: string };
      if (testOutput.test_file) {
        const filePath = `.reprise/stubs/${issue}/test/${testOutput.test_file}`;
        const contentResult = await this.workspace.readFile(filePath);
        if (contentResult.ok) {
          files.push({
            path: testOutput.test_file,
            content: new TextDecoder().decode(contentResult.value),
          });
        }
      }
    } else if (stage === 'fix') {
      const fixOutput = json as { files_changed?: string[] };
      const candidateDir = vars['candidate'] && vars['candidate'] !== '1'
        ? `fix-${vars['candidate']}`
        : 'fix';
      for (const filePath of fixOutput.files_changed ?? []) {
        const stubFilePath = `.reprise/stubs/${issue}/${candidateDir}/${filePath}`;
        const contentResult = await this.workspace.readFile(stubFilePath);
        if (contentResult.ok) {
          files.push({
            path: filePath,
            content: new TextDecoder().decode(contentResult.value),
          });
        }
      }
    }

    return {
      json,
      files,
      usage: { calls: 1, detail: { [stage]: 1 } },
      provider: 'stub',
      stubbed: true,
    };
  }
}
