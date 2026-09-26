#!/usr/bin/env node
// reprise-runner.mjs — Reprise Runner entry point
// Spec: 02-specs/local-runner.md
// Usage: node reprise-runner.mjs --root <path> [--port 47410] [--allow-origin <origin>]

import { startServer } from './src/server.mjs';
import { parseArgs } from './src/args.mjs';

const args = parseArgs(process.argv.slice(2));
startServer(args).catch((err) => {
  console.error('[reprise-runner] Fatal error:', err.message);
  process.exit(1);
});
