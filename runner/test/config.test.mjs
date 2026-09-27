// test/config.test.mjs — unit tests for the .reprise.yml parser
// Covers: trailing comments (fix #18), inline flow maps (fix #18).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../src/config.mjs';

/**
 * Write a temporary .reprise.yml and load it.
 * @param {string} yml
 */
function load(yml) {
  const dir = join(tmpdir(), `reprise-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '.reprise.yml'), yml, 'utf8');
  return loadConfig(dir);
}

// ── Fix #18: trailing inline comments stripped ────────────────────────────────

describe('YAML parser — trailing comment stripping (fix #18)', () => {
  it('strips a trailing # comment from a plain scalar', () => {
    const cfg = load([
      'version: 3',
      'defaults:',
      '  executor: local                    # local | ci',
    ].join('\n'));
    assert.equal(cfg.defaults.executor, 'local', 'executor should be "local", not "local # ..."');
  });

  it('strips a trailing # comment from a number', () => {
    const cfg = load([
      'version: 3',
      'verify:',
      '  max_runs: 200                      # cap at 200',
    ].join('\n'));
    assert.equal(typeof cfg.verify.max_runs, 'number', 'max_runs should be a number, not a string');
    assert.equal(cfg.verify.max_runs, 200);
  });

  it('strips a trailing # comment from a boolean', () => {
    const cfg = load([
      'version: 3',
      'fix:',
      '  draft_pr: true                     # PD-28',
    ].join('\n'));
    assert.equal(cfg.fix.draft_pr, true, 'draft_pr should be boolean true');
  });

  it('does NOT strip # inside a quoted string', () => {
    const cfg = load([
      'version: 3',
      'fix:',
      '  max_rounds: 3',
      'platforms:',
      '  linux:',
      '    test:',
      '      pattern: "**/*.spec.ts # not a comment"',
    ].join('\n'));
    assert.ok(
      cfg.platforms.linux.test.pattern.includes('#'),
      'quoted # should be kept inside the string'
    );
  });
});

// ── Fix #18: inline flow maps parsed ─────────────────────────────────────────

describe('YAML parser — inline flow map parsing (fix #18)', () => {
  it('parses a simple inline flow map', () => {
    const cfg = load([
      'version: 3',
      'platforms:',
      '  windows:',
      '    trials: { min: 5, max: 10, max_minutes: 20 }',
    ].join('\n'));
    const trials = cfg.platforms.windows.trials;
    assert.equal(typeof trials, 'object', 'trials should be an object');
    assert.equal(trials.min, 5);
    assert.equal(trials.max, 10);
    assert.equal(trials.max_minutes, 20);
  });

  it('parses an inline flow map with a trailing comment', () => {
    const cfg = load([
      'version: 3',
      'platforms:',
      '  android:',
      '    trials: { min: 5, max: 10, max_minutes: 20 }   # optional override',
    ].join('\n'));
    const trials = cfg.platforms.android.trials;
    assert.equal(typeof trials, 'object');
    assert.equal(trials.min, 5);
  });

  it('parses an empty inline flow map {} as an empty object', () => {
    const cfg = load('version: 3\nplatforms:\n  linux: {}\n');
    assert.equal(typeof cfg.platforms.linux, 'object');
  });
});

// ── verify.max_runs guard is enforced with comments in config ─────────────────

describe('verify.max_runs parsed correctly from commented config', () => {
  it('max_runs is a number even with a comment on the same line', () => {
    const cfg = load([
      'version: 3',
      'verify:',
      '  min_runs: 3',
      '  max_runs: 200   # cap',
      '  regression_reruns: 3',
    ].join('\n'));
    assert.equal(cfg.verify.max_runs, 200);
    // Ensure the guard comparison works: 201 > 200 should be true
    assert.ok(201 > cfg.verify.max_runs, 'numeric comparison must work');
  });
});
