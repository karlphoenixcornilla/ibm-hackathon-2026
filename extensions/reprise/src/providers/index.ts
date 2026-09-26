// providers/ — Provider interface, stub provider, placeholders for claude/bob/gemini/groq
// Owned by: T3
// Spec: 02-specs/ai-providers.md, ADR-4
import type { Services, ProvidersService } from '../contracts/services';

export function createProviders(_services: Omit<Services, 'providers'>): ProvidersService {
  throw new Error('Not implemented yet (track T3)');
}
