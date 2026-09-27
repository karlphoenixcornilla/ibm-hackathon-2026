// contracts/host.ts — interfaces the host (backend, extension, tests) injects into core.
// These replace the VS Code APIs the extension used directly:
//   FileSystem   ← workspace.fs
//   TokenStore   ← ExtensionContext.secrets
//   AuthProvider ← authentication.getSession / showInputBox
//   ConfigSource ← reading .reprise.yml via workspace.fs + a file watcher

import type { Event } from './events';

/**
 * File access rooted at the linked repository.
 * Paths are relative to the repository root, using forward slashes.
 * Implementations throw (or reject) on failure; core wraps errors in Results.
 */
export interface FileSystem {
  /** Human-readable root (a path, URL or label), or null when no repository is linked. */
  getRoot(): string | null;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, content: Uint8Array): Promise<void>;
}

/**
 * Where the GitHub token is kept between calls.
 * `get` may return synchronously so a pre-seeded store (e.g. a per-request token)
 * is visible to `AuthService.getToken()` immediately after construction.
 */
export interface TokenStore {
  get(): string | null | Promise<string | null>;
  set(token: string): Promise<void>;
  delete(): Promise<void>;
}

/** Obtains a new GitHub token during sign-in (OAuth, a prompt, a request header…). */
export interface AuthProvider {
  /** Resolve to a token, or null if the user cancelled. */
  acquireToken(): Promise<string | null>;
}

/** Supplies the text of .reprise.yml. */
export interface ConfigSource {
  /** Return the file's text, or null if the repository has no .reprise.yml. */
  read(): Promise<string | null>;
  /** Where the config came from (for messages), or null. */
  location(): string | null;
  /** Optional: fires when the file changes so the cached config is invalidated. */
  onDidChange?: Event<void>;
}
