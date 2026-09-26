// src/env.mjs — PD-15 credential-stripping environment filter
// Spec: 02-specs/security.md §Environment filter for runner-started tests
//
// Removes variables matching known secret patterns and any listed in
// platforms.<p>.env_remove. Variables in platforms.<p>.env_keep are
// preserved even if they match. Prints the summary once per runner session.

/**
 * Patterns whose matching env var names are removed (case-insensitive suffix/substring check).
 * @type {string[]}
 */
const DENY_PATTERNS = [
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'GITHUB_PAT',
  'TOKEN',
  'SECRET',
  'PASSWORD',
  'API_KEY',
  'PRIVATE_KEY',
];

/** Track whether we have already printed the summary. */
let summarised = false;

/**
 * Build a sanitised copy of `process.env` for running a test process.
 *
 * @param {Record<string, string | undefined>} baseEnv   Usually `process.env`
 * @param {string[]} envRemove  Extra names from platforms.<p>.env_remove
 * @param {string[]} envKeep   Names from platforms.<p>.env_keep to preserve
 * @returns {{ env: Record<string, string>; removed: string[] }}
 */
export function buildEnv(baseEnv, envRemove = [], envKeep = []) {
  const keepSet = new Set(envKeep.map(k => k.toUpperCase()));
  const extraRemoveSet = new Set(envRemove.map(k => k.toUpperCase()));

  /** @type {Record<string, string>} */
  const env = {};
  /** @type {string[]} */
  const removed = [];

  for (const [key, val] of Object.entries(baseEnv)) {
    if (val === undefined) continue;
    const upper = key.toUpperCase();

    if (keepSet.has(upper)) {
      env[key] = val;
      continue;
    }

    const isDenied =
      extraRemoveSet.has(upper) ||
      DENY_PATTERNS.some(p => upper === p || upper.includes(p));

    if (isDenied) {
      removed.push(key);
    } else {
      env[key] = val;
    }
  }

  printSummaryOnce(removed, envKeep);
  return { env, removed };
}

/**
 * Print the environment-filter summary to the console on the first invocation
 * per runner session (as specified in local-runner.md §Console).
 * @param {string[]} removed
 * @param {string[]} kept
 */
function printSummaryOnce(removed, kept) {
  if (summarised) return;
  summarised = true;
  console.log('\n[runner] Environment filter (PD-15):');
  if (removed.length === 0) {
    console.log('  No credential variables found in the environment.');
  } else {
    console.log(`  Removed (${removed.length}): ${removed.join(', ')}`);
  }
  if (kept.length > 0) {
    console.log(`  Kept despite patterns (env_keep): ${kept.join(', ')}`);
  }
  console.log('');
}

/** Reset the summary flag (for tests). */
export function resetSummaryFlag() {
  summarised = false;
}
