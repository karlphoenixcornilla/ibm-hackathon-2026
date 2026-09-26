// pipeline/index.ts — PipelineService factory
// Owned by: T3
// Spec: 02-specs/replication-pipeline.md

import type { Services, PipelineService } from '../contracts/services';
import { PipelineOrchestrator } from './orchestrator';

export function createPipeline(services: Omit<Services, 'pipeline'>): PipelineService {
  return new PipelineOrchestrator(services);
}
