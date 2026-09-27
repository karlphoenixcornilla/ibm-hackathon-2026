// workspace/ — file reads/writes through an injected FileSystem, SHA-256
// Owned by: T1
// Spec: 02-specs/github-connection.md §Linking a repository

import type { WorkspaceService } from '../contracts/services';
import type { FileSystem } from '../contracts/host';
import { Result } from '../util/result';
import { sha256 } from '../util/sha256';

export { parseGitConfigOrigin, extractOwnerRepo, resolveHeadSha } from '../util/git-helpers';

export function createWorkspace(fs: FileSystem): WorkspaceService {

  function getRoot(): string | null {
    return fs.getRoot();
  }

  async function readFile(path: string): Promise<Result<Uint8Array, string>> {
    if (getRoot() === null) { return Result.err('No repository is linked.'); }
    try {
      return Result.ok(await fs.readFile(path));
    } catch (err) {
      return Result.err(`Cannot read ${path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function writeFile(
    path: string,
    content: Uint8Array
  ): Promise<Result<void, string>> {
    if (getRoot() === null) { return Result.err('No repository is linked.'); }
    try {
      await fs.writeFile(path, content);
      return Result.ok(undefined);
    } catch (err) {
      return Result.err(`Cannot write ${path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { readFile, writeFile, sha256, getRoot };
}
