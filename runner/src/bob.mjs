// src/bob.mjs — IBM Bob bridge (CR-1): runs `bob run` headless for one AI stage.
// Spec: 02-specs/ai-providers.md (bob row), 00-context/verified-facts.md V-6
//
// The tab sends only { provider, stage, prompt }. Everything that controls what
// Bob may do (binary, mode, tool groups, cost and turn caps) comes from the
// runner's own command line or environment (PD-18). Bob gets the read tool group
// only: it may read the repository but never edits files or runs commands.
// File changes come back as proposals inside the JSON answer (PD-10).

import { spawn, execFileSync } from 'node:child_process';
import { buildEnv } from './env.mjs';

/** Tool groups Bob must not use (V-6). `read` is the only group left enabled. */
export const DISABLED_TOOL_GROUPS = ['edit', 'execute', 'mcp', 'skill', 'todo', 'subagent', 'mode'];

/** Stages the bridge accepts (contracts/enums.ts Stage). */
export const STAGES = new Set(['intake', 'dedupe', 'test', 'rootcause', 'fix', 'review']);

/** Longest prompt accepted (characters); the HTTP body limit is 1 MB. */
export const MAX_PROMPT_CHARS = 400_000;

/**
 * @typedef {object} BobOptions
 * @property {string} bin          Bob Shell executable (default "bob")
 * @property {string} mode         Bob agent mode (default "agent")
 * @property {number} maxCost      Bobcoin cap per call (--max-cost)
 * @property {number} maxTurns     Turn cap per call (--max-turns)
 * @property {number} timeoutMs    Wall-clock limit per call
 * @property {boolean} acceptLicense  Pass --accept-license
 * @property {boolean} enabled     False when --no-bob was given
 */

/**
 * Merge CLI args and environment into Bob options. CLI wins over env.
 * @param {Partial<BobOptions>} cli
 * @param {Record<string, string | undefined>} env
 * @returns {BobOptions}
 */
export function resolveBobOptions(cli = {}, env = process.env) {
  const num = (v, d) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : d;
  };
  return {
    bin: cli.bin ?? env.REPRISE_BOB_BIN ?? 'bob',
    mode: cli.mode ?? env.REPRISE_BOB_MODE ?? 'agent',
    maxCost: num(cli.maxCost ?? env.REPRISE_BOB_MAX_COST, 1),
    maxTurns: num(cli.maxTurns ?? env.REPRISE_BOB_MAX_TURNS, 30),
    timeoutMs: num(cli.timeoutMs ?? (env.REPRISE_BOB_TIMEOUT_SECONDS ? Number(env.REPRISE_BOB_TIMEOUT_SECONDS) * 1000 : undefined), 600_000),
    acceptLicense: cli.acceptLicense ?? env.REPRISE_BOB_ACCEPT_LICENSE === '1',
    enabled: cli.enabled ?? env.REPRISE_BOB_DISABLED !== '1',
  };
}

/**
 * Fixed argument list for `bob run`. Nothing here comes from the request.
 * @param {BobOptions} opts
 * @param {string} root
 * @returns {string[]}
 */
export function buildBobArgs(opts, root) {
  const args = [
    'run',
    '--format', 'json',
    '--mode', opts.mode,
    '--max-cost', String(opts.maxCost),
    '--max-turns', String(opts.maxTurns),
    '--disable-tool-groups', DISABLED_TOOL_GROUPS.join(','),
    '--disable-mcp',
    '--disable-subagents',
    '--workspace', root,
    '--trust',
  ];
  if (opts.acceptLicense) args.push('--accept-license');
  return args;
}

/**
 * Environment for Bob: the PD-15 filter (so GitHub tokens never reach Bob),
 * keeping only Bob's own API key.
 * @param {Record<string, string | undefined>} baseEnv
 */
export function bobEnv(baseEnv = process.env) {
  return buildEnv(baseEnv, [], ['BOB_API_KEY']).env;
}

/** Windows installs `bob` as a .cmd shim, which Node can only start through a shell. */
function needsShell(bin) {
  return process.platform === 'win32' && !/\.exe$/i.test(bin);
}

