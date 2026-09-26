// src/adapters/macos.mjs — macOS platform adapter
// Spec: 02-specs/test-execution.md §Adapters (macos row)
// Host: macOS with Xcode. Prereqs: xcodebuild on PATH (if configured).

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
  const pc = config?.platforms?.macos;
  if (!pc) return { local_possible: false, missing: ['platforms.macos not configured in .reprise.yml'] };

  const missing = [];

  // xcodebuild only needed if configured (some macOS apps use it)
  if (pc.test?.single?.includes('xcodebuild') || pc.test?.all?.includes('xcodebuild')) {
    if (!commandExists('xcodebuild')) {
      missing.push('xcodebuild not found (Xcode required for this project)');
    }
  }

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
  const pc = config?.platforms?.macos;
  if (!pc) throw new Error('platforms.macos not configured');
  if (mode === 'single') return pc.test?.single ?? '';
  if (mode === 'all') return pc.test?.all ?? '';
  if (mode === 'lint') return pc.lint ?? '';
  throw new Error(`Unknown mode: ${mode}`);
}
