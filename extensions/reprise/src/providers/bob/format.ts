// providers/bob/format.ts — prompt rendering and answer parsing for the IBM Bob provider.
// Pure functions (no vscode, no network) so they are unit-tested directly.
// Spec: 03-runtime-prompts/README.md, 02-specs/security.md T2, ai-providers.md

import type { Stage } from '../../contracts/enums';
import { PROMPTS, SCHEMAS } from './prompts';

/** Stages whose answer carries file proposals (ai-providers.md). */
export const FILE_STAGES: ReadonlySet<Stage> = new Set<Stage>(['test', 'fix']);

/** Longest value inserted for one variable; keeps prompts inside the runner's limit. */
export const MAX_VAR_CHARS = 60_000;

/**
 * Wrap reporter text as untrusted data (security.md T2): the text sits inside
 * <untrusted_report> tags and any closing tag inside it is escaped, so the
 * report cannot end the block early and pose as instructions.
 */
export function wrapUntrusted(text: string): string {
  const escaped = text.replace(/<\s*\/\s*untrusted_report\s*>/gi, '&lt;/untrusted_report&gt;');
  return `<untrusted_report>\n${escaped}\n</untrusted_report>`;
}

function clip(value: string): string {
  return value.length > MAX_VAR_CHARS
    ? `${value.slice(0, MAX_VAR_CHARS)}\n[… truncated ${value.length - MAX_VAR_CHARS} characters]`
    : value;
}

/**
 * Fill a stage template. Every variable in the front matter must be present in
 * `vars` (an empty string is allowed: "empty on the first attempt").
 * `untrusted_report` and `pr_diff` are wrapped as untrusted data.
 */
export function renderTemplate(stage: Stage, vars: Record<string, string>): string {
  const template = PROMPTS[stage];
  const missing = template.variables.filter((v) => vars[v] === undefined);
  if (missing.length > 0) {
    throw new Error(`Prompt ${stage}: missing variable(s) ${missing.join(', ')}`);
  }
  return template.body.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => {
    const value = vars[name];
    if (value === undefined) {
      throw new Error(`Prompt ${stage}: template uses undeclared variable ${name}`);
    }
    if (name === 'untrusted_report' || name === 'pr_diff') return wrapUntrusted(clip(value));
    return clip(value);
  });
}

/**
 * The full prompt: template, then the output contract (schema + one JSON object),
 * plus a repair section when a previous answer failed validation.
 */
export function buildPrompt(
  stage: Stage,
  vars: Record<string, string>,
  repair?: { error: string; previous: string }
): string {
  const parts = [renderTemplate(stage, vars)];

  parts.push(
    'You may read files in this repository to answer. Do not edit files and do not run commands; ' +
      'Reprise applies and runs everything itself after the user reviews it.'
  );

  let schema = SCHEMAS[stage];
  if (FILE_STAGES.has(stage)) {
    parts.push(
      'Return file proposals inside the same JSON object under an extra key "files": ' +
        '[{"path": "<repository-relative path>", "content": "<full new file content>"}]. ' +
        'Paths use forward slashes and never contain "..".'
    );
    const parsed = JSON.parse(schema) as { required: string[]; properties: Record<string, unknown> };
    parsed.required = [...parsed.required, 'files'];
    parsed.properties = {
      ...parsed.properties,
      files: {
        type: 'array',
        items: {
          type: 'object',
          required: ['path', 'content'],
          properties: { path: { type: 'string' }, content: { type: 'string' } },
        },
      },
    };
    schema = JSON.stringify(parsed);
  }

  parts.push(`JSON Schema of your answer:\n${schema}`);

  if (repair) {
    parts.push(
      `Your previous answer was rejected: ${repair.error}\n` +
        `Previous answer (for reference):\n${clip(repair.previous)}\n` +
        'Correct it so it matches the schema exactly.'
    );
  }

  parts.push('Reply with one JSON object and nothing else.');
  return parts.join('\n\n');
}

/**
 * Pull the first complete top-level JSON object out of a model answer.
 * Accepts bare JSON, ```json fences, or JSON surrounded by prose.
 */
export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch { /* fall through */ }

  const fence = trimmed.match(/```(?:json)?\s*\n([\s\S]*?)\n\s*```/);
  if (fence) {
    try {
      return JSON.parse(fence[1]);
    } catch { /* fall through */ }
  }

  // Scan for a balanced {...}, respecting strings and escapes.
  for (let start = trimmed.indexOf('{'); start !== -1; start = trimmed.indexOf('{', start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(trimmed.slice(start, i + 1));
          } catch {
            break;
          }
        }
      }
    }
  }
  throw new Error('The answer contains no JSON object');
}

export interface SplitAnswer {
  json: unknown;
  files: Array<{ path: string; content: string }>;
}

/**
 * Separate file proposals from the stage output. Invalid entries (bad shape,
 * absolute paths, "..") are an error so the repair attempt can fix them.
 */
export function splitFiles(stage: Stage, answer: unknown): SplitAnswer {
  if (typeof answer !== 'object' || answer === null || Array.isArray(answer)) {
    return { json: answer, files: [] };
  }
  const { files: rawFiles, ...json } = answer as Record<string, unknown>;
  if (!FILE_STAGES.has(stage) || rawFiles === undefined) {
    return { json, files: [] };
  }
  if (!Array.isArray(rawFiles)) throw new Error('"files" must be an array');

  const files = rawFiles.map((f, i) => {
    const entry = f as Record<string, unknown>;
    if (typeof entry?.['path'] !== 'string' || typeof entry['content'] !== 'string') {
      throw new Error(`"files[${i}]" needs string "path" and "content"`);
    }
    const path = entry['path'].replace(/\\/g, '/').replace(/^\.\//, '');
    if (path.startsWith('/') || /^[A-Za-z]:/.test(path) || path.split('/').includes('..')) {
      throw new Error(`"files[${i}].path" must be repository-relative without ".." (got ${entry['path']})`);
    }
    return { path, content: entry['content'] };
  });
  return { json, files };
}
