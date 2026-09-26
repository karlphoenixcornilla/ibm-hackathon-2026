// contracts/provider.ts — Provider interface and per-stage output types
// FROZEN after base-v1. Change only via change request (CR).
// Spec: 02-specs/ai-providers.md, 02-specs/data-contracts.md §Provider stage outputs

import type * as vscode from 'vscode';
import type { Stage, Platform, SignatureKind } from './enums';

// ── Per-stage output shapes ──────────────────────────────────────────────────

export interface IntakeOutput {
  fingerprint: {
    platform: Platform | 'unknown';
    component: string;
    functions: string[];
    symptom: string;
    trigger: string;
    expected: string;
    actual: string;
    error_signature: string;
  };
  attempt_possible: boolean;
  missing: string[];
  question: string;
}

export interface DedupeOutput {
  same_bug: boolean;
  reason: string;
}

export interface TestOutput {
  test_file: string;
  signature: { kind: SignatureKind; pattern: string };
  rationale: string;
}

export interface RootcauseOutput {
  summary: string;
  locations: Array<{ file: string; start_line: number; end_line: number; reason: string }>;
  fix_direction: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface FixOutput {
  summary: string;
  files_changed: string[];
  risk_notes: string;
  tests_added: string[];
}

export interface ReviewOutput {
  verdict: 'ok' | 'changes_needed';
  findings: Array<{ file: string; line: number; severity: 'high' | 'medium' | 'low'; message: string }>;
}

export type StageOutput = IntakeOutput | DedupeOutput | TestOutput | RootcauseOutput | FixOutput | ReviewOutput;

// ── Provider interface ───────────────────────────────────────────────────────

export interface StageRequest {
  stage: Stage;
  issue: number;
  repo: string;
  vars: Record<string, string>;
  attempt: number;
  previous?: unknown;
}

export interface StageResponse {
  json: unknown;
  files: Array<{ path: string; content: string }>;
  usage: { calls: number; detail: Record<string, number> };
  provider: string;
  stubbed: boolean;
}

export interface Provider {
  id: string;
  capabilities: { images: boolean; implemented: boolean };
  run(req: StageRequest, token: vscode.CancellationToken): Promise<StageResponse>;
}
