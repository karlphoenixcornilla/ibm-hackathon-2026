// src/config.mjs — read .reprise.yml, git remote and HEAD detection
// Spec: 02-specs/reprise-config.md, 02-specs/local-runner.md
// The runner reads only --root/.reprise.yml (PD-18).

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

/**
 * @typedef {import('./server.mjs').RunnerConfig} RunnerConfig
 */

/**
 * Parse a YAML .reprise.yml from `root`.
 * Uses a minimal hand-rolled parser for the subset we need.
 * No external dependencies.
 * @param {string} root
 * @returns {RunnerConfig}
 */
export function loadConfig(root) {
  const configPath = join(root, '.reprise.yml');
  if (!existsSync(configPath)) {
    throw new Error(`${configPath} not found. The runner requires --root to contain .reprise.yml`);
  }
  const raw = readFileSync(configPath, 'utf8');
  return parseRepriseYaml(raw);
}

/**
 * Detect git remote (origin) from `root`.
 * @param {string} root
 * @returns {string}
 */
export function detectRemote(root) {
  try {
    return execSync('git remote get-url origin', { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    try {
      // fallback: parse .git/config
      const gitConfig = readFileSync(join(root, '.git', 'config'), 'utf8');
      const m = gitConfig.match(/\[remote "origin"\][^\[]*url\s*=\s*(.+)/);
      return m ? m[1].trim() : '';
    } catch {
      return '';
    }
  }
}

/**
 * Detect current HEAD SHA from `root`.
 * @param {string} root
 * @returns {string}
 */
export function detectHead(root) {
  try {
    return execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    try {
      const head = readFileSync(join(root, '.git', 'HEAD'), 'utf8').trim();
      if (head.startsWith('ref: ')) {
        const refPath = join(root, '.git', head.slice(5));
        if (existsSync(refPath)) return readFileSync(refPath, 'utf8').trim();
      }
      return head; // detached HEAD — already a SHA
    } catch {
      return '';
    }
  }
}

// ── Minimal YAML parser for .reprise.yml ─────────────────────────────────────

/**
 * Very small subset YAML parser for .reprise.yml.
 * Handles: mappings (key: value), inline strings, numbers, booleans,
 * block sequences (- item), nested mappings via indentation,
 * trailing # comments, and inline flow maps ({ key: val, ... }).
 * @param {string} text
 * @returns {RunnerConfig}
 */
function parseRepriseYaml(text) {
  // Use a line-based approach to build a plain JS object, then cast.
  const obj = parseYamlObject(text.split('\n'), 0).value;
  return /** @type {RunnerConfig} */ (obj);
}

/**
 * @param {string[]} lines
 * @param {number} baseIndent
 * @returns {{ value: Record<string, unknown>; consumed: number }}
 */
function parseYamlObject(lines, baseIndent) {
  /** @type {Record<string, unknown>} */
  const obj = {};
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trimStart();
    if (!trimmed || trimmed.startsWith('#')) { i++; continue; }

    const indent = line.length - trimmed.length;
    if (indent < baseIndent) break; // back to parent

    // sequence item at this level
    if (trimmed.startsWith('- ')) {
      // This is a sequence, but we were called expecting a mapping; stop.
      break;
    }

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) { i++; continue; }

    const key = trimmed.slice(0, colonIdx).trim();
    const rest = trimmed.slice(colonIdx + 1).trim();

    if (rest === '' || rest === '{}' || rest === '[]') {
      // Look ahead for children
      const childLines = lines.slice(i + 1);
      const firstChild = childLines.find(l => l.trim() && !l.trim().startsWith('#'));
      if (!firstChild) { obj[key] = rest === '[]' ? [] : {}; i++; continue; }

      const childIndent = firstChild.length - firstChild.trimStart().length;
      if (childIndent > indent) {
        if (firstChild.trimStart().startsWith('- ')) {
          // sequence
          const { value, consumed } = parseYamlSequence(childLines, childIndent);
          obj[key] = value;
          i += 1 + consumed;
        } else {
          // nested mapping
          const { value, consumed } = parseYamlObject(childLines, childIndent);
          obj[key] = value;
          i += 1 + consumed;
        }
      } else {
        obj[key] = rest === '[]' ? [] : {};
        i++;
      }
    } else {
      obj[key] = scalarValue(rest);
      i++;
    }
  }

  return { value: obj, consumed: i };
}

/**
 * @param {string[]} lines
 * @param {number} baseIndent
 * @returns {{ value: unknown[]; consumed: number }}
 */
function parseYamlSequence(lines, baseIndent) {
  /** @type {unknown[]} */
  const arr = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trimStart();
    if (!trimmed || trimmed.startsWith('#')) { i++; continue; }

    const indent = line.length - trimmed.length;
    if (indent < baseIndent) break;

    if (trimmed.startsWith('- ')) {
      const itemStr = trimmed.slice(2).trim();
      if (itemStr === '' || itemStr === '{}') {
        // next lines are a mapping
        const childLines = lines.slice(i + 1);
        const firstChild = childLines.find(l => l.trim() && !l.trim().startsWith('#'));
        if (firstChild) {
          const childIndent = firstChild.length - firstChild.trimStart().length;
          if (childIndent > indent) {
            const { value, consumed } = parseYamlObject(childLines, childIndent);
            arr.push(value);
            i += 1 + consumed;
            continue;
          }
        }
        arr.push({});
      } else {
        arr.push(scalarValue(itemStr));
      }
    }
    i++;
  }

  return { value: arr, consumed: i };
}

