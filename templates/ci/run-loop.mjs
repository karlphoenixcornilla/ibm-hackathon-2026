#!/usr/bin/env node
// templates/ci/run-loop.mjs — Reprise CI run loop
// Owned by: T4.  Spec: 02-specs/test-execution.md §CI executor.
// Committed to the repository as .reprise/ci/run-loop.mjs by "Set Up CI Runs".
// Node.js only; no external dependencies.
// Reads .reprise.yml, runs the configured test command REPRISE_RUNS times,
// and writes results/run-NN/{exit_code,output.txt,results.json}.

import { execSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

// ── Environment inputs (from workflow_dispatch) ───────────────────────────────
const platform  = process.env.REPRISE_PLATFORM  ?? 'linux';
const mode      = process.env.REPRISE_MODE      ?? 'single';
const testPath  = process.env.REPRISE_TEST_PATH ?? '';
const runs      = parseInt(process.env.REPRISE_RUNS ?? '1', 10);

// ── Load .reprise.yml ─────────────────────────────────────────────────────────
// Minimal YAML parser for the subset used by .reprise.yml (no external deps).
function loadConfig() {
  const path = join(process.cwd(), '.reprise.yml');
  if (!existsSync(path)) {
    throw new Error('.reprise.yml not found in repository root.');
  }
  const text = readFileSync(path, 'utf8');
  return parseRepriseYml(text);
}

/**
 * Tiny line-by-line YAML parser for .reprise.yml.
 * Handles only the subset needed: top-level keys and nested platform configs.
 * Full YAML parsing would require a dependency; this keeps the file dependency-free.
 */
function parseRepriseYml(text) {
  // We only need platforms.<platform>.test.{single,all} and .shell/.cwd.
  // Use a very simple indent-aware parser.
  const lines = text.split('\n');
  const root = {};
  const stack = [{ obj: root, indent: -1 }];

  for (const raw of lines) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const indent = raw.match(/^(\s*)/)[1].length;
    const match = raw.match(/^\s*([\w_-]+)\s*:\s*(.*)/);
    if (!match) continue;
    const [, key, val] = match;

    // Pop stack to current indent level
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    const parent = stack[stack.length - 1].obj;

    if (val.trim() === '' || val.trim() === '{}') {
      parent[key] = {};
      stack.push({ obj: parent[key], indent });
    } else {
      // Strip inline quotes
      parent[key] = val.trim().replace(/^['"]|['"]$/g, '');
    }
  }
  return root;
}

// ── Resolve command to run ────────────────────────────────────────────────────
function resolveCommand(config) {
  const plat = (config.platforms ?? {})[platform] ?? {};
  const test = plat.test ?? {};
  const shell = plat.shell ?? 'bash';
  const cwd = plat.cwd ?? '.';

  let cmd;
  if (mode === 'single' && testPath && test.single) {
    // Replace {file} placeholder with the test path, quoted for the shell.
    cmd = test.single.replace(/\{file\}/g, `"${testPath}"`);
  } else if (mode === 'all' && test.all) {
    cmd = test.all;
  } else {
    throw new Error(
      `No test command configured for platform "${platform}" mode "${mode}" in .reprise.yml.`
    );
  }

  const reportPath = test.report_path ?? null;
  return { cmd, shell, cwd, reportPath };
}

// ── Run one iteration ─────────────────────────────────────────────────────────
function runOnce(cmd, shell, cwd, timeoutSeconds) {
  const start = Date.now();
  // Delete stale report before each run.
  // (reportPath deletion handled by caller)

  const shellArgs = shell === 'pwsh' || shell === 'powershell'
    ? ['-NonInteractive', '-Command', cmd]
    : shell === 'cmd'
      ? ['/c', cmd]
      : ['-c', cmd];

  const result = spawnSync(shell, shellArgs, {
    cwd,
    encoding: 'utf8',
    timeout: (timeoutSeconds ?? 600) * 1000,
    maxBuffer: 50 * 1024 * 1024,
  });

  const duration_ms = Date.now() - start;
  const output = (result.stdout ?? '') + (result.stderr ?? '');
  const timed_out = result.signal === 'SIGTERM' || result.error?.code === 'ETIMEDOUT';
  const exit_code = timed_out ? null : (result.status ?? 1);

  return { exit_code, timed_out, duration_ms, output };
}

// ── Parse JUnit XML into TestResult[] ────────────────────────────────────────
function parseJUnit(xmlPath) {
  if (!existsSync(xmlPath)) return [];
  const xml = readFileSync(xmlPath, 'utf8');
  const results = [];

  // Minimal regex-based JUnit parser (no dependencies).
  const caseRe = /<testcase\s([^>]*)>([\s\S]*?)<\/testcase>|<testcase\s([^>]*)\/>/g;
  let m;
  while ((m = caseRe.exec(xml)) !== null) {
    const attrs = m[1] ?? m[3] ?? '';
    const body  = m[2] ?? '';
    const name      = (attrs.match(/name="([^"]*)"/) ?? [])[1] ?? '';
    const classname = (attrs.match(/classname="([^"]*)"/) ?? [])[1] ?? '';
    const id = classname ? `${classname}::${name}` : name;

    let status = 'passed';
    let message = '';
    let output = '';

    const failMatch   = body.match(/<failure[^>]*message="([^"]*)"[^>]*>([\s\S]*?)<\/failure>/);
    const errorMatch  = body.match(/<error[^>]*message="([^"]*)"[^>]*>([\s\S]*?)<\/error>/);
    const skipMatch   = body.match(/<skipped/);

    if (failMatch)  { status = 'failed';  message = failMatch[1];  output = failMatch[2].trim(); }
    else if (errorMatch) { status = 'error'; message = errorMatch[1]; output = errorMatch[2].trim(); }
    else if (skipMatch)  { status = 'skipped'; }

    results.push({ id, status, message, output });
  }
  return results;
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async function main() {
  const config = loadConfig();
  const { cmd, shell, cwd, reportPath } = resolveCommand(config);
  const timeout = (config.platforms?.[platform]?.run_timeout_seconds) ?? 600;
  const hostOs = process.platform; // 'linux', 'darwin', 'win32'

  console.log(`[reprise] platform=${platform} mode=${mode} runs=${runs}`);
  console.log(`[reprise] command: ${cmd}`);

  for (let i = 0; i < runs; i++) {
    const runDir = join('results', `run-${String(i).padStart(2, '0')}`);
    mkdirSync(runDir, { recursive: true });

    // Delete stale report.
    if (reportPath && existsSync(reportPath)) {
      try { execSync(`rm -f "${reportPath}"`); } catch {}
    }

    const { exit_code, timed_out, duration_ms, output } = runOnce(cmd, shell, cwd, timeout);

    // Parse test results from JUnit XML if available.
    let tests = [];
    if (reportPath) {
      tests = parseJUnit(reportPath);
    }

    // output.txt — last 200 lines, redacted.
    const outputLines = output.split('\n');
    const outputTail = outputLines.slice(-200).join('\n');
    const redacted = outputTail
      .replace(/ghp_[A-Za-z0-9]{36}/g, '[REDACTED]')
      .replace(/github_pat_[A-Za-z0-9_]{82}/g, '[REDACTED]');

    writeFileSync(join(runDir, 'output.txt'), redacted, 'utf8');
    writeFileSync(join(runDir, 'exit_code'), String(exit_code ?? 'null'), 'utf8');
    writeFileSync(
      join(runDir, 'results.json'),
      JSON.stringify({ tests, duration_ms, host_os: hostOs, timed_out }, null, 2),
      'utf8',
    );

    const status = timed_out ? 'TIMEOUT' : exit_code === 0 ? 'PASS' : 'FAIL';
    console.log(`[reprise] run ${i + 1}/${runs}: ${status} (${duration_ms} ms)`);
  }

  console.log('[reprise] done');
})().catch((err) => {
  console.error('[reprise] fatal:', err.message);
  process.exit(1);
});
