// build.mjs — bundle reprise-runner.mjs into a single distributable file
// and print its SHA-256 checksum.
// Spec: 02-specs/local-runner.md §What it is (PD-20)
//
// Usage: node build.mjs
// Output: dist/reprise-runner.mjs  +  dist/reprise-runner.mjs.sha256
//
// A small module-registry bundler with no dependencies. Each source module is
// wrapped in its own function scope (so top-level names never collide), local
// imports become registry lookups, and `node:` imports are hoisted once to the
// top of the bundle. It supports the import/export forms this package uses:
//   import x from 'node:m' | import { a, b as c } from '...' | import * as ns from '...'
//   export function|async function|const|let|class name

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const ENTRY = resolve(__dirname, 'reprise-runner.mjs');
const OUT_DIR = resolve(__dirname, 'dist');
const OUT_FILE = join(OUT_DIR, 'reprise-runner.mjs');

const IMPORT_RE = /^import\s+(?:([\s\S]+?)\s+from\s+)?['"]([^'"]+)['"]\s*;?[ \t]*$/gm;

/** `{ a, b as c }` → `{ a, b: c }` */
function toDestructure(clause) {
  return clause.replace(/\s+as\s+/g, ': ');
}

/** Stable identifier for a node builtin namespace, e.g. node:child_process → __node_child_process */
function nodeNs(spec) {
  return `__node_${spec.replace(/^node:/, '').replace(/[^A-Za-z0-9_]/g, '_')}`;
}

/**
 * Convert an import clause into a declaration that reads from `source`.
 * @param {string} clause  e.g. "http", "{ a, b as c }", "* as ns", "def, { a }"
 * @param {string} source  expression yielding the module namespace
 */
function bindImport(clause, source) {
  const out = [];
  let rest = clause.trim();
  const star = rest.match(/^\*\s+as\s+(\w+)$/);
  if (star) return `const ${star[1]} = ${source};`;
  const def = rest.match(/^(\w+)\s*(?:,\s*([\s\S]*))?$/);
  if (def) {
    out.push(`const ${def[1]} = ${source}.default;`);
    rest = (def[2] ?? '').trim();
  }
  if (rest.startsWith('{')) out.push(`const ${toDestructure(rest)} = ${source};`);
  return out.join(' ');
}

function bundle() {
  /** @type {Map<string, string>} module id (path relative to runner/) → wrapped factory */
  const factories = new Map();
  /** @type {Set<string>} node builtin specifiers */
  const builtins = new Set();

  /** @param {string} absPath */
  function addModule(absPath) {
    const id = relative(__dirname, absPath).replace(/\\/g, '/');
    if (factories.has(id)) return id;
    factories.set(id, ''); // reserve (handles cycles)

    let code = readFileSync(absPath, 'utf8').replace(/\r\n/g, '\n').replace(/^#!.*\n/, '');

    code = code.replace(IMPORT_RE, (_m, clause, spec) => {
      if (spec.startsWith('node:')) {
        builtins.add(spec);
        return clause ? bindImport(clause, nodeNs(spec)) : '';
      }
      if (spec.startsWith('.')) {
        const depId = addModule(resolve(dirname(absPath), spec));
        return clause ? bindImport(clause, `__load(${JSON.stringify(depId)})`) : `__load(${JSON.stringify(depId)});`;
      }
      throw new Error(`${id}: bare import "${spec}" is not supported (the runner has no dependencies)`);
    });

    /** @type {string[]} */
    const exported = [];
    code = code.replace(/^export\s+(async\s+function\*?|function\*?|const|let|class)\s+(\w+)/gm, (_m, kind, name) => {
      exported.push(name);
      return `${kind} ${name}`;
    });
    if (/^export\s/m.test(code)) {
      throw new Error(`${id}: unsupported export form (use "export function|const|let|class name")`);
    }

    const exportsObj = exported.map((n) => `get ${n}() { return ${n}; }`).join(', ');
    factories.set(
      id,
      `// ── ${id} ${'─'.repeat(Math.max(0, 60 - id.length))}\n` +
        `__define(${JSON.stringify(id)}, (__exports) => {\n${code}\nObject.defineProperties(__exports, Object.getOwnPropertyDescriptors({ ${exportsObj} }));\n});\n`,
    );
    return id;
  }

  const entryId = addModule(ENTRY);

  const header = `#!/usr/bin/env node
// reprise-runner.mjs — Reprise Runner (bundled single file)
// Built: ${new Date().toISOString()}
// Spec: 02-specs/local-runner.md
`;
  const imports = [...builtins].sort().map((s) => `import * as ${nodeNs(s)} from '${s}';`).join('\n');
  const runtime = `
const __factories = new Map();
const __cache = new Map();
function __define(id, factory) { __factories.set(id, factory); }
function __load(id) {
  if (__cache.has(id)) return __cache.get(id);
  const exports = {};
  __cache.set(id, exports);
  __factories.get(id)(exports);
  return exports;
}
`;
  const output =
    header + imports + '\n' + runtime + '\n' + [...factories.values()].join('\n') + `\n__load(${JSON.stringify(entryId)});\n`;

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, output, 'utf8');

  const sha256 = createHash('sha256').update(output, 'utf8').digest('hex');
  writeFileSync(OUT_FILE + '.sha256', `${sha256}  reprise-runner.mjs\n`, 'utf8');

  const kb = (Buffer.byteLength(output, 'utf8') / 1024).toFixed(1);
  console.log(`Built: ${OUT_FILE}  (${kb} KB)`);
  console.log(`SHA-256: ${sha256}`);
}

bundle();
