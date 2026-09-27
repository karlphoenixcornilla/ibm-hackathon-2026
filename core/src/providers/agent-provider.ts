// providers/agent-provider.ts — real agentic provider backed by an HTTP endpoint.
// Owned by: pivot (#32). Spec: 02-specs/ai-providers.md, pivot epic #27.
//
// Talks to a chat-completions proxy (an AWS Lambda Function URL in front of
// Amazon Bedrock's Converse API — see pivot issue #30). The proxy accepts
//   { messages: [{ role, content }], max_tokens }
// and returns
//   { text: "<assistant reply>", usage?, stopReason? }
//
// For each pipeline stage this provider prompts the model for a single JSON
// object matching that stage's schema, validates it, and (for `test`/`fix`)
// separates any emitted file contents into StageResponse.files.

import type { CancellationToken } from '../contracts/events';
import type { Provider, StageRequest, StageResponse } from '../contracts/provider';
import type { Stage } from '../contracts/enums';
import { validateStageOutput } from './schema-validator';

/** Default endpoint: the deployed Lambda Function URL (Bedrock proxy). Override via options/config. */
export const DEFAULT_AGENT_URL =
  'https://ph5evx5rmocwiqk34zsxoet7va0muygl.lambda-url.ap-southeast-2.on.aws/';

type FetchLike = typeof fetch;

export interface AgentProviderOptions {
  /** Chat-completions proxy URL. Default: DEFAULT_AGENT_URL. */
  url?: string;
  /** fetch implementation (injectable for tests). Default: global fetch. */
  fetchImpl?: FetchLike;
  /** Max tokens per completion. Default: 2048. */
  maxTokens?: number;
  /**
   * Origin header sent with each request. The proxy checks an origin allow-list;
   * server-side callers have no Origin, so we set one that the proxy allows.
   * Browsers set Origin themselves and ignore this value.
   */
  origin?: string;
  /** Provider id shown in the picker / recorded on issue records. Default: 'bedrock'. */
  id?: string;
}

const SYSTEM_PROMPT =
  'You are Reprise, an automated software-delivery agent. You are given one ' +
  'stage of a bug-replication-and-fix pipeline. Respond with EXACTLY ONE JSON ' +
  'object and nothing else — no prose, no explanation, no markdown code fences. ' +
  'Use the exact field names requested. If you cannot complete the task, still ' +
  'return the JSON shape with best-effort values.';

/** Per-stage description of the required JSON shape. Mirrors contracts/provider.ts. */
const STAGE_INSTRUCTIONS: Record<Stage, string> = {
  intake:
    'Stage: intake. Produce a bug fingerprint from the issue. Return JSON:\n' +
    '{"fingerprint":{"platform":"windows|android|ios|macos|linux|unknown","component":"","functions":[],"symptom":"","trigger":"","expected":"","actual":"","error_signature":""},"attempt_possible":true,"missing":[],"question":""}\n' +
    'Set attempt_possible=false and fill "question" only if the report lacks what is needed to reproduce it.',
  dedupe:
    'Stage: dedupe. Decide whether this issue is the same bug as the candidate described in the context. Return JSON:\n' +
    '{"same_bug":false,"reason":""}',
  test:
    'Stage: test. Write a single automated test that reproduces the bug. Return JSON:\n' +
    '{"test_file":"<relative/path/to/test>","signature":{"kind":"assertion_message|error_type|output_regex|timeout","pattern":"<regex matching the failure>"},"rationale":"","files":[{"path":"<same as test_file>","content":"<full source of the test file>"}]}',
  rootcause:
    'Stage: rootcause. Explain where and why the bug happens. Return JSON:\n' +
    '{"summary":"","locations":[{"file":"","start_line":1,"end_line":1,"reason":""}],"fix_direction":"","confidence":"high|medium|low"}',
  fix:
    'Stage: fix. Propose a concrete code change that fixes the bug. Return JSON:\n' +
    '{"summary":"","files_changed":["<relative/path>"],"risk_notes":"","tests_added":[],"files":[{"path":"<relative/path>","content":"<full new content of that file>"}]}\n' +
    'Every path in files_changed must have a matching entry in files.',
  review:
    'Stage: review. Review the proposed change for correctness and risk. Return JSON:\n' +
    '{"verdict":"ok|changes_needed","findings":[{"file":"","line":1,"severity":"high|medium|low","message":""}]}',
};

/** Strip markdown fences and isolate the outermost JSON object. */
function extractJson(text: string): unknown {
  let t = text.trim();
  // Remove a leading ```json / ``` fence and trailing ```
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first === -1 || last === -1 || last < first) {
    throw new Error('Agent response did not contain a JSON object');
  }
  return JSON.parse(t.slice(first, last + 1));
}