/**
 * Strip a trailing unquoted YAML comment from a scalar string.
 * e.g. `"local                    # local | ci"` → `"local"`
 * e.g. `"{ min: 5 }   # comment"` → `"{ min: 5 }"`
 * Quoted values ('...' / "...") are returned as-is; the # inside
 * quoted strings is left untouched.
 * @param {string} s  Raw value string (already trimmed)
 * @returns {string}
 */
function stripComment(s) {
  // Don't strip from quoted strings (# inside quotes is not a comment)
  if (s.startsWith('"') || s.startsWith("'")) {
    return s;
  }
  // For flow collections, strip the comment that follows the closing brace/bracket
  // e.g. "{ min: 5, max: 10 }   # optional override" → "{ min: 5, max: 10 }"
  if (s.startsWith('{') || s.startsWith('[')) {
    const closeChar = s.startsWith('{') ? '}' : ']';
    const closeIdx = s.lastIndexOf(closeChar);
    if (closeIdx !== -1) {
      return s.slice(0, closeIdx + 1).trimEnd();
    }
    return s;
  }
  // Plain scalar: a comment starts at " #" (whitespace then #)
  const idx = s.search(/\s+#/);
  return idx === -1 ? s : s.slice(0, idx).trimEnd();
}

/**
 * Parse an inline YAML flow mapping: { key: val, key2: val2 }.
 * Returns a plain object or null if the string is not a flow map.
 * @param {string} s
 * @returns {Record<string, unknown> | null}
 */
function parseFlowMap(s) {
  if (!s.startsWith('{') || !s.endsWith('}')) return null;
  const inner = s.slice(1, -1).trim();
  if (!inner) return {};
  /** @type {Record<string, unknown>} */
  const obj = {};
  // Simple comma-split; doesn't handle nested braces (sufficient for .reprise.yml)
  for (const pair of inner.split(',')) {
    const colonIdx = pair.indexOf(':');
    if (colonIdx === -1) continue;
    const k = pair.slice(0, colonIdx).trim();
    const v = pair.slice(colonIdx + 1).trim();
    if (k) obj[k] = scalarValue(v);
  }
  return obj;
}

/**
 * @param {string} s  Raw value string (already trimmed from the YAML line)
 * @returns {unknown}
 */
function scalarValue(s) {
  // Strip trailing comments before any other processing
  s = stripComment(s);

  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null' || s === '~') return null;
  if (s === '') return null;

  // inline flow map { ... }
  if (s.startsWith('{')) {
    const map = parseFlowMap(s);
    if (map !== null) return map;
  }

  // inline sequence [a, b, c]
  if (s.startsWith('[') && s.endsWith(']')) {
    return s.slice(1, -1).split(',').map(x => scalarValue(x.trim())).filter(x => x !== null && x !== '');
  }

  // strip surrounding quotes
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }

  const n = Number(s);
  if (!isNaN(n) && s !== '') return n;

  return s;
}
