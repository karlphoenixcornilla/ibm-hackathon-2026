// build.mjs — bundle reprise-runner.mjs into a single distributable file
// and print its SHA-256 checksum.
// Spec: 02-specs/local-runner.md §What it is (PD-20)
//
// Usage: node build.mjs
// Output: dist/reprise-runner.mjs  +  dist/reprise-runner.mjs.sha256

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname, relative, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const ENTRY = resolve(__dirname, 'reprise-runner.mjs');
const OUT_DIR = resolve(__dirname, 'dist');
const OUT_FILE = join(OUT_DIR, 'reprise-runner.mjs');

/**
 * Collect every .mjs file under srcDir, returning { relPath -> content }.
 * @param {string} srcDir
 * @param {string} base
 * @param {Map<string, string>} acc
 */
function collectFiles(srcDir, base, acc) {
  for (const entry of readdirSync(srcDir)) {
    const full = join(srcDir, entry);
    const rel = relative(base, full);
    if (statSync(full).isDirectory()) {
      collectFiles(full, base, acc);
    } else if (entry.endsWith('.mjs')) {
      acc.set(rel.replace(/\\/g, '/'), readFileSync(full, 'utf8'));
    }
  }
}

/**
 * Very simple bundler: inlines every local import into a single file.
 * Rewrites `import ... from './foo.mjs'` → module code inlined as a
 * module-scoped IIFE, then re-exports via a Map.
 *
 * For hackathon purposes this is intentionally simple: it walks imports
 * depth-first and concatenates the modules in dependency order, replacing
 * relative import paths with the already-defined binding names.
 */
function bundle() {
  const srcDir = resolve(__dirname, 'src');
  /** @type {Map<string, string>} relPath (from srcDir) -> source */
  const modules = new Map();
  collectFiles(srcDir, __dirname, modules);

  // Also include the entry point
  const entryContent = readFileSync(ENTRY, 'utf8');

  // Simple concatenation: strip import declarations, inline modules.
  // Real bundling would need a proper resolver; for single-file output
  // we do a depth-first inline where each file is wrapped in a comment.

  /** @type {Set<string>} */
  const visited = new Set();
  /** @type {string[]} */
  const chunks = [];

  /**
   * @param {string} filePath  absolute path
   */
  function inlineFile(filePath) {
    const rel = relative(__dirname, filePath).replace(/\\/g, '/');
    if (visited.has(rel)) return;
    visited.add(rel);

    const content = modules.get(rel) ?? readFileSync(filePath, 'utf8');

    // Collect local imports first (depth-first)
    const importRe = /^import\s+(?:[\s\S]+?\s+from\s+)?['"](\.[^'"]+)['"]/gm;
    let m;
    while ((m = importRe.exec(content)) !== null) {
      const importedRel = resolve(dirname(filePath), m[1]).replace(/\\/g, '/');
      inlineFile(importedRel);
    }

    // Rewrite: remove import declarations for local modules (already inlined)
    const stripped = content
      .replace(/^import\s+[\s\S]+?\s+from\s+['"](\.[^'"]+)['"]\s*;?\s*$/gm, '// (inlined: $1)')
      .replace(/^import\s+['"](\.[^'"]+)['"]\s*;?\s*$/gm, '// (inlined: $1)');

    chunks.push(`\n// ── ${rel} ──────────────────────────────────\n${stripped}`);
  }

  // Walk all src files
  for (const rel of [...modules.keys()].sort()) {
    inlineFile(resolve(__dirname, rel));
  }

  // Entry point (reprise-runner.mjs itself, already covered above)
  const entryStripped = entryContent
    .replace(/^import\s+[\s\S]+?\s+from\s+['"](\.[^'"]+)['"]\s*;?\s*$/gm, '// (inlined: $1)');

  const banner = `#!/usr/bin/env node
// reprise-runner.mjs — Reprise Runner (bundled single file)
// Built: ${new Date().toISOString()}
// Spec: 02-specs/local-runner.md
`;

  const output = banner + chunks.join('\n') + '\n\n// ── entry ──\n' + entryStripped;

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, output, 'utf8');

  // SHA-256
  const sha256 = createHash('sha256').update(output, 'utf8').digest('hex');
  writeFileSync(OUT_FILE + '.sha256', sha256 + '\n', 'utf8');

  const kb = (Buffer.byteLength(output, 'utf8') / 1024).toFixed(1);
  console.log(`Built: ${OUT_FILE}  (${kb} KB)`);
  console.log(`SHA-256: ${sha256}`);
}

bundle();
