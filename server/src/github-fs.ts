// github-fs.ts — a read-only FileSystem over the GitHub contents API (default branch).
// Lets hosted core read .reprise.yml and source files without a checkout.
// Writes go to the user's machine through the runner (#31), never from here.

import type { FileSystem } from '@reprise/core';

export interface GitHubFileSystemOptions {
  repo: string;
  token: string;
  fetchImpl?: typeof fetch;
}

export function createGitHubFileSystem(opts: GitHubFileSystemOptions): FileSystem {
  const doFetch = opts.fetchImpl ?? fetch;
  return {
    getRoot: () => `github:${opts.repo}`,
    async readFile(path: string): Promise<Uint8Array> {
      const encoded = path.split('/').map(encodeURIComponent).join('/');
      const res = await doFetch(`https://api.github.com/repos/${opts.repo}/contents/${encoded}`, {
        headers: {
          Authorization: `Bearer ${opts.token}`,
          Accept: 'application/vnd.github.raw+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });
      if (!res.ok) { throw new Error(`GitHub contents ${res.status} for ${path}`); }
      return new Uint8Array(await res.arrayBuffer());
    },
    async writeFile(): Promise<void> {
      throw new Error('Read-only: the hosted backend does not write repository files (local writes go through the runner).');
    },
  };
}
