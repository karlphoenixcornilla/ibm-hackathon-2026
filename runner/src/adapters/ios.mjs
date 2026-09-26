// src/adapters/ios.mjs — iOS platform adapter
// Spec: 02-specs/test-execution.md §Adapters (ios row)
// Host: macOS with Xcode. Prereqs: xcodebuild on PATH, configured simulator/device.

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
 * Check whether the configured simulator name is available.
 * @param {string | undefined} device
 * @returns {boolean}
 */
function simulatorAvailable(device) {
  if (!device) return true; // assume available if not configured
  try {
    const out = execSync('xcrun simctl list devices --json', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const data = JSON.parse(out);
    const devices = Object.values(data.devices ?? {}).flat();
    return /** @type {Array<{name:string;state:string}>} */ (devices).some(
      d => d.name === device && d.state === 'Booted'
    );
  } catch {
    return false;
  }
}

/**
 * @param {import('../config.mjs').RunnerConfig} config
 * @returns {{ local_possible: boolean; missing: string[] }}
 */
export function checkPrereqs(config) {
  const pc = config?.platforms?.ios;
  if (!pc) return { local_possible: false, missing: ['platforms.ios not configured in .reprise.yml'] };

  const missing = [];

  if (!commandExists('xcodebuild')) {
    missing.push('xcodebuild not found (Xcode required)');
  }

  if (pc.device && !simulatorAvailable(pc.device)) {
    missing.push(`Simulator "${pc.device}" is not booted or not found`);
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
  const pc = config?.platforms?.ios;
  if (!pc) throw new Error('platforms.ios not configured');
  if (mode === 'single') return pc.test?.single ?? '';
  if (mode === 'all') return pc.test?.all ?? '';
  if (mode === 'lint') return pc.lint ?? '';
  throw new Error(`Unknown mode: ${mode}`);
}
