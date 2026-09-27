// src/args.mjs — CLI argument parsing for the Reprise Runner
// Spec: 02-specs/local-runner.md §Starting it

/**
 * @typedef {{ root: string; port: number; allowOrigins: string[]; bob: Partial<import('./bob.mjs').BobOptions> }} RunnerArgs
 */

const DEFAULT_PORT = 47410;
/** Origin of the deployed IDE; set REPRISE_IDE_ORIGIN to your GitHub Pages origin. */
const DEFAULT_ORIGIN = process.env.REPRISE_IDE_ORIGIN ?? 'https://owner.github.io';

/**
 * Parse process.argv arguments.
 * @param {string[]} argv
 * @returns {RunnerArgs}
 */
export function parseArgs(argv) {
  /** @type {string | null} */
  let root = null;
  let port = Number(process.env.REPRISE_RUNNER_PORT) || DEFAULT_PORT;
  // Local dev: @vscode/test-web runs the extension host on http://<hash>.localhost:3000 (G-23).
  /** @type {string[]} */
  const allowOrigins = [DEFAULT_ORIGIN, 'http://localhost:8080', 'http://localhost:3000', 'http://*.localhost:3000'];
  /** @type {Partial<import('./bob.mjs').BobOptions>} */
  const bob = {};

  const number = (flag, value) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) {
      console.error(`${flag} must be a positive number`);
      process.exit(1);
    }
    return n;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--root' && next) {
      root = argv[++i];
    } else if (arg === '--port' && next) {
      port = number('--port', argv[++i]);
    } else if (arg === '--allow-origin' && next) {
      allowOrigins.push(argv[++i].replace(/\/$/, ''));
    } else if (arg === '--bob-bin' && next) {
      bob.bin = argv[++i];
    } else if (arg === '--bob-mode' && next) {
      bob.mode = argv[++i];
    } else if (arg === '--bob-max-cost' && next) {
      bob.maxCost = number('--bob-max-cost', argv[++i]);
    } else if (arg === '--bob-max-turns' && next) {
      bob.maxTurns = number('--bob-max-turns', argv[++i]);
    } else if (arg === '--bob-timeout' && next) {
      bob.timeoutMs = number('--bob-timeout', argv[++i]) * 1000;
    } else if (arg === '--bob-accept-license') {
      bob.acceptLicense = true;
    } else if (arg === '--no-bob') {
      bob.enabled = false;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  if (!root) {
    console.error('Error: --root is required. Usage: node reprise-runner.mjs --root <path>');
    process.exit(1);
  }

  return { root, port, allowOrigins, bob };
}

function printHelp() {
  console.log(`
Reprise Runner — starts a local test execution server for one repository clone.

Usage:
  node reprise-runner.mjs --root <path> [--port 47410] [--allow-origin <origin>]

Options:
  --root <path>            Path to the repository clone (must contain .reprise.yml). Required.
  --port <number>          Port to listen on (default: 47410; tries next 9 if busy).
  --allow-origin <url>     Additional allowed origin (may repeat; https://*.example.com allows one subdomain
                           label). Default: $REPRISE_IDE_ORIGIN.

IBM Bob bridge (POST /ai/run):
  --bob-bin <path>         Bob Shell executable (default: bob; env REPRISE_BOB_BIN).
  --bob-mode <mode>        Bob agent mode (default: agent; env REPRISE_BOB_MODE).
  --bob-max-cost <n>       Bobcoin cap per stage call (default: 1; env REPRISE_BOB_MAX_COST).
  --bob-max-turns <n>      Turn cap per stage call (default: 30; env REPRISE_BOB_MAX_TURNS).
  --bob-timeout <seconds>  Wall-clock limit per call (default: 600; env REPRISE_BOB_TIMEOUT_SECONDS).
  --bob-accept-license     Pass --accept-license to Bob (env REPRISE_BOB_ACCEPT_LICENSE=1).
  --no-bob                 Disable the Bob bridge.
  Bob authenticates with BOB_API_KEY (Inference scope) from this shell's environment.
  It is the only credential passed to Bob; GitHub tokens are always stripped.

  --help                   Print this message and exit.

Example:
  BOB_API_KEY=... node reprise-runner.mjs --root ~/dev/my-app --allow-origin http://localhost:3000
`);
}
