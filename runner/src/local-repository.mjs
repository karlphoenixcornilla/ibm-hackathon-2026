// Filesystem boundary for an explicitly selected local repository.
import { realpathSync, statSync, lstatSync, existsSync } from 'node:fs';
import { resolve, relative, isAbsolute, dirname, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadConfig, detectRemote, detectHead } from './config.mjs';

export function repositoryPath(root, path, { allowRoot = false } = {}) {
  if (typeof path !== 'string' || !path || path.includes('\0') || path.includes('\\') || /^[a-z]:/i.test(path) || isAbsolute(path) || path.split('/').includes('..') || path.split('/').some(part => part.toLowerCase() === '.git')) {
    throw new Error('Path must be relative without .., backslashes or .git segments');
  }
  if (path !== '.' && path.split('/').some(part => !part || part === '.')) throw new Error('Path must use canonical relative segments');
  const target = resolve(root, path);
  const rel = relative(root, target);
  if ((!rel && !allowRoot) || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('Path is outside repository');
  // Reject symlink components, including dangling links, before reads or writes.
  let current = target;
  while (current !== root) {
    try { if (lstatSync(current).isSymbolicLink()) throw new Error('Symlink paths are not allowed'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    current = dirname(current);
  }
  return target;
}

export function inScope(path, patterns = []) {
  return patterns.some(pattern => {
    const source = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*\//g, '§DIR§').replace(/\*\*/g, '§ALL§').replace(/\*/g, '[^/]*')
      .replace(/§DIR§/g, '(?:.*/)?').replace(/§ALL§/g, '.*');
    return new RegExp(`^${source}$`).test(path);
  });
}

export function scopedPath(root, path, config, kind = 'read') {
  const target = repositoryPath(root, path);
  if (kind === 'read' && path === '.reprise.yml') return target;
  const scope = config.edit_scope ?? {};
  const allowed = kind === 'fix' ? scope.fix : [...(scope.test ?? []), ...(scope.fix ?? [])];
  if (inScope(path, ['.git/**', '.reprise.yml', ...(scope.never ?? [])]) || !inScope(path, allowed)) throw new Error(`Path is outside edit_scope (${kind})`);
  return target;
}

export function importRepository(location) {
  if (typeof location !== 'string' || !location.trim()) throw new Error('Repository location is required');
  const root = realpathSync(resolve(location));
  if (!statSync(root).isDirectory()) throw new Error('Repository location must be a directory');
  let top;
  try { top = realpathSync(execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()); }
  catch { throw new Error('Location is not a Git working repository'); }
  if (top !== root) throw new Error(`Select the repository root: ${top}`);
  const head = detectHead(root);
  if (!/^[a-f0-9]{40,64}$/i.test(head)) throw new Error('Repository must have a committed HEAD');
  repositoryPath(root, '.reprise.yml');
  const config = loadConfig(root);
  if (config.version !== 3 || !config.platforms || typeof config.platforms !== 'object' || Array.isArray(config.platforms) || !Object.keys(config.platforms).length) throw new Error('A version 3 .reprise.yml with configured platforms is required');
  for (const [name, platform] of Object.entries(config.platforms)) {
    if (!['linux', 'macos', 'windows', 'android', 'ios'].includes(name) || !platform || typeof platform !== 'object') throw new Error(`Invalid platform: ${name}`);
    const cwd = repositoryPath(root, platform.cwd ?? '.', { allowRoot: true });
    if (!existsSync(cwd) || !statSync(cwd).isDirectory()) throw new Error(`Platform ${name} cwd is not a directory`);
    if (platform.test?.report_path) repositoryPath(root, platform.test.report_path);
    if (![platform.test?.single, platform.test?.all, platform.lint].some(command => typeof command === 'string' && command.trim())) throw new Error(`Platform ${name} needs a test or lint command`);
  }
  return { root, head, remote: detectRemote(root), config };
}
