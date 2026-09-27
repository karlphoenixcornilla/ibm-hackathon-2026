// src/exec.mjs — execution core for the Reprise Runner
// Spec: 02-specs/test-execution.md §Local executor, 02-specs/local-runner.md §Executing
//
// Runs a platform command, streams redacted output, kills the whole process
// tree on timeout, and assembles a RunResult.

import { spawn } from 'node:child_process';
import { rmSync, existsSync, readFileSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { platform as osPlatform } from 'node:process';
import { buildEnv } from './env.mjs';
import { parseJunit } from './shared/junit-parser.mjs';

const RUNNER_VERSION = '0.1.0';

/** Maximum lines kept in output_tail */
const MAX_TAIL_LINES = 200;

/**
 * @typedef {object} ExecOptions
 * @property {string}   platform       Platform key ('android', 'windows', …)
 * @property {string}   command        Shell command (may contain {file})
 * @property {string}   shell          Shell executable ('bash', 'pwsh', 'cmd', etc.)
 * @property {string}   cwd            Working directory (absolute)
 * @property {string}   testPath       Relative test path ({file} substitution)
 * @property {number}   timeoutMs      Kill-after timeout in ms
 * @property {string}   reportPath     Absolute path to the JUnit XML report file (or '')
 * @property {string}   reportFormat   'junit' or adapter parser name
 * @property {string}   hostOs         Value to put in RunResult.host_os
 * @property {string}   device         Value to put in RunResult.device (may be '')
 * @property {string[]} envRemove      Extra env vars to strip
 * @property {string[]} envKeep        Env vars to keep despite patterns
 * @property {(line: string) => void} onOutput  Callback for each output line
 */

/**
 * @typedef {object} RunResult
 * @property {string}   platform
 * @property {string}   executor
 * @property {string}   method
 * @property {number|null} exit_code
 * @property {boolean}  timed_out
 * @property {number}   duration_ms
 * @property {Array<{id:string;status:string;message:string;output:string}>} tests
 * @property {string}   output_tail
 * @property {string}   host_os
 * @property {string}   device
 * @property {string|null} ci_run_url
 * @property {string|null} runner_version
 */

/**
 * Run a single test command, kill on timeout, and return a RunResult.
 * @param {ExecOptions} opts
 * @returns {Promise<RunResult>}
 */
export async function runCommand(opts) {
  const {
    platform,
    command,
    shell,
    cwd,
    testPath,
    timeoutMs,
    reportPath,
    reportFormat,
    hostOs,
    device,
    envRemove,
    envKeep,
    onOutput,
  } = opts;

  // 1. Delete stale report before the run
  if (reportPath && existsSync(reportPath)) {
    try { rmSync(reportPath); } catch { /**/ }
  }

  // 2. Substitute {file} in the command with the (shell-quoted) test path
  const quotedPath = quoteForShell(testPath, shell);
  const resolvedCommand = command.replace('{file}', quotedPath);

  // 3. Build filtered environment
  const { env } = buildEnv(process.env, envRemove, envKeep);

  // 4. Spawn the process
  const startMs = Date.now();
  const [shellExe, shellArgs] = shellInvocation(shell, resolvedCommand);

  /** @type {string[]} */
  const allLines = [];
  let timedOut = false;
  /** @type {number | null} */
  let exitCode = null;

  await new Promise((resolve) => {
    const child = spawn(shellExe, shellArgs, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      // POSIX: a new process group, so killTree can signal -pid (the whole tree).
      // Not on Windows: a detached child gets its own console and the output of
      // programs it starts never reaches our pipes; taskkill /T kills the tree anyway.
      detached: osPlatform !== 'win32',
      // cmd.exe: pass `/d /s /c "<command>"` verbatim (see shellInvocation) so quotes in
      // the command survive; Node's default argument quoting would escape them as \".
      windowsVerbatimArguments: shell.toLowerCase() === 'cmd',
    });

    /** @param {Buffer} chunk */
    const handleChunk = (chunk) => {
      const lines = chunk.toString().split(/\r?\n/);
      for (const line of lines) {
        if (line === '' && lines[lines.length - 1] === line) continue; // skip trailing empty
        allLines.push(line);
        onOutput(line);
      }
    };

    child.stdout.on('data', handleChunk);
    child.stderr.on('data', handleChunk);

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timer);
      exitCode = code;
      resolve(undefined);
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      allLines.push(`[runner] Failed to start process: ${err.message}`);
      resolve(undefined);
    });
  });

  const durationMs = Date.now() - startMs;

  // 5. Parse results
  const tests = parseResults(reportPath, reportFormat, testPath);

  // 6. Build output_tail (last 200 lines)
  const outputTail = allLines.slice(-MAX_TAIL_LINES).join('\n');

  return {
    platform,
    executor: 'local',
    method: 'repo_command',
    exit_code: exitCode,
    timed_out: timedOut,
    duration_ms: durationMs,
    tests,
    output_tail: outputTail,
    host_os: hostOs,
    device,
    ci_run_url: null,
    runner_version: RUNNER_VERSION,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Quote a path for the target shell.
 * @param {string} p
 * @param {string} shell
 * @returns {string}
 */
function quoteForShell(p, shell) {
  const sh = shell.toLowerCase();
  if (sh === 'cmd') {
    return `"${p.replace(/"/g, '""')}"`;
  }
  if (sh === 'pwsh' || sh === 'powershell') {
    return `'${p.replace(/'/g, "''")}'`;
  }
  // bash / zsh / sh
  return `'${p.replace(/'/g, "'\\''")}'`;
}

/**
 * Return [exe, args] to invoke a shell with a command string.
 * @param {string} shell
 * @param {string} command
 * @returns {[string, string[]]}
 */
function shellInvocation(shell, command) {
  const sh = shell.toLowerCase();
  if (sh === 'cmd') {
    // /s strips exactly the outer quotes and runs the rest as typed; /d skips AutoRun.
    return ['cmd.exe', ['/d', '/s', '/c', `"${command}"`]];
  }
  if (sh === 'pwsh' || sh === 'powershell') {
    return [shell, ['-NoProfile', '-NonInteractive', '-Command', command]];
  }
  // bash / zsh / sh etc.
  return [shell, ['-c', command]];
}

/**
 * Kill the entire process tree.
 * On Windows, kill the whole job via taskkill.
 * On POSIX, negate the PID to kill the process group.
 * @param {import('node:child_process').ChildProcess} child
 */
function killTree(child) {
  if (!child.pid) return;
  try {
    if (osPlatform === 'win32') {
      try {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } catch { /**/ }
    } else {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }
  } catch { /**/ }
}

/**
 * Parse test results from the report file.
 * @param {string} reportPath
 * @param {string} reportFormat
 * @param {string} testPath
 * @returns {Array<{id:string;status:string;message:string;output:string}>}
 */
function parseResults(reportPath, reportFormat, testPath) {
  if (!reportPath || !existsSync(reportPath)) {
    return [];
  }
  if (reportFormat === 'junit') {
    try {
      const xml = readFileSync(reportPath, 'utf8');
      return parseJunit(xml, testPath);
    } catch {
      return [];
    }
  }
  return [];
}
