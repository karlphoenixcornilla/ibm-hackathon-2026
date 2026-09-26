// src/adapters/linux.mjs — Linux platform adapter
// Spec: 02-specs/test-execution.md §Adapters (linux row)
// Host: Linux. Prereqs: commands listed in platforms.linux.prereq on PATH.
// Note: driver fallback only if gate G-13 passes (PD-9).

import { execSync } from 'node:child_process';

/**
 * @param {string} cmd
 * @returns {boolean}
 */
function commandExists(cmd) {
  try {
    execSync(`which ${cmd}`, { stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {import('../config.mjs').RunnerConfig} config
 * @returns {{ local_possible: boolean; missing: string[] }}
 */
export function checkPrereqs(config) {
  const pc = config?.platforms?.linux;
  if (!pc) return { local_possible: false, missing: ['platforms.linux not configured in .reprise.yml'] };

  const missing = [];

  for (const cmd of pc.prereq ?? []) {
    if (!commandExists(cmd)) missing.push(`Command not found: ${cmd}`);
  }

  return { local_possible: missing.length === 0, missing };
}

/**
 * @param {import('../config.mjs').RunnerConfig} config
 * @param {'single'|'all'|'lint'} mode
 * @returns {string}
 */
export function getCommand(config, mode) {
  const pc = config?.platforms?.linux;
  if (!pc) throw new Error('platforms.linux not configured');
  if (mode === 'single') return pc.test?.single ?? '';
  if (mode === 'all') return pc.test?.all ?? '';
  if (mode === 'lint') return pc.lint ?? '';
  throw new Error(`Unknown mode: ${mode}`);
}
