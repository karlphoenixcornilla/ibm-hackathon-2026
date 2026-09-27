// util/stage-output-validator.ts — JSON schema validation for stage outputs
// Shared validation for provider responses and pipeline diagnosis
// Spec: 02-specs/data-contracts.md §Provider stage outputs, ai-providers.md

import type { Stage } from '../contracts/enums';

// Inline JSON schema validation without AJV for browser compatibility.
// Each validator returns null on success or an error string.

type Validator = (json: unknown) => string | null;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function requireString(obj: Record<string, unknown>, key: string): string | null {
  if (typeof obj[key] !== 'string') return `"${key}" must be a string`;
  return null;
}

function requireBoolean(obj: Record<string, unknown>, key: string): string | null {
  if (typeof obj[key] !== 'boolean') return `"${key}" must be a boolean`;
  return null;
}

function requireArray(obj: Record<string, unknown>, key: string): string | null {
  if (!Array.isArray(obj[key])) return `"${key}" must be an array`;
  return null;
}

const PLATFORMS = new Set(['windows', 'android', 'ios', 'macos', 'linux', 'unknown']);
const SIGNATURE_KINDS = new Set(['assertion_message', 'error_type', 'output_regex', 'timeout']);
const CONFIDENCES = new Set(['high', 'medium', 'low']);

const validators: Record<string, Validator> = {
  intake(json) {
    if (!isObject(json)) return 'intake output must be an object';
    const fp = json['fingerprint'];
    if (!isObject(fp)) return '"fingerprint" must be an object';
    if (!PLATFORMS.has(fp['platform'] as string))
      return `"fingerprint.platform" must be one of: ${[...PLATFORMS].join(', ')}`;
    const err =
      requireString(fp, 'component') ||
      requireArray(fp, 'functions') ||
      requireString(fp, 'symptom') ||
      requireString(fp, 'trigger') ||
      requireString(fp, 'expected') ||
      requireString(fp, 'actual') ||
      requireString(fp, 'error_signature');
    if (err) return err;
    return (
      requireBoolean(json, 'attempt_possible') ||
      requireArray(json, 'missing') ||
      requireString(json, 'question')
    );
  },

  dedupe(json) {
    if (!isObject(json)) return 'dedupe output must be an object';
    return requireBoolean(json, 'same_bug') || requireString(json, 'reason');
  },

  test(json) {
    if (!isObject(json)) return 'test output must be an object';
    const sig = json['signature'];
    if (!isObject(sig)) return '"signature" must be an object';
    if (!SIGNATURE_KINDS.has(sig['kind'] as string))
      return `"signature.kind" must be one of: ${[...SIGNATURE_KINDS].join(', ')}`;
    if (typeof sig['pattern'] !== 'string') return '"signature.pattern" must be a string';
    return requireString(json, 'test_file') || requireString(json, 'rationale');
  },

  rootcause(json) {
    if (!isObject(json)) return 'rootcause output must be an object';
    if (!Array.isArray(json['locations'])) return '"locations" must be an array';
    if (!CONFIDENCES.has(json['confidence'] as string))
      return `"confidence" must be one of: ${[...CONFIDENCES].join(', ')}`;
    return (
      requireString(json, 'summary') ||
      requireString(json, 'fix_direction')
    );
  },

  fix(json) {
    if (!isObject(json)) return 'fix output must be an object';
    return (
      requireString(json, 'summary') ||
      requireArray(json, 'files_changed') ||
      requireString(json, 'risk_notes') ||
      requireArray(json, 'tests_added')
    );
  },

  review(json) {
    if (!isObject(json)) return 'review output must be an object';
    if (!['ok', 'changes_needed'].includes(json['verdict'] as string))
      return '"verdict" must be "ok" or "changes_needed"';
    return requireArray(json, 'findings');
  },
};

/**
 * Validate a provider stage output against its schema.
 * Returns null on success, or an error string describing the first failure.
 */
export function validateStageOutput(stage: Stage | string, json: unknown): string | null {
  const validator = validators[stage];
  if (!validator) return `Unknown stage: ${stage}`;
  return validator(json);
}
