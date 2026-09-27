// api/remote.ts — does a git remote URL point at a given GitHub owner/repo? (browser-safe)

/**
 * True when `remote` is a GitHub remote for `repo` ("owner/name"), in any of the usual
 * forms (https, ssh, scp-like, with or without .git), compared case-insensitively.
 */
export function remoteMatches(remote: string, repo: string): boolean {
  const m = remote.trim().match(/github\.com[/:]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  return m !== null && `${m[1]}/${m[2]}`.toLowerCase() === repo.toLowerCase();
}