function quoteForShell(s) {
  return /[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s;
}

/**
 * Probe `bob --version` once at startup.
 * @param {BobOptions} opts
 * @param {Record<string, string | undefined>} env
 * @returns {import('../../extensions/reprise/src/contracts/runner-api').AiCapability}
 */
export function detectBob(opts, env = process.env) {
  if (!opts.enabled) {
    return { provider: 'bob', available: false, version: null, reason: 'Bob bridge disabled (--no-bob).' };
  }
  try {
    const shell = needsShell(opts.bin);
    const out = execFileSync(shell ? quoteForShell(opts.bin) : opts.bin, ['--version'], {
      env: bobEnv(env),
      encoding: 'utf8',
      timeout: 15_000,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell,
      windowsHide: true,
    });
    const version = out.trim().split(/\r?\n/).pop() ?? null;
    const reason = env.BOB_API_KEY ? null : 'BOB_API_KEY is not set; Bob will use its interactive login if one exists.';
    return { provider: 'bob', available: true, version, reason };
  } catch (err) {
    const code = /** @type {{ code?: string }} */ (err).code;
    const reason = code === 'ENOENT' || /not recognized|not found/i.test(String(err))
      ? `"${opts.bin}" not found. Install Bob Shell (Node.js 24+) or pass --bob-bin <path>.`
      : `"${opts.bin} --version" failed: ${String(/** @type {Error} */ (err).message).split('\n')[0]}`;
    return { provider: 'bob', available: false, version: null, reason };
  }
}

/**
 * Parse `bob run --format json` output into an AiRunResponse.
 * Bob may print log lines before the result object; take the last result object.
 * @param {string} stdout
 */
export function parseBobOutput(stdout) {
  /** @type {Record<string, unknown> | null} */
  let result = null;
  const tryParse = (text) => {
    try {
      const v = JSON.parse(text);
      return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
    } catch {
      return null;
    }
  };

  result = tryParse(stdout.trim());
  if (!result || result.type !== 'result') {
    const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith('{'));
    for (let i = lines.length - 1; i >= 0; i--) {
      const v = tryParse(lines[i]);
      if (v && v.type === 'result') { result = v; break; }
    }
  }
  if (!result || typeof result.last_message !== 'string') {
    throw new Error('Bob returned no result object (is --format json supported by this Bob Shell version?)');
  }

  const stats = /** @type {Record<string, unknown>} */ (result.stats ?? {});
  const n = (k) => (typeof stats[k] === 'number' ? /** @type {number} */ (stats[k]) : 0);
  return {
    status: result.status === 'success' ? 'success' : 'error',
    last_message: result.last_message,
    task_id: typeof stats.task_id === 'string' ? stats.task_id : null,
    stats: {
      input_tokens: n('input_tokens'),
      output_tokens: n('output_tokens'),
      total_tokens: n('total_tokens'),
      duration_ms: n('duration_ms'),
      session_costs: n('session_costs'),
      tool_calls: n('tool_calls'),
    },
  };
}

/** Bob prints some messages with HTML entities (e.g. &#x60; for a backtick). */
function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/**
 * Kill a process and its children.
 * @param {import('node:child_process').ChildProcess} child
 */
function killTree(child) {
  if (child.pid === undefined || child.exitCode !== null) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    } else {
      process.kill(-child.pid, 'SIGKILL');
    }
  } catch {
    child.kill('SIGKILL');
  }
}

/**
 * Run one Bob stage. The prompt goes on stdin, never on the command line.
 * @param {{ opts: BobOptions; root: string; prompt: string; env?: Record<string,string|undefined>; signal?: AbortSignal }} p
 * @returns {Promise<ReturnType<typeof parseBobOutput>>}
 */
export function runBob({ opts, root, prompt, env = process.env, signal }) {
  return new Promise((resolve, reject) => {
    const shell = needsShell(opts.bin);
    const args = buildBobArgs(opts, root);
    const child = spawn(
      shell ? quoteForShell(opts.bin) : opts.bin,
      shell ? args.map(quoteForShell) : args,
      {
        cwd: root,
        env: bobEnv(env),
        shell,
        windowsHide: true,
        detached: process.platform !== 'win32',
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );

    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (fn) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      fn();
    };

    const timer = setTimeout(() => {
      killTree(child);
      finish(() => reject(new Error(`Bob timed out after ${Math.round(opts.timeoutMs / 1000)} s`)));
    }, opts.timeoutMs);

    const onAbort = () => {
      killTree(child);
      finish(() => reject(new Error('Bob run cancelled')));
    };
    if (signal) {
      if (signal.aborted) { onAbort(); return; }
      signal.addEventListener('abort', onAbort);
    }

    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => finish(() => reject(err)));
    child.on('close', (code) => {
      finish(() => {
        try {
          resolve(parseBobOutput(stdout));
        } catch (err) {
          const text = decodeEntities(stderr).trim();
          if (/license agreement is required|accept the license/i.test(text)) {
            reject(new Error(
              "Bob Shell's license has not been accepted on this machine. Run `bob` once in a terminal and accept it " +
                '(or read it with `bob --show-license`), or restart the runner with --bob-accept-license.'
            ));
            return;
          }
          const tail = text.split(/\r?\n/).slice(-5).join(' | ');
          reject(new Error(`${/** @type {Error} */ (err).message} (exit ${code}${tail ? `; stderr: ${tail}` : ''})`));
        }
      });
    });

    child.stdin.on('error', () => { /* child exited early; handled by close */ });
    child.stdin.end(prompt);
  });
}