/** Split a `files` array off the stage JSON (used by test/fix); other stages have none. */
function splitFiles(
  parsed: unknown
): { json: unknown; files: Array<{ path: string; content: string }> } {
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>)['files'])) {
    const obj = { ...(parsed as Record<string, unknown>) };
    const rawFiles = obj['files'] as unknown[];
    delete obj['files'];
    const files = rawFiles
      .filter((f): f is { path: string; content: string } =>
        !!f && typeof (f as Record<string, unknown>)['path'] === 'string' &&
        typeof (f as Record<string, unknown>)['content'] === 'string')
      .map((f) => ({ path: f.path, content: f.content }));
    return { json: obj, files };
  }
  return { json: parsed, files: [] };
}

export class AgentProvider implements Provider {
  readonly id: string;
  readonly capabilities = { images: false, implemented: true };

  private readonly url: string;
  private readonly fetchImpl: FetchLike;
  private readonly maxTokens: number;
  private readonly origin: string;

  constructor(opts: AgentProviderOptions = {}) {
    this.id = opts.id ?? 'bedrock';
    this.url = opts.url ?? DEFAULT_AGENT_URL;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.maxTokens = opts.maxTokens ?? 2048;
    this.origin = opts.origin ?? 'https://karlphoenixcornilla.github.io';
  }

  async run(req: StageRequest, token: CancellationToken): Promise<StageResponse> {
    if (token.isCancellationRequested) { throw new Error('Cancelled'); }

    let calls = 0;
    const ask = async (userContent: string): Promise<string> => {
      calls++;
      return this.call(userContent, token);
    };

    const first = await ask(buildUserPrompt(req));
    let parsed: unknown;
    let split: ReturnType<typeof splitFiles>;
    try {
      parsed = extractJson(first);
      split = splitFiles(parsed);
    } catch {
      // couldn't parse JSON — treat as a validation failure and try one repair pass
      split = { json: undefined, files: [] };
    }

    let err = split.json === undefined ? 'no JSON object' : validateStageOutput(req.stage, split.json);
    if (err) {
      const repair = await ask(buildRepairPrompt(req, first, err));
      parsed = extractJson(repair); // may throw — surfaces a clear error
      split = splitFiles(parsed);
      err = validateStageOutput(req.stage, split.json);
      if (err) {
        throw new Error(`Agent output failed schema validation for stage "${req.stage}": ${err}`);
      }
    }

    return {
      json: split.json,
      files: split.files,
      usage: { calls, detail: { [req.stage]: calls } },
      provider: this.id,
      stubbed: false,
    };
  }

  private async call(userContent: string, token: CancellationToken): Promise<string> {
    if (token.isCancellationRequested) { throw new Error('Cancelled'); }
    let res: Response;
    try {
      res = await this.fetchImpl(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: this.origin },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userContent },
          ],
          max_tokens: this.maxTokens,
        }),
      });
    } catch (e) {
      throw new Error(`Agent endpoint unreachable: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Agent endpoint returned ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = (await res.json().catch(() => null)) as { text?: string; output?: string } | null;
    const text = data?.text ?? data?.output ?? '';
    if (!text) { throw new Error('Agent endpoint returned no text'); }
    return text;
  }
}

/** Build the user prompt: stage instruction + all available context. */
function buildUserPrompt(req: StageRequest): string {
  const parts = [
    STAGE_INSTRUCTIONS[req.stage],
    '',
    `Repository: ${req.repo}`,
    `Issue: #${req.issue}`,
    `Attempt: ${req.attempt}`,
  ];
  if (req.vars && Object.keys(req.vars).length > 0) {
    parts.push('Context:', JSON.stringify(req.vars, null, 2));
  }
  if (req.previous !== undefined) {
    parts.push('Previous attempt (revise it):', JSON.stringify(req.previous, null, 2));
  }
  return parts.join('\n');
}

function buildRepairPrompt(req: StageRequest, previousText: string, error: string): string {
  return [
    `Your previous response for stage "${req.stage}" was not valid: ${error}`,
    'Previous response:',
    previousText,
    '',
    'Return ONLY the corrected JSON object, matching this shape exactly:',
    STAGE_INSTRUCTIONS[req.stage],
  ].join('\n');
}

/** Factory mirroring the other create* helpers. */
export function createAgentProvider(opts: AgentProviderOptions = {}): AgentProvider {
  return new AgentProvider(opts);
}
