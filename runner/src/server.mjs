// src/server.mjs — HTTP server for the Reprise Runner
// Spec: 02-specs/local-runner.md §Network rules, §API, §Checks on POST /runs
// Binds 127.0.0.1 only. CORS origin check on every request.
// Authorization: Bearer <session> on every route except /pair.

import http from 'node:http';
import { existsSync, readFileSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, resolve, isAbsolute, normalize } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { execSync, execFileSync } from 'node:child_process';

import { loadConfig, detectRemote, detectHead } from './config.mjs';
import { buildEnv } from './env.mjs';
import { runCommand } from './exec.mjs';
import { getOrCreateWorktree, removeWorktree, activeWorktrees } from './repo.mjs';

// Adapter imports (one per platform; unused on non-matching hosts)
import * as adapterWindows from './adapters/windows.mjs';
import * as adapterAndroid from './adapters/android.mjs';
import * as adapterIos from './adapters/ios.mjs';
import * as adapterMacos from './adapters/macos.mjs';
import * as adapterLinux from './adapters/linux.mjs';

const RUNNER_VERSION = '0.1.0';
const MAX_BODY_BYTES = 1_000_000; // 1 MB
const MAX_FILE_BYTES = 1_000_000; // GET /file cap
/** edit_scope.never when .reprise.yml doesn't set it (matches core's default). */
const DEFAULT_NEVER_SCOPE = ['.github/**', '.reprise.yml', '.reprise/**'];
const PAIR_CODE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
const MAX_WRONG_CODES = 5;

/**
 * @typedef {{ root: string; port: number; allowOrigins: string[] }} RunnerArgs
 *
 * @typedef {object} RunnerConfig
 * @property {number} version
 * @property {{ min_runs: number; max_runs: number }} [verify]
 * @property {Record<string, PlatformConfig>} [platforms]
 *
 * @typedef {object} PlatformConfig
 * @property {string} [shell]
 * @property {string} [cwd]
 * @property {string[]} [prereq]
 * @property {{ pattern: string; single: string; all: string; report: string; report_path: string }} [test]
 * @property {string} [lint]
 * @property {number} [run_timeout_seconds]
 * @property {string} [device]
 * @property {string[]} [env_remove]
 * @property {string[]} [env_keep]
 * @property {{ name: string; appium_port: number; capabilities: Record<string,unknown> }} [driver]
 */

const ADAPTERS = {
  windows: adapterWindows,
  android: adapterAndroid,
  ios: adapterIos,
  macos: adapterMacos,
  linux: adapterLinux,
};

/**
 * Try to find an available port starting from `startPort`.
 * @param {number} startPort
 * @param {string} hostname
 * @returns {Promise<number>}
 */
async function findPort(startPort, hostname) {
  for (let p = startPort; p < startPort + 10; p++) {
    const available = await new Promise((resolve) => {
      const probe = http.createServer();
      probe.once('error', () => resolve(false));
      probe.once('listening', () => { probe.close(() => resolve(true)); });
      probe.listen(p, hostname);
    });
    if (available) return p;
  }
  throw new Error(`No available port in range ${startPort}–${startPort + 9}`);
}

/**
 * @param {RunnerArgs} args
 */
