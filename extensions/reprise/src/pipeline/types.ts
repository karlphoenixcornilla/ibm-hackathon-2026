// pipeline/types.ts — shared types for pipeline stages
// Owned by: T3

import type { IssueRecord } from '../contracts/records';
import type { Services, TrialsPolicy } from '../contracts/services';
import type * as vscode from 'vscode';

export interface PipelineContext {
  repo: string;
  issue: number;
  record: IssueRecord;
  services: Omit<Services, 'pipeline'>;
  trialsOverride?: Partial<TrialsPolicy>;
  token: vscode.CancellationToken;
  /** Append an event to the record. */
  addEvent(type: string, detail?: string): void;
}

export interface StageResult {
  ok: boolean;
  /** If false, contains the reason the pipeline should stop. */
  error?: string;
  /** Indicates a terminal state has been set on the record. */
  terminal?: boolean;
}

export interface Stage {
  run(ctx: PipelineContext): Promise<StageResult>;
}
