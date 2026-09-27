import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { importLocalRepository, runLocalOverlay, buildFakeServices, EventEmitter } from '../src/index';
import type { RunEvent } from '../src/contracts/execution';

const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };

test('import local repo → read/write approved files → execute and verify isolated overlay', { timeout: 30000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'reprise local repo '));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'src'));
  mkdirSync(join(root, 'tests'));
  mkdirSync(join(root, 'work'));
  writeFileSync(join(root, 'src/value.txt'), 'original');
  writeFileSync(join(root, 'tests/repro.cjs'), `const fs = require('node:fs');\nconsole.log('cwd=' + process.cwd());\nconsole.log(fs.readFileSync(require('node:path').join(__dirname, '../src/value.txt'), 'utf8'));\nconsole.error('stderr evidence');\nprocess.exit(3);\n`);
  writeFileSync(join(root, '.reprise.yml'), `version: 3
edit_scope:
  test: [tests/**]
  fix: [src/**]
  never: [src/private/**]
platforms:
  linux:
    cwd: work
    shell: ${process.platform === 'win32' ? 'cmd' : 'bash'}
    test:
      pattern: tests/**
      single: node {file}
      all: node -e "console.log('suite')"
    lint: node -e "console.log('started');setTimeout(()=>{},10000)"
    run_timeout_seconds: 15
`);
  // Preserve an otherwise empty configured cwd in detached worktrees.
  writeFileSync(join(root, 'work/.keep'), '');
  execFileSync('git', ['init', '-q', root]);
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-qm', 'fixture']);
  execFileSync('git', ['-C', root, 'remote', 'add', 'origin', 'https://github.com/example/local.git']);
  const runner = spawn(process.execPath, [resolve('../../runner/reprise-runner.mjs'), '--root', root, '--port', '47630', '--allow-origin', 'http://localhost:8080'], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => { if (runner.exitCode === null) { runner.kill('SIGTERM'); await once(runner, 'exit'); } });
  const code = await new Promise<string>((resolveCode, reject) => {
    let output = '';
    runner.stderr.on('data', chunk => { output += String(chunk); });
    runner.once('exit', () => reject(new Error(output)));
    runner.stdout.on('data', chunk => {
      output += String(chunk);
      const match = output.match(/Pairing code: (\d+)/);
      if (match) resolveCode(match[1]);
    });
  });
  // Browsers send Origin automatically; this Node integration test supplies it.
  const originalFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', (input: string | URL | Request, init?: RequestInit) => originalFetch(input, { ...init, headers: { ...init?.headers, Origin: 'http://localhost:8080' } }));
  const host = buildFakeServices();
  let allowChanges = true;
  const imported = await importLocalRepository({ auth: host.auth, views: host.views, runnerPort: 47630, pairingCode: code, expectedRemote: 'git@github.com:example/local.git', confirmChanges: async () => allowChanges });
  assert.ok(imported.ok, imported.ok ? '' : imported.error);
  const { services, repository } = imported.value;
  t.after(() => services.runnerClient.disconnect());
  assert.match(repository.head, /^[a-f0-9]{40}$/);
  assert.equal(repository.remote, 'https://github.com/example/local.git');
  assert.deepEqual(await services.github.detectRepo(), { ok: true, value: 'example/local' });
  const file = await services.workspace.readFile('src/value.txt');
  assert.ok(file.ok);
  assert.equal(new TextDecoder().decode(file.value), 'original');
  assert.equal((await services.workspace.readFile('../outside')).ok, false);
  assert.equal((await services.workspace.readFile('.git/config')).ok, false);
  assert.equal((await services.workspace.readFile('src/private/secret')).ok, false);
  const events: RunEvent[] = [];
  const results = await runLocalOverlay(services, { base: repository.head, files: [{ path: 'src/value.txt', content: 'fixed locally' }] }, { platform: 'linux', mode: 'single', test_path: 'tests/repro.cjs', runs: 1 }, token, e => events.push(e), async () => true);
  assert.equal(results[0].exit_code, 3);
  assert.match(results[0].output_tail, /fixed locally/);
  assert.match(results[0].output_tail, /stderr evidence/);
  assert.match(results[0].output_tail, /cwd=.*work/);
  assert.ok(events.some(e => e.type === 'output'));
  assert.equal(readFileSync(join(root, 'src/value.txt'), 'utf8'), 'original');
  assert.equal(execFileSync('git', ['-C', root, 'worktree', 'list', '--porcelain'], { encoding: 'utf8' }).match(/^worktree /gm)?.length, 1);
  // Exact approval hashes and never-scope are enforced at the HTTP boundary.
  assert.equal((await services.runnerClient.createOverlay!({ base: repository.head, files: [{ path: 'src/value.txt', content: 'unapproved mutation' }] })).ok, false);
  assert.equal((await services.runnerClient.approve!('src/private/secret', 'a'.repeat(64))).ok, false);
  allowChanges = false;
  assert.equal((await services.workspace.writeFile('tests/provided.cjs', new TextEncoder().encode('console.log("provided")'))).ok, false);
  allowChanges = true;
  assert.ok((await services.workspace.writeFile('tests/provided.cjs', new TextEncoder().encode('console.log("provided")'))).ok);
  const provided = await services.executors.local.run({ platform: 'linux', mode: 'single', test_path: 'tests/provided.cjs', runs: 1, ref: null }, token, () => {});
  assert.equal(provided[0].exit_code, 0);
  assert.match(provided[0].output_tail, /provided/);
  const generatedOverlay = await runLocalOverlay(services, { base: repository.head, files: [{ path: 'src/value.txt', content: 'second fix' }] }, { platform: 'linux', mode: 'single', test_path: 'tests/provided.cjs', runs: 1 }, token, () => {}, async () => true);
  assert.match(generatedOverlay[0].output_tail, /provided/);
  writeFileSync(join(root, 'tests/provided.cjs'), 'console.log("changed after approval")');
  await assert.rejects(services.executors.local.run({ platform: 'linux', mode: 'single', test_path: 'tests/provided.cjs', runs: 1, ref: null }, token, () => {}), /approval/);
  // Failures before a stream attaches must still be replayed to the executor.
  await assert.rejects(services.executors.local.run({ platform: 'linux', mode: 'all', test_path: '', runs: 1, ref: { base: 'f'.repeat(40) } }, token, () => {}), /git|commit/i);
  const cancellation = new EventEmitter<unknown>();
  await assert.rejects(services.executors.local.run({ platform: 'linux', mode: 'lint', test_path: '', runs: 1, ref: null }, { isCancellationRequested: false, onCancellationRequested: cancellation.event }, event => {
    if (event.type === 'output') cancellation.fire(undefined);
  }), /cancelled/);
});
