// src/repo.mjs — worktree management for base/head refs (PD-24)
// Spec: 02-specs/local-runner.md §Checks on POST /runs (ref handling)
//
// Worktrees are created under ~/.reprise-runner/worktrees/<repo>/<sha>
// and removed when the verification finishes or the runner exits.

import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execSync, execFileSync } from 'node:child_process';

/**
 * Base cache directory for runner worktrees.
 * @returns {string}
 */
function cacheBase() {
  return join(homedir(), '.reprise-runner', 'worktrees');
}

/**
 * Derive a short repo name from the remote URL or root path.
 * @param {string} root
 * @param {string} remote
 * @returns {string}
 */
function repoName(root, remote) {
  if (remote) {
    const m = remote.match(/\/([^/]+?)(?:\.git)?$/);
    if (m) return m[1];
  }
  return root.split(/[/\\]/).pop() ?? 'repo';
}

/**
 * Get the path of the worktree for a given SHA.
 * Creates it if it doesn't exist.
 *
 * @param {string} root       Absolute path to the main clone (--root)
 * @param {string} remote     Repository remote URL (for naming)
 * @param {string} sha        Full or abbreviated commit SHA
 * @returns {Promise<string>} Absolute path to the worktree
 */
export async function getOrCreateWorktree(root, remote, sha) {
  const name = repoName(root, remote);
  const worktreeDir = join(cacheBase(), name, sha);

  if (existsSync(worktreeDir)) {
    return worktreeDir;
  }

  mkdirSync(worktreeDir, { recursive: true });

  try {
    // Fetch the ref in case it isn't present locally
    try {
      execSync(`git fetch --quiet origin ${sha}`, {
        cwd: root,
        stdio: ['pipe', 'pipe', 'pipe'],
        encoding: 'utf8',
      });
    } catch {
      // May already be present; proceed
    }

    execFileSync('git', ['worktree', 'add', '--detach', worktreeDir, sha], {
      cwd: root,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    return worktreeDir;
  } catch (err) {
    // Clean up failed directory
    try { rmSync(worktreeDir, { recursive: true, force: true }); } catch { /**/ }
    throw new Error(`Failed to create worktree for ${sha}: ${err instanceof Error ? err.message : String(err)}`);
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
