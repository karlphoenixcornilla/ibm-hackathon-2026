import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { importRepository, repositoryPath, scopedPath } from '../src/local-repository.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'reprise import '));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', root]);
  writeFileSync(join(root, '.reprise.yml'), 'version: 3\nplatforms:\n  linux:\n    cwd: .\n    lint: echo ok\n');
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-qm', 'fixture']);
  return root;
}

test('imports a local repository with spaces and no remote', t => {
  const root = fixture(t);
  const repo = importRepository(root);
  assert.equal(repo.remote, '');
  assert.match(repo.head, /^[a-f0-9]{40}$/);
  assert.equal(importRepository(join(root, '.')).root, repo.root);
  mkdirSync(join(root, 'nested'));
  assert.throws(() => importRepository(join(root, 'nested')), /repository root/);
  assert.throws(() => importRepository(join(root, '.reprise.yml')), /directory/);
});

test('rejects missing, non-git, empty and unusable projects', t => {
  const root = fixture(t);
  assert.throws(() => importRepository(join(root, 'missing')));
  const plain = mkdtempSync(join(tmpdir(), 'reprise-plain-'));
  t.after(() => rmSync(plain, { recursive: true, force: true }));
  assert.throws(() => importRepository(plain), /Git working/);
  execFileSync('git', ['init', '-q', plain]);
  assert.throws(() => importRepository(plain), /committed HEAD/);
  writeFileSync(join(root, '.reprise.yml'), 'garbage');
  assert.throws(() => importRepository(root), /version 3/);
  writeFileSync(join(root, '.reprise.yml'), 'version: 3\nplatforms:\n  linux:\n    cwd: ../escape\n    lint: echo ok\n');
  assert.throws(() => importRepository(root), /relative/);
  rmSync(join(root, '.reprise.yml'));
  assert.throws(() => importRepository(root), /not found/);
});

test('scoped local file access rejects traversal, metadata and symlinks', t => {
  const root = importRepository(fixture(t)).root;
  const config = { edit_scope: { test: ['tests/**'], fix: ['src/**'], never: ['src/secret*'] } };
  for (const path of ['../secret', '/etc/passwd', 'C:/secret', 'src\\secret', '.git/config', 'src/../../secret']) assert.throws(() => repositoryPath(root, path));
  assert.equal(scopedPath(root, 'src/app.ts', config), join(root, 'src/app.ts'));
  assert.throws(() => scopedPath(root, 'src/secret.txt', config), /scope/);
  assert.throws(() => scopedPath(root, '.reprise.yml', config, 'write'), /scope/);
  assert.throws(() => scopedPath(root, 'README.md', config), /scope/);
  symlinkSync(tmpdir(), join(root, 'src'), 'dir');
  assert.throws(() => scopedPath(root, 'src/outside', config), /Symlink/);
});

test('imports a linked Git worktree and isolates repositories sharing a commit', async t => {
  const root = fixture(t);
  const { getOrCreateWorktree, removeWorktree } = await import('../src/repo.mjs');
  const repo = importRepository(root);
  const first = await getOrCreateWorktree(root, '', repo.head);
  const second = await getOrCreateWorktree(root, '', repo.head);
  t.after(async () => { await removeWorktree(root, first); await removeWorktree(root, second); });
  assert.notEqual(first, second);
  assert.equal(importRepository(first).head, repo.head);
  assert.equal(importRepository(second).head, repo.head);
  await assert.rejects(getOrCreateWorktree(root, '', '../escape'), /commit SHA/);
});
