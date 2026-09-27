// src/repo.mjs — worktree management for base/head refs (PD-24)
// Spec: 02-specs/local-runner.md §Checks on POST /runs (ref handling)
//
// Worktrees use unique temporary directories and only local commit objects.
// They are removed when verification finishes or the runner exits.

import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

/** Each request gets an isolated local worktree; no fetch or checkout in the source clone. */
export async function getOrCreateWorktree(root, _remote, sha) {
  if (!/^[a-f0-9]{7,64}$/i.test(sha)) throw new Error('Worktree ref must be a commit SHA');
  execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd: root, stdio: 'pipe' });
  const worktreeDir = mkdtempSync(join(tmpdir(), 'reprise-worktree-'));
  try {
    execFileSync('git', ['worktree', 'add', '--detach', worktreeDir, sha], { cwd: root, stdio: 'pipe' });
    return worktreeDir;
  } catch (error) {
    rmSync(worktreeDir, { recursive: true, force: true });
    throw new Error(`Failed to create local worktree: ${error.message}`);
  }
}

/**
 * Remove a worktree that is no longer needed.
 * @param {string} root
 * @param {string} worktreePath
 */
export async function removeWorktree(root, worktreePath) {
  if (!existsSync(worktreePath)) return;
  try {
    execFileSync('git', ['worktree', 'remove', '--force', worktreePath], {
      cwd: root,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    // fallback: plain directory removal
  }
  try {
    rmSync(worktreePath, { recursive: true, force: true });
  } catch { /**/ }
}

/**
 * Remove all worktrees for this runner session (called on shutdown).
 * @param {string} root
 * @param {string} remote
 * @param {Set<string>} activePaths
 */
export async function removeAllWorktrees(root, remote, activePaths) {
  for (const p of activePaths) {
    await removeWorktree(root, p);
  }
}

/**
 * Track of worktree paths created in this session.
 * Exported so server.mjs can register and clean up on SIGINT.
 * @type {Set<string>}
 */
export const activeWorktrees = new Set();
