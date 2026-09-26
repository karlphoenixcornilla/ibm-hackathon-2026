// workspace/ — file reads/writes through workspace.fs, SHA-256
// Owned by: T1
// Spec: 02-specs/github-connection.md §Linking a repository, 02-specs/browser-runtime.md

import * as vscode from 'vscode';
import type { WorkspaceService } from '../contracts/services';
import { Result } from '../util/result';

export { parseGitConfigOrigin, extractOwnerRepo, resolveHeadSha } from '../util/git-helpers';

export function createWorkspace(): WorkspaceService {

  function getRootUri(): vscode.Uri | null {
    return vscode.workspace.workspaceFolders?.[0]?.uri ?? null;
  }

  async function readFile(path: string): Promise<Result<Uint8Array, string>> {
    const root = getRootUri();
    if (!root) { return Result.err('No workspace folder is open.'); }
    try {
      const uri = vscode.Uri.joinPath(root, path);
      const bytes = await vscode.workspace.fs.readFile(uri);
      return Result.ok(bytes);
    } catch (err) {
      return Result.err(`Cannot read ${path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function writeFile(
    path: string,
    content: Uint8Array
  ): Promise<Result<void, string>> {
    const root = getRootUri();
    if (!root) { return Result.err('No workspace folder is open.'); }
    try {
      const uri = vscode.Uri.joinPath(root, path);
      await vscode.workspace.fs.writeFile(uri, content);
      return Result.ok(undefined);
    } catch (err) {
      return Result.err(`Cannot write ${path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function sha256(bytes: Uint8Array): Promise<string> {
    const buffer = await crypto.subtle.digest('SHA-256', bytes.buffer as ArrayBuffer);
    return Array.from(new Uint8Array(buffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  return { readFile, writeFile, sha256, getRootUri };
}
