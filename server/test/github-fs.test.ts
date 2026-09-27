import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGitHubFileSystem } from '../src/github-fs';

test('readFile fetches raw contents with the token', async () => {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const fs = createGitHubFileSystem({
    repo: 'o/r',
    token: 'tok',
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), headers: init?.headers as Record<string, string> });
      return new Response('version: 3\n', { status: 200 });
    },
  });
  assert.equal(fs.getRoot(), 'github:o/r');
  const text = new TextDecoder().decode(await fs.readFile('.reprise.yml'));
  assert.equal(text, 'version: 3\n');
  assert.equal(calls[0]!.url, 'https://api.github.com/repos/o/r/contents/.reprise.yml');
  assert.equal(calls[0]!.headers['Authorization'], 'Bearer tok');
  assert.equal(calls[0]!.headers['Accept'], 'application/vnd.github.raw+json');
});

test('path segments are encoded; 404 throws', async () => {
  let seen = '';
  const fs = createGitHubFileSystem({
    repo: 'o/r', token: 't',
    fetchImpl: async (url) => { seen = String(url); return new Response('nope', { status: 404 }); },
  });
  await assert.rejects(fs.readFile('src/a b.ts'), /404/);
  assert.equal(seen, 'https://api.github.com/repos/o/r/contents/src/a%20b.ts');
});

test('writeFile is refused', async () => {
  const fs = createGitHubFileSystem({ repo: 'o/r', token: 't', fetchImpl: async () => new Response('') });
  await assert.rejects(fs.writeFile('x', new Uint8Array()), /read-only/i);
});
