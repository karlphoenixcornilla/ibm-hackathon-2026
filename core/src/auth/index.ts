// auth/ — GitHub sign-in through an injected AuthProvider, persisted in an injected TokenStore
// Owned by: T1
// Spec: 02-specs/github-connection.md, ADR-3

import type { AuthService } from '../contracts/services';
import type { AuthProvider, TokenStore } from '../contracts/host';
import { Result } from '../util/result';
import { Emitter } from '../util/events';

export interface AuthDeps {
  tokenStore: TokenStore;
  /** How signIn() obtains a new token. Without one, signIn() fails and only a pre-seeded token works. */
  provider?: AuthProvider;
  /** Check a freshly acquired token. Defaults to GET https://api.github.com/user === 200. */
  validateToken?: (token: string) => Promise<boolean>;
}

export function createAuth(deps: AuthDeps): AuthService {
  const { tokenStore, provider } = deps;
  const validateToken = deps.validateToken ?? validateWithGitHub;
  const emitter = new Emitter<{ signedIn: boolean }>();
  let cachedToken: string | null = null;

  // Restore from the TokenStore. A synchronous store is applied immediately so a
  // per-request token is visible to getToken() right after construction.
  function applyRestored(stored: string | null): void {
    if (stored && cachedToken === null) {
      cachedToken = stored;
      emitter.fire({ signedIn: true });
    }
  }
  const stored = tokenStore.get();
  if (stored instanceof Promise) {
    stored.then(applyRestored, () => undefined);
  } else {
    applyRestored(stored);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  async function signIn(): Promise<Result<string, string>> {
    if (!provider) { return Result.err('No GitHub sign-in method is configured.'); }

    let token: string | null;
    try {
      token = await provider.acquireToken();
    } catch (err) {
      return Result.err(`Sign in failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!token) { return Result.err('Sign in cancelled.'); }

    if (!(await validateToken(token))) {
      return Result.err(
        'The token was rejected by GitHub (GET /user returned non-200). ' +
        'Check it has not expired and has at least Contents and Metadata read permissions.'
      );
    }

    await tokenStore.set(token);
    cachedToken = token;
    emitter.fire({ signedIn: true });
    return Result.ok(token);
  }

  async function signOut(): Promise<void> {
    await tokenStore.delete();
    cachedToken = null;
    emitter.fire({ signedIn: false });
  }

  function getToken(): string | null { return cachedToken; }
  function isSignedIn(): boolean { return cachedToken !== null; }

  return { signIn, signOut, getToken, isSignedIn, onDidChangeSession: emitter.event };
}

/** A TokenStore held in memory (per session / per request). Never written to disk. */
export function createMemoryTokenStore(initial: string | null = null): TokenStore {
  let token = initial;
  return {
    get: () => token,
    set: async (t) => { token = t; },
    delete: async () => { token = null; },
  };
}

async function validateWithGitHub(token: string): Promise<boolean> {
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    return res.status === 200;
  } catch {
    return false;
  }
}
