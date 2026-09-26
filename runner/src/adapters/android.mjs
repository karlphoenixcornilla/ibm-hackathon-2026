// src/adapters/android.mjs — Android platform adapter
// Spec: 02-specs/test-execution.md §Adapters (android row)
// Host: Any host with Android SDK. Prereqs: adb on PATH, device/emulator listed.

import { execSync } from 'node:child_process';

/**
 * @param {string} cmd
 * @returns {boolean}
 */
function commandExists(cmd) {
  try {
    const which = process.platform === 'win32' ? 'where' : 'which';
    execSync(`${which} ${cmd}`, { stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check whether the configured device (adb serial or emulator name) is connected.
 * @param {string | undefined} device
 * @returns {boolean}
 */
function deviceConnected(device) {
  try {
    const out = execSync('adb devices', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    const lines = out.split('\n').slice(1).filter(l => l.includes('\tdevice'));
    if (!device) return lines.length > 0; // any device
    return lines.some(l => l.startsWith(device));
  } catch {
    return false;
  }
}

/**
 * @param {import('../config.mjs').RunnerConfig} config
 * @returns {{ local_possible: boolean; missing: string[] }}
 */
export function checkPrereqs(config) {
  const pc = config?.platforms?.android;
  if (!pc) return { local_possible: false, missing: ['platforms.android not configured in .reprise.yml'] };

  const missing = [];

  if (!commandExists('adb')) {
    missing.push('adb not found on PATH (Android SDK required)');
  } else if (!deviceConnected(pc.device)) {
    missing.push(pc.device
      ? `Device "${pc.device}" not connected or not found in adb devices`
      : 'No Android device or emulator connected');
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
  const pc = config?.platforms?.android;
  if (!pc) throw new Error('platforms.android not configured');
  if (mode === 'single') return pc.test?.single ?? '';
  if (mode === 'all') return pc.test?.all ?? '';
  if (mode === 'lint') return pc.lint ?? '';
  throw new Error(`Unknown mode: ${mode}`);
}
