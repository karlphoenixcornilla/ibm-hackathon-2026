// patch.ts — apply a unified diff (the agent's or the user's edited fix) to file contents.
// Originals are read through a callback (the runner at the run's HEAD), so the result is
// exactly what a worktree at that commit plus the fix would contain.

import { applyPatch, parsePatch } from 'diff';

/** The diff cannot be applied; `file` names the file at fault ('' when it's the diff as a whole). */
export class PatchError extends Error {
  constructor(readonly file: string, message: string) { super(message); }
}

function cleanName(name: string | undefined): string | null {
  if (!name || name === '/dev/null') { return null; }
  const [path = ''] = name.split('\t');
  return path.replace(/^[ab]\//, '');
}

function isSafePath(p: string): boolean {
  return !p.startsWith('/') && !p.includes('\\') && p.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}

/** Apply every file patch in `diff`; return the new full contents. Deletions and renames are not supported yet. */
export async function applyUnifiedDiff(
  diff: string,
  read: (path: string) => Promise<string>,
): Promise<Array<{ path: string; content: string }>> {
  const out: Array<{ path: string; content: string }> = [];
  for (const patch of parsePatch(diff)) {
    const oldPath = cleanName(patch.oldFileName);
    const newPath = cleanName(patch.newFileName);
    if (!oldPath && !newPath) { continue; }
    if (!newPath) { throw new PatchError(oldPath ?? '', `Deleting files is not supported yet (${oldPath}).`); }
    if (oldPath && oldPath !== newPath) { throw new PatchError(newPath, `Renames are not supported yet (${oldPath} → ${newPath}).`); }
    if (!isSafePath(newPath)) { throw new PatchError(newPath, `${newPath} is not a path inside the repository.`); }

    let original = '';
    if (oldPath) {
      try {
        original = await read(oldPath);
      } catch (err) {
        throw new PatchError(oldPath, `Cannot read ${oldPath}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const patched = applyPatch(original, patch);
    if (patched === false) {
      throw new PatchError(newPath, `The diff does not apply cleanly to ${newPath} at the runner's HEAD.`);
    }
    out.push({ path: newPath, content: patched });
  }
  if (out.length === 0) { throw new PatchError('', 'The diff contains no file changes.'); }
  return out;
}
