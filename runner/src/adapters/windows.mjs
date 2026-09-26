// src/adapters/windows.mjs — Windows platform adapter
// Spec: 02-specs/test-execution.md §Adapters (windows row)
// Host: Windows. Prerequisite: all commands listed in platforms.windows.prereq
// are present on PATH.

import { execSync } from 'node:child_process';

/**
 * Check whether a command exists on PATH.
 * @param {string} cmd
 * @returns {boolean}
 */
function commandExists(cmd) {
  try {
    execSync(`where ${cmd}`, { stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

/**
 * Run prerequisite checks for the windows platform.
 * @param {import('../config.mjs').RunnerConfig} config
 * @returns {{ local_possible: boolean; missing: string[] }}
 */
export function checkPrereqs(config) {
  const pc = config?.platforms?.windows;
  if (!pc) return { local_possible: false, missing: ['platforms.windows not configured in .reprise.yml'] };

  const missing = [];

  // Check prereq commands
  for (const cmd of pc.prereq ?? []) {
    if (!commandExists(cmd)) {
      missing.push(`Command not found: ${cmd}`);
    }
  }

  return { local_possible: missing.length === 0, missing };
}

/**
 * Return the repository test command for the requested mode.
 * @param {import('../config.mjs').RunnerConfig} config
 * @param {'single'|'all'|'lint'} mode
 * @returns {string}
 */
export function getCommand(config, mode) {
  const pc = config?.platforms?.windows;
  if (!pc) throw new Error('platforms.windows not configured');
  if (mode === 'single') return pc.test?.single ?? '';
  if (mode === 'all') return pc.test?.all ?? '';
  if (mode === 'lint') return pc.lint ?? '';
  throw new Error(`Unknown mode: ${mode}`);
}
