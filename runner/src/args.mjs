// src/args.mjs — CLI argument parsing for the Reprise Runner
// Spec: 02-specs/local-runner.md §Starting it

/**
 * @typedef {{ root: string; port: number; allowOrigins: string[] }} RunnerArgs
 */

const DEFAULT_PORT = 47410;
const DEFAULT_ORIGIN = 'https://owner.github.io'; // placeholder; real value set by team

/**
 * Parse process.argv arguments.
 * @param {string[]} argv
 * @returns {RunnerArgs}
 */
export function parseArgs(argv) {
  /** @type {string | null} */
  let root = null;
  let port = DEFAULT_PORT;
  /** @type {string[]} */
  const allowOrigins = [DEFAULT_ORIGIN, 'http://localhost:8080'];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--root' && argv[i + 1]) {
      root = argv[++i];
    } else if (arg === '--port' && argv[i + 1]) {
      port = parseInt(argv[++i], 10);
      if (isNaN(port)) {
        console.error('--port must be an integer');
        process.exit(1);
      }
    } else if (arg === '--allow-origin' && argv[i + 1]) {
      allowOrigins.push(argv[++i]);
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  if (!root) {
    console.error('Error: --root is required. Usage: node reprise-runner.mjs --root <path>');
    process.exit(1);
  }

  return { root, port, allowOrigins };
}

function printHelp() {
  console.log(`
Reprise Runner — starts a local test execution server for one repository clone.

Usage:
  node reprise-runner.mjs --root <path> [--port 47410] [--allow-origin <origin>]

Options:
  --root <path>          Path to the repository clone (must contain .reprise.yml). Required.
  --port <number>        Port to listen on (default: 47410; tries next 9 if busy).
  --allow-origin <url>   Additional allowed origin (may repeat). Default: GitHub Pages origin.
  --help                 Print this message and exit.

Example:
  node reprise-runner.mjs --root ~/dev/my-app --allow-origin http://localhost:8080
`);
}
