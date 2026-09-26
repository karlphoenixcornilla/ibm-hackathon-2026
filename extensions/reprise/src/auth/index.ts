// auth/ — GitHub sign-in: built-in provider (G-7) or fine-grained token (PD-23)
// Owned by: T1
// Spec: 02-specs/github-connection.md, ADR-3

import * as vscode from 'vscode';
import type { AuthService } from '../contracts/services';
import { Result } from '../util/result';

const GITHUB_AUTH_PROVIDER = 'github';
const GITHUB_SCOPES = ['repo', 'read:user'];
const SECRET_KEY = 'reprise.githubToken';

export function createAuth(
  context: vscode.ExtensionContext
): AuthService {
  const emitter = new vscode.EventEmitter<{ signedIn: boolean }>();
  let cachedToken: string | null = null;

  // Restore from SecretStorage on first call
  let restored = false;
  async function restoreToken(): Promise<void> {
    if (restored) { return; }
    restored = true;
    const stored = await context.secrets.get(SECRET_KEY);
    if (stored) {
      cachedToken = stored;
      emitter.fire({ signedIn: true });
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  async function validateToken(token: string): Promise<boolean> {
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

  // ── G-7: try vscode.authentication (built-in GitHub provider) ────────────

  async function tryBuiltinAuth(): Promise<string | null> {
    try {
      const session = await vscode.authentication.getSession(
        GITHUB_AUTH_PROVIDER,
        GITHUB_SCOPES,
        { createIfNone: true }
      );
      return session?.accessToken ?? null;
    } catch {
      // Not available in this web host — fall through to PD-23
      return null;
    }
  }

  // ── PD-23: fine-grained personal access token prompt ─────────────────────

  async function promptForToken(): Promise<string | null> {
    const token = await vscode.window.showInputBox({
      title: 'Reprise: Sign in to GitHub',
      prompt:
        'Enter a GitHub fine-grained personal access token. ' +
        'Required permissions: Contents (read/write), Metadata (read), ' +
        'Issues (read), Pull requests (read/write), Actions (read/write).',
      password: true,
      placeHolder: 'github_pat_…',
      ignoreFocusOut: true,
    });
    return token ?? null;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  async function signIn(): Promise<Result<string, string>> {
    // G-7: built-in provider
    let token = await tryBuiltinAuth();

    if (!token) {
      // PD-23 fallback: user-supplied fine-grained token
      const raw = await promptForToken();
      if (!raw) { return Result.err('Sign in cancelled.'); }
      const valid = await validateToken(raw);
      if (!valid) {
        return Result.err(
          'The token was rejected by GitHub (GET /user returned non-200). ' +
          'Check it has not expired and has at least Contents and Metadata read permissions.'
        );
      }
      token = raw;
    }

    await context.secrets.store(SECRET_KEY, token);
    cachedToken = token;
    emitter.fire({ signedIn: true });
    return Result.ok(token);
  }

  async function signOut(): Promise<void> {
    await context.secrets.delete(SECRET_KEY);
    cachedToken = null;
    emitter.fire({ signedIn: false });
  }

  function getToken(): string | null { return cachedToken; }
  function isSignedIn(): boolean { return cachedToken !== null; }

  // Kick off secret restoration asynchronously on construction
  restoreToken();

  return { signIn, signOut, getToken, isSignedIn, onDidChangeSession: emitter.event };
}
