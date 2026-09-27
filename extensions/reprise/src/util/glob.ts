// util/glob.ts — path glob matching for edit_scope checks (security.md, reprise-config.md).
// Supports `**` (any number of path segments, including none), `*` (within one
// segment) and `?` (one character). Paths and patterns use forward slashes.

const cache = new Map<string, RegExp>();

export function globToRegExp(pattern: string): RegExp {
  const hit = cache.get(pattern);
  if (hit) return hit;
  let src = '';
  const p = pattern.replace(/\\/g, '/');
  for (let i = 0; i < p.length; i++) {
    const ch = p[i];
    if (ch === '*') {
      if (p[i + 1] === '*') {
        const slash = p[i + 2] === '/';
        src += slash ? '(?:.*/)?' : '.*';
        i += slash ? 2 : 1;
      } else {
        src += '[^/]*';
      }
    } else if (ch === '?') {
      src += '[^/]';
    } else {
      src += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  const re = new RegExp(`^${src}$`);
  cache.set(pattern, re);
  return re;
}

export function matchesAny(path: string, patterns: readonly string[]): boolean {
  const p = path.replace(/\\/g, '/').replace(/^\.\//, '');
  return patterns.some((pat) => globToRegExp(pat).test(p));
}

/**
 * True if `path` may be written: inside `allowed` (an empty list allows any path)
 * and outside `never`. Paths with `..` or absolute paths are always refused.
 */
export function inEditScope(path: string, allowed: readonly string[], never: readonly string[]): boolean {
  const p = path.replace(/\\/g, '/');
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p) || p.split('/').includes('..')) return false;
  if (matchesAny(p, never)) return false;
  return allowed.length === 0 || matchesAny(p, allowed);
}
