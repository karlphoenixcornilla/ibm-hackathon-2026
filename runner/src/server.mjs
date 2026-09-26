// src/server.mjs — HTTP server for the Reprise Runner
// Spec: 02-specs/local-runner.md §Network rules, §API
// Binds 127.0.0.1 only. CORS origin check on every request.
// At base-v1: only GET /status is implemented (static body).

import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const RUNNER_VERSION = '0.1.0-skeleton';
const MAX_BODY_BYTES = 1_000_000; // 1 MB

/**
 * @typedef {import('./args.mjs').RunnerArgs} RunnerArgs
 */

/**
 * Try to find an available port starting from `startPort`.
 * Tries up to 10 consecutive ports per spec.
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
 * Validate that the root contains .reprise.yml.
 * @param {string} root
 */
function validateRoot(root) {
  const config = join(root, '.reprise.yml');
  if (!existsSync(config)) {
    console.error(`Error: ${root} does not contain .reprise.yml`);
    console.error('The runner requires --root to point at a valid repository clone.');
    process.exit(1);
  }
}

/**
 * @param {RunnerArgs} args
 */
export async function startServer(args) {
  validateRoot(args.root);

  const hostname = '127.0.0.1';
  const port = await findPort(args.port, hostname);

  /**
   * Build the static /status body.
   * T2 will replace this with a live implementation.
   * @returns {import('../extensions/reprise/src/contracts/runner-api.mjs').StatusResponse}
   */
  function buildStatus() {
    return {
      runner_version: RUNNER_VERSION,
      root_name: args.root.split('/').pop() ?? args.root,
      remote: '', // T2 fills from git remote
      head: '',   // T2 fills from git HEAD
      host_os: process.platform,
      platforms: [], // T2 fills from adapter prerequisite checks
      busy: false,
    };
  }

  /**
   * @param {http.IncomingMessage} req
   * @param {http.ServerResponse} res
   * @param {number} code
   * @param {unknown} body
   */
  function json(req, res, code, body) {
    const data = JSON.stringify(body);
    res.writeHead(code, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
      'Access-Control-Allow-Origin': req.headers['origin'] ?? '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Private-Network': 'true',
    });
    res.end(data);
  }

  /**
   * Check Origin header against the allow-list.
   * @param {http.IncomingMessage} req
   * @returns {boolean}
   */
  function isAllowedOrigin(req) {
    const origin = req.headers['origin'];
    if (!origin) return false;
    return args.allowOrigins.some((o) => o === origin);
  }

  const server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    const method = req.method ?? 'GET';

    // ── CORS preflight ──────────────────────────────────────────────────────
    if (method === 'OPTIONS') {
      if (!isAllowedOrigin(req)) {
        res.writeHead(403);
        res.end();
        return;
      }
      json(req, res, 204, {});
      return;
    }

    // ── Origin check ────────────────────────────────────────────────────────
    if (!isAllowedOrigin(req)) {
      console.warn(`[runner] Rejected request from disallowed origin: ${req.headers['origin'] ?? '(none)'} ${method} ${url}`);
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden: origin not in allow-list');
      return;
    }

    // ── Routes ───────────────────────────────────────────────────────────────
    if (method === 'GET' && url === '/status') {
      const status = buildStatus();
      console.log(`[runner] GET /status`);
      json(req, res, 200, status);
      return;
    }

    // All other routes: not yet implemented (T2 scope)
    console.log(`[runner] 501 Not Implemented: ${method} ${url}`);
    json(req, res, 501, {
      error: 'Not implemented yet',
      note: 'This endpoint will be implemented in track T2.',
    });
  });

  server.on('error', (err) => {
    console.error('[runner] Server error:', err.message);
  });

  await new Promise((resolve) => server.listen(port, hostname, () => resolve(undefined)));

  // ── Startup banner ────────────────────────────────────────────────────────
  console.log(`\nReprise Runner ${RUNNER_VERSION}`);
  console.log(`Root:    ${args.root}`);
  console.log(`Port:    ${port}`);
  console.log(`Host OS: ${process.platform}`);
  console.log(`\nListening on http://${hostname}:${port}`);
  console.log('Allowed origins:', args.allowOrigins.join(', '));
  console.log('\nNote: This is the base skeleton. Only GET /status is implemented.');
  console.log('T2 will implement the full execution API.\n');

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  process.on('SIGINT', () => {
    console.log('\n[runner] Stopping...');
    server.close(() => {
      console.log('[runner] Stopped.');
      process.exit(0);
    });
  });

  // Return a close function so callers (e.g. tests) can shut the server down.
  return () => new Promise((resolve) => server.close(() => resolve(undefined)));
}
