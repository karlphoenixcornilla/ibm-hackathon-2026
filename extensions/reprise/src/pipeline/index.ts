// pipeline/ — intake, dedupe, test provide/validate, trials, verdict, diagnosis
// Owned by: T3
// Spec: 02-specs/replication-pipeline.md
import type { Services } from '../contracts/services';

export function createPipeline(_services: Omit<Services, 'pipeline'>): import('../contracts/services').PipelineService {
  throw new Error('Not implemented yet (track T3)');
}
