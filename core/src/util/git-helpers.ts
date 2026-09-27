// workspace/git-helpers.ts — pure .git file parsing helpers (no editor dependency)
// Owned by: T1
// Used by: workspace/index.ts, github/index.ts, and unit tests

/**
 * Parse .git/config text and return the `url` of the `origin` remote.
 * Returns null if no origin remote is found.
 */
export function parseGitConfigOrigin(configText: string): string | null {
  const sectionRe = /\[remote\s+"origin"\]/gi;
  const urlRe = /^\s*url\s*=\s*(.+)$/m;

  const match = sectionRe.exec(configText);
  if (!match) { return null; }

  // Slice from the section start to the next section header (or end of string)
  const afterSection = configText.slice(match.index + match[0].length);
  const nextSection = afterSection.search(/^\s*\[/m);
  const sectionBody = nextSection === -1 ? afterSection : afterSection.slice(0, nextSection);

  const urlMatch = urlRe.exec(sectionBody);
  return urlMatch ? urlMatch[1].trim() : null;
}

/**
 * Extract owner/repo from a GitHub remote URL.
 * Handles HTTPS (https://github.com/owner/repo.git) and
 * SSH (git@github.com:owner/repo.git) forms.
 * Returns null if the URL is not a github.com remote.
 */
export function extractOwnerRepo(remoteUrl: string): string | null {
  const httpsMatch = /github\.com\/([^/]+\/[^/]+?)(?:\.git)?\s*$/.exec(remoteUrl);
  if (httpsMatch) { return httpsMatch[1]; }

  const sshMatch = /github\.com:([^/]+\/[^/]+?)(?:\.git)?\s*$/.exec(remoteUrl);
  if (sshMatch) { return sshMatch[1]; }

  return null;
}

/**
 * Resolve the current HEAD SHA from .git/HEAD, loose ref files, and packed-refs.
 *
 * headText   — contents of .git/HEAD
 * refsReader — reads a ref path (e.g. refs/heads/main) → text or null
 * packedRefs — contents of .git/packed-refs (may be empty string)
 */
export async function resolveHeadSha(
  headText: string,
  refsReader: (refPath: string) => Promise<string | null>,
  packedRefs: string
): Promise<string | null> {
  const refLine = headText.trim();

  // Detached HEAD: bare 40-char SHA
  if (/^[0-9a-f]{40}$/i.test(refLine)) { return refLine; }

  // Symbolic ref: ref: refs/heads/main
  const symRef = /^ref:\s*(.+)$/.exec(refLine);
  if (!symRef) { return null; }
  const refPath = symRef[1].trim();

  // Try loose ref file first
  const loose = await refsReader(refPath);
  if (loose) { return loose.trim().slice(0, 40) || null; }

  // Fall back to packed-refs
  for (const line of packedRefs.split('\n')) {
    if (line.startsWith('#')) { continue; }
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 2 && parts[1] === refPath) {
      return parts[0].slice(0, 40);
    }
  }

  return null;
}