export async function startServer(args) {
  const hostname = '127.0.0.1';
  const port = await findPort(args.port, hostname);

  // Load config and detect repo info
  const config = loadConfig(args.root);
  const remote = detectRemote(args.root);
  const head = detectHead(args.root);

  // Run platform prerequisite checks
  const platformCapabilities = buildPlatformCapabilities(config);

  // ── Pairing state ─────────────────────────────────────────────────────────
  /** @type {{ code: string; expiresAt: number } | null} */
  let pendingPair = generatePairCode();
  let wrongCodeCount = 0;
  let pairingLocked = false;

  /** @type {string | null} */
  let sessionToken = null;

  /** @type {boolean} */
  let busy = false;

  // ── Approval store ────────────────────────────────────────────────────────
  /** @type {Map<string, string>} path → sha256 */
  const approvals = new Map();

  // ── Overlay store ─────────────────────────────────────────────────────────
  /** @type {Map<string, { base: string; files: Array<{path:string;content:string}>; dir: string }>} */
  const overlays = new Map();

  // ── Active SSE streams ────────────────────────────────────────────────────
  /** @type {Map<string, { res: http.ServerResponse; close: () => void }>} */
  const sseStreams = new Map();

  // ── Run results store ─────────────────────────────────────────────────────
  /** @type {Map<string, { results: unknown[]; done: boolean; abort: (() => void) | null }>} */
  const runs = new Map();

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * @param {http.IncomingMessage} req
   * @param {http.ServerResponse} res
   * @param {number} code
   * @param {unknown} body
   */
  function json(req, res, code, body) {
    const data = JSON.stringify(body);
    const origin = req.headers['origin'];
    const allowOrigin = (origin && args.allowOrigins.includes(origin)) ? origin : args.allowOrigins[0] ?? '';
    res.writeHead(code, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
      'Access-Control-Allow-Origin': allowOrigin,
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    res.end(data);
  }

  /**
   * @param {http.IncomingMessage} req
   * @returns {boolean}
   */
  function isAllowedOrigin(req) {
    const origin = req.headers['origin'];
    if (!origin) return false;
    return args.allowOrigins.includes(origin);
  }

  /**
   * @param {http.IncomingMessage} req
   * @returns {boolean}
   */
  function isAuthenticated(req) {
    if (!sessionToken) return false;
    const auth = req.headers['authorization'] ?? '';
    const m = auth.match(/^Bearer\s+(.+)$/i);
    return m ? m[1] === sessionToken : false;
  }

  /**
   * Read and parse the request body (up to MAX_BODY_BYTES).
   * @param {http.IncomingMessage} req
   * @returns {Promise<{ ok: true; data: unknown } | { ok: false; code: number; message: string }>}
   */
  function readBody(req) {
    return new Promise((resolve) => {
      /** @type {Buffer[]} */
      const chunks = [];
      let total = 0;
      req.on('data', (chunk) => {
        total += chunk.length;
        if (total > MAX_BODY_BYTES) {
          resolve({ ok: false, code: 413, message: 'Request body exceeds 1 MB' });
          req.destroy();
        } else {
          chunks.push(chunk);
        }
      });
      req.on('end', () => {
        try {
          const raw = Buffer.concat(chunks).toString('utf8');
          resolve({ ok: true, data: JSON.parse(raw) });
        } catch {
          resolve({ ok: false, code: 400, message: 'Invalid JSON body' });
        }
      });
      req.on('error', () => resolve({ ok: false, code: 400, message: 'Request error' }));
    });
  }

  function buildStatus() {
    return {
      runner_version: RUNNER_VERSION,
      root_name: args.root.split(/[/\\]/).pop() ?? args.root,
      remote,
      head: detectHead(args.root), // live: the user may have committed since startup
      host_os: process.platform,
      platforms: platformCapabilities,
      busy,
    };
  }

  // ── Route handler ─────────────────────────────────────────────────────────
  const server = http.createServer(async (req, res) => {
    const url = req.url ?? '/';
    const method = req.method ?? 'GET';

    // CORS preflight
    if (method === 'OPTIONS') {
      if (!isAllowedOrigin(req)) {
        res.writeHead(403); res.end();
        return;
      }
      const origin = req.headers['origin'] ?? '';
      res.writeHead(204, {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Private-Network': 'true',
        'Access-Control-Max-Age': '86400',
      });
      res.end();
      return;
    }

    // Origin check (all non-preflight)
    if (!isAllowedOrigin(req)) {
      console.warn(`[runner] 403 Forbidden origin: "${req.headers['origin'] ?? '(none)'}" ${method} ${url}`);
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden: origin not in allow-list');
      return;
    }

    // ── POST /pair ──────────────────────────────────────────────────────────
    if (method === 'POST' && url === '/pair') {
      const bodyResult = await readBody(req);
      if (!bodyResult.ok) { json(req, res, bodyResult.code, { error: bodyResult.message }); return; }
      const body = /** @type {{ code?: string }} */ (bodyResult.data);

      if (pairingLocked) {
        console.warn('[runner] Pairing locked — too many wrong codes');
        json(req, res, 403, { error: 'Pairing locked after too many wrong codes. Restart the runner to reset.' });
        return;
      }

      if (!pendingPair || Date.now() > pendingPair.expiresAt) {
        pendingPair = generatePairCode();
        wrongCodeCount = 0;
        console.log(`[runner] Pairing code expired; new code: ${pendingPair.code} (valid 5 min)`);
      }

      if (body.code !== pendingPair.code) {
        wrongCodeCount++;
        console.warn(`[runner] Wrong pairing code (attempt ${wrongCodeCount}/${MAX_WRONG_CODES})`);
        if (wrongCodeCount >= MAX_WRONG_CODES) {
          pairingLocked = true;
          console.warn('[runner] Pairing locked.');
        }
        json(req, res, 403, { error: 'Wrong pairing code' });
        return;
      }

      // Success — issue a new session token
      sessionToken = randomBytes(32).toString('hex');
      pendingPair = null;
      wrongCodeCount = 0;
      console.log(`[runner] Paired. New session issued.`);

      json(req, res, 200, {
        session: sessionToken,
        runner_version: RUNNER_VERSION,
        root_name: args.root.split(/[/\\]/).pop() ?? args.root,
        remote,
        head: detectHead(args.root),
        host_os: process.platform,
        platforms: platformCapabilities,
      });
      return;
    }

    // ── GET /status ─────────────────────────────────────────────────────────
    if (method === 'GET' && url === '/status') {
      json(req, res, 200, buildStatus());
      return;
    }

    // ── All routes below require authentication ──────────────────────────────
    if (!isAuthenticated(req)) {
      console.warn(`[runner] 401 Unauthorized: ${method} ${url}`);
      json(req, res, 401, { error: 'Unauthorized: provide Authorization: Bearer <session>' });
      return;
    }

    // ── GET /file?path=<rel>&ref=<sha> ───────────────────────────────────────
    // Read-only view of a git-tracked file at a commit (default HEAD), so the app can show
    // code and apply a fix against exactly what a worktree at that commit contains.
    // Untracked files (.env and the like) are never served.
    if (method === 'GET' && (url === '/file' || url.startsWith('/file?'))) {
      const params = new URL(url, 'http://runner').searchParams;
      const relPath = params.get('path') ?? '';
      const refParam = params.get('ref') || 'HEAD';
      if (!isSafeRelativePath(relPath) || relPath === '.git' || relPath.startsWith('.git/')) {
        json(req, res, 400, { error: 'path must be a relative path inside the repository' });
        return;
      }
      if (!/^(HEAD|[0-9a-fA-F]{7,40})$/.test(refParam)) {
        json(req, res, 400, { error: 'ref must be HEAD or a commit sha' });
        return;
      }
      const git = (/** @type {string[]} */ gitArgs, maxBuffer = 1024 * 1024) =>
        execFileSync('git', gitArgs, { cwd: args.root, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer });

      let sha;
      try {
        sha = git(['rev-parse', '--verify', '--quiet', `${refParam}^{commit}`]).toString('utf8').trim();
      } catch {
        json(req, res, 404, { error: `Unknown ref ${refParam}` });
        return;
      }
      // "<mode> blob <object> <size>\t<path>" for a tracked file; nothing (or a tree) otherwise.
      const entry = git(['ls-tree', '-l', sha, '--', relPath]).toString('utf8');
      const m = entry.match(/^\d+ blob [0-9a-f]+\s+(\d+)\t/);
      if (!m) {
        json(req, res, 404, { error: `${relPath} is not a tracked file at ${sha.slice(0, 12)}` });
        return;
      }
      if (Number(m[1]) > MAX_FILE_BYTES) {
        json(req, res, 413, { error: `${relPath} is larger than ${MAX_FILE_BYTES} bytes` });
        return;
      }
      const bytes = git(['show', `${sha}:${relPath}`], MAX_FILE_BYTES + 1024);
      json(req, res, 200, {
        path: relPath,
        ref: sha,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        content: bytes.toString('utf8'),
      });
      return;
    }

    // ── POST /approve ────────────────────────────────────────────────────────
    if (method === 'POST' && url === '/approve') {
      const bodyResult = await readBody(req);
      if (!bodyResult.ok) { json(req, res, bodyResult.code, { error: bodyResult.message }); return; }
      const body = /** @type {{ path?: string; sha256?: string }} */ (bodyResult.data);

      if (typeof body.path !== 'string' || typeof body.sha256 !== 'string') {
        json(req, res, 400, { error: 'path and sha256 are required' });
        return;
      }
      approvals.set(body.path, body.sha256);
      console.log(`[runner] Approved: ${body.path} (${body.sha256.slice(0, 8)}…)`);
      json(req, res, 200, { ok: true });
      return;
    }

    // ── POST /overlays ───────────────────────────────────────────────────────
    if (method === 'POST' && url === '/overlays') {
      const bodyResult = await readBody(req);
      if (!bodyResult.ok) { json(req, res, bodyResult.code, { error: bodyResult.message }); return; }
      const body = /** @type {{ base?: string; files?: Array<{path:string;content:string}> }} */ (bodyResult.data);

      if (typeof body.base !== 'string' || !Array.isArray(body.files)) {
        json(req, res, 400, { error: 'base (sha) and files[] are required' });
        return;
      }

      // An overlay may carry the reproduction test and the fix, so the scope is
      // edit_scope.test ∪ edit_scope.fix, never anything in edit_scope.never.
      const config2 = loadConfig(args.root);
      const editScope = config2?.edit_scope ?? {};
      const allowedScope = [...(editScope.test ?? []), ...(editScope.fix ?? [])];
      const neverScope = editScope.never ?? DEFAULT_NEVER_SCOPE;

      for (const f of body.files) {
        if (typeof f.path !== 'string' || typeof f.content !== 'string') {
          json(req, res, 400, { error: 'Each file must have path and content' });
          return;
        }
        if (!isSafeRelativePath(f.path)) {
          json(req, res, 400, { error: `Path "${f.path}" must be a relative path inside the repository` });
          return;
        }
        if (neverScope.length > 0 && neverScope.some((p) => globToRegExp(p).test(f.path))) {
          json(req, res, 403, { error: `Path "${f.path}" is in edit_scope.never` });
          return;
        }
        if (!isInsideEditScope(f.path, allowedScope)) {
          json(req, res, 403, { error: `Path "${f.path}" is outside edit_scope.test and edit_scope.fix` });
          return;
        }
        const approvedHash = approvals.get(f.path);
        if (!approvedHash) {
          json(req, res, 409, { error: `File "${f.path}" has not been approved via /approve` });
          return;
        }
        if (approvedHash !== createHash('sha256').update(f.content, 'utf8').digest('hex')) {
          json(req, res, 409, { error: `Content of "${f.path}" does not match its approved SHA-256` });
          return;
        }
      }

      const overlayId = randomBytes(12).toString('hex');
      const overlayDir = join(homedir(), '.reprise-runner', 'overlays', overlayId);
      mkdirSync(overlayDir, { recursive: true });

      overlays.set(overlayId, { base: body.base, files: body.files, dir: overlayDir });
      console.log(`[runner] Overlay ${overlayId} registered (base ${body.base.slice(0, 8)})`);
      json(req, res, 200, { overlay_id: overlayId });
      return;
    }

    // ── POST /runs ───────────────────────────────────────────────────────────
    if (method === 'POST' && url === '/runs') {
      const bodyResult = await readBody(req);
      if (!bodyResult.ok) { json(req, res, bodyResult.code, { error: bodyResult.message }); return; }
      const body = /** @type {{
        platform?: string; mode?: string; test_path?: string;
        runs?: number; ref?: null | { base: string } | { head: string } | { overlay: string }
      }} */ (bodyResult.data);

      const { platform, mode, test_path: testPath, runs: runsCount, ref } = body;

      // Validation
      if (!platform || !mode || typeof testPath !== 'string' || typeof runsCount !== 'number') {
        json(req, res, 400, { error: 'platform, mode, test_path and runs are required' });
        return;
      }

      const cfg = loadConfig(args.root);

      // Check 1: platform configured and local_possible
      const pc = cfg?.platforms?.[platform];
      if (!pc) {
        json(req, res, 409, { error: `Platform "${platform}" is not configured in .reprise.yml` });
        return;
      }
      const cap = platformCapabilities.find(c => c.platform === platform);
      if (!cap?.local_possible) {
        json(req, res, 409, { error: `Platform "${platform}" is not locally runnable: ${cap?.missing?.join(', ')}` });
        return;
      }

      // Check 2 (single mode): path checks and approval
      if (mode === 'single') {
        if (testPath.includes('..')) {
          json(req, res, 400, { error: 'test_path must not contain ".."' });
          return;
        }
        if (!testPath || testPath.startsWith('/')) {
          json(req, res, 400, { error: 'test_path must be a relative path' });
          return;
        }
        if (pc.test?.pattern) {
          const patternRe = globToRegExp(pc.test.pattern);
          if (!patternRe.test(testPath)) {
            json(req, res, 409, { error: `test_path does not match platforms.${platform}.test.pattern` });
            return;
          }
        }
        // Check approval (for paths not tracked in git at HEAD unchanged)
        const approved = approvals.get(testPath);
        if (!approved) {
          // Accept if it's a git-tracked file; else require approval
          const isTracked = isTrackedInGit(args.root, testPath);
          if (!isTracked) {
            json(req, res, 409, { error: 'Test not approved: call /approve with the file path and SHA-256 first' });
            return;
          }
        }
      }

      // Check 3: runs count
      const maxRuns = cfg?.verify?.max_runs ?? 200;
      if (runsCount < 1 || runsCount > maxRuns) {
        json(req, res, 400, { error: `runs must be between 1 and ${maxRuns} (verify.max_runs)` });
        return;
      }

      // Check 5: one run at a time
      if (busy) {
        json(req, res, 409, { error: 'Runner is busy; only one run at a time is supported' });
        return;
      }

      // Resolve working directory
      const runId = randomBytes(8).toString('hex');
      busy = true;
      runs.set(runId, { results: [], done: false, abort: null });

      json(req, res, 200, { run_id: runId });

      // Execute asynchronously
      executeRun(runId, { platform, mode, testPath, runsCount, ref, pc, cfg }).finally(() => {
        busy = false;
      });

      console.log(`[runner] run ${runId}: ${platform} ${mode} ${testPath} ×${runsCount}`);
      return;
    }

    // ── GET /runs/<id>/events (SSE) ──────────────────────────────────────────
    const sseMatch = url.match(/^\/runs\/([a-f0-9]+)\/events$/);
    if (method === 'GET' && sseMatch) {
      const runId = sseMatch[1];

      if (!isAuthenticated(req)) {
        res.writeHead(401); res.end();
        return;
      }

      const origin = req.headers['origin'] ?? '';
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': origin,
      });
      res.flushHeaders?.();

      /**
       * @param {unknown} event
       */
      const sendEvent = (event) => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      };

      const stream = { res, close: () => res.end() };
      sseStreams.set(runId, stream);

      // If run already finished, flush accumulated events
      const runData = runs.get(runId);
      if (runData) {
        for (const r of runData.results) {
          sendEvent(r);
        }
        if (runData.done) {
          sendEvent({ type: 'done' });
          res.end();
          sseStreams.delete(runId);
        }
      }

      req.on('close', () => sseStreams.delete(runId));
      return;
    }

    // ── DELETE /runs/<id> ────────────────────────────────────────────────────
    const deleteMatch = url.match(/^\/runs\/([a-f0-9]+)$/);
    if (method === 'DELETE' && deleteMatch) {
      const runId = deleteMatch[1];
      const run = runs.get(runId);
      if (run?.abort) run.abort();
      runs.delete(runId);
      const stream = sseStreams.get(runId);
      if (stream) { stream.close(); sseStreams.delete(runId); }
      json(req, res, 200, { ok: true });
      return;
    }

    // ── GET /runs ────────────────────────────────────────────────────────────
    if (method === 'GET' && url === '/runs') {
      json(req, res, 200, { run_ids: [...runs.keys()] });
      return;
    }

    // 404 fallback
    json(req, res, 404, { error: 'Not found' });
  });

  server.on('error', (err) => {
    console.error('[runner] Server error:', err.message);
  });

  await new Promise((resolve) => server.listen(port, hostname, () => resolve(undefined)));

  // Startup banner
  console.log(`\nReprise Runner ${RUNNER_VERSION}`);
  console.log(`Root:    ${args.root}`);
  console.log(`Remote:  ${remote || '(not detected)'}`);
  console.log(`HEAD:    ${head || '(not detected)'}`);
  console.log(`Port:    ${port}`);
  console.log(`Host OS: ${process.platform}`);
  if (platformCapabilities.length > 0) {
    console.log('\nPlatform capabilities:');
    for (const pc of platformCapabilities) {
      const status = pc.local_possible ? '✓ local' : `✗ ${pc.missing.join(', ')}`;
      console.log(`  ${pc.platform}: ${status}`);
    }
  } else {
    console.log('\nNo platforms configured in .reprise.yml');
  }
  console.log(`\nListening on http://${hostname}:${port}`);
  console.log(`Allowed origins: ${args.allowOrigins.join(', ')}`);
  if (pendingPair) {
    console.log(`\nPairing code: ${pendingPair.code}  (valid 5 min, single use)`);
  }

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n[runner] Stopping...');
    for (const p of activeWorktrees) {
      await removeWorktree(args.root, p).catch(() => {});
    }
    server.close(() => {
      console.log('[runner] Stopped.');
      process.exit(0);
    });
  });

  // ── Async execution ────────────────────────────────────────────────────────

  /**
   * @param {string} runId
   * @param {{
   *   platform: string; mode: string; testPath: string; runsCount: number;
   *   ref: null | { base: string } | { head: string } | { overlay: string };
   *   pc: PlatformConfig;
   *   cfg: RunnerConfig;
   * }} opts
   */
  async function executeRun(runId, opts) {
    const { platform, mode, testPath, runsCount, ref, pc } = opts;
    const runData = runs.get(runId);
    if (!runData) return;

    let workDir = args.root;
    let worktreePath = null;

    try {
      // Resolve working directory based on ref
      if (ref && 'base' in ref) {
        worktreePath = await getOrCreateWorktree(args.root, remote, ref.base);
        activeWorktrees.add(worktreePath);
        workDir = worktreePath;
      } else if (ref && 'head' in ref) {
        worktreePath = await getOrCreateWorktree(args.root, remote, ref.head);
        activeWorktrees.add(worktreePath);
        workDir = worktreePath;
      } else if (ref && 'overlay' in ref) {
        const overlay = overlays.get(ref.overlay);
        if (!overlay) {
          emitSseEvent(runId, { type: 'error', message: `Overlay "${ref.overlay}" not found` });
          return;
        }
        worktreePath = await getOrCreateWorktree(args.root, remote, overlay.base);
        activeWorktrees.add(worktreePath);
        workDir = worktreePath;
        // Write overlay files into worktree
        for (const f of overlay.files) {
          const dest = join(worktreePath, f.path);
          mkdirSync(join(dest, '..'), { recursive: true });
          writeFileSync(dest, f.content, 'utf8');
        }
      }

      const shell = pc.shell ?? (process.platform === 'win32' ? 'cmd' : 'bash');
      const adapter = ADAPTERS[/** @type {keyof typeof ADAPTERS} */ (platform)];
      const command = adapter ? adapter.getCommand(loadConfig(args.root), /** @type {any} */ (mode)) : '';
      if (!command) {
        emitSseEvent(runId, { type: 'error', message: `No ${mode} command configured for platform ${platform}` });
        return;
      }

      const cwd = pc.cwd ? join(workDir, pc.cwd) : workDir;
      const timeoutMs = (pc.run_timeout_seconds ?? 300) * 1000;
      const reportPath = pc.test?.report_path
        ? (isAbsolute(pc.test.report_path) ? pc.test.report_path : join(workDir, pc.test.report_path))
        : '';
      const reportFormat = pc.test?.report ?? 'junit';

      let aborted = false;
      runData.abort = () => { aborted = true; };

      for (let i = 0; i < runsCount; i++) {
        if (aborted) break;
        const result = await runCommand({
          platform,
          command,
          shell,
          cwd,
          testPath,
          timeoutMs,
          reportPath,
          reportFormat,
          hostOs: process.platform,
          device: pc.device ?? '',
          envRemove: pc.env_remove ?? [],
          envKeep: pc.env_keep ?? [],
          onOutput: (line) => emitSseEvent(runId, { type: 'output', line }),
        });

        runData.results.push({ type: 'result', result });
        emitSseEvent(runId, { type: 'result', result });
      }
    } catch (err) {
      emitSseEvent(runId, { type: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      runData.done = true;
      emitSseEvent(runId, { type: 'done' });
      const stream = sseStreams.get(runId);
      if (stream) { stream.close(); sseStreams.delete(runId); }

      if (worktreePath) {
        await removeWorktree(args.root, worktreePath).catch(() => {});
        activeWorktrees.delete(worktreePath);
      }
    }
  }

  /**
   * @param {string} runId
   * @param {unknown} event
   */
  function emitSseEvent(runId, event) {
    const stream = sseStreams.get(runId);
    if (stream) {
      stream.res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  }

  return () => new Promise((resolve) => server.close(() => resolve(undefined)));
}

// ── Utilities ─────────────────────────────────────────────────────────────────

/**
 * @returns {{ code: string; expiresAt: number }}
 */
function generatePairCode() {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  return { code, expiresAt: Date.now() + 5 * 60 * 1000 };
}

/**
 * @param {RunnerConfig} config
 * @returns {Array<{ platform: string; local_possible: boolean; missing: string[] }>}
 */
function buildPlatformCapabilities(config) {
  /** @type {Array<{ platform: string; local_possible: boolean; missing: string[] }>} */
  const caps = [];
  for (const [platform, adapter] of Object.entries(ADAPTERS)) {
    if (!config?.platforms?.[platform]) continue;
    const { local_possible, missing } = adapter.checkPrereqs(config);
    caps.push({ platform, local_possible, missing });
  }
  return caps;
}

/**
 * Check whether a path is tracked in git at HEAD.
 * @param {string} root
 * @param {string} relPath
 * @returns {boolean}
 */
function isTrackedInGit(root, relPath) {
  try {
    // execFileSync, not a shell string: the path comes from the request.
    execFileSync('git', ['ls-files', '--error-unmatch', '--', relPath], {
      cwd: root,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Convert a glob pattern to a RegExp.
 * Supports * and ** only.
 * @param {string} glob
 * @returns {RegExp}
 */
function globToRegExp(glob) {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '§DSTAR§')
    .replace(/\*/g, '[^/]*')
    .replace(/§DSTAR§/g, '.*');
  return new RegExp(`^${escaped}$`);
}

/**
 * Check if a path is inside the edit scope.
 * @param {string} filePath
 * @param {string[]} scope
 * @returns {boolean}
 */
function isInsideEditScope(filePath, scope) {
  if (scope.length === 0) return true;
  return scope.some(pattern => globToRegExp(pattern).test(filePath));
}

/**
 * A repository-relative path that cannot escape the root: forward slashes only,
 * not absolute, no drive letter, no "." or ".." segments.
 * @param {string} p
 * @returns {boolean}
 */
function isSafeRelativePath(p) {
  if (!p || p.includes('\\') || p.startsWith('/') || /^[A-Za-z]:/.test(p)) return false;
  return p.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}
