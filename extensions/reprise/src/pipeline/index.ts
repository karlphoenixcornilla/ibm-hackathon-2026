// pipeline/ — intake, dedupe, test provide/validate, trials, verdict, diagnosis
// Owned by: T3
// Spec: 02-specs/replication-pipeline.md
import type { Services, PipelineService } from '../contracts/services';

export function createPipeline(_services: Omit<Services, 'pipeline'>): PipelineService {
  throw new Error('Not implemented yet (track T3)');
}
