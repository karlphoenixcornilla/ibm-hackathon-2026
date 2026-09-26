// github/ — repository linking, issues, Git Data API, PRs, workflow dispatch
// Owned by: T1
// Spec: 02-specs/github-connection.md
import type { Services } from '../contracts/services';

export function createGitHub(_services: Omit<Services, 'github'>): import('../contracts/services').GitHubService {
  throw new Error('Not implemented yet (track T1)');
}
