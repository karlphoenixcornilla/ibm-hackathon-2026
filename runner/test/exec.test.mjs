// test/exec.test.mjs — unit tests for the execution core
// Spec: 02-specs/test-execution.md §Local executor, 02-specs/local-runner.md §Executing

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { runCommand } from '../src/exec.mjs';
import { resetSummaryFlag } from '../src/env.mjs';

const isWindows = process.platform === 'win32';
const shell = isWindows ? 'cmd' : 'bash';

describe('runCommand — basic execution', () => {
  it('runs echo and captures output', async () => {
    const lines = [];
    const result = await runCommand({
      platform: 'linux',
      command: isWindows ? 'echo hello' : 'echo hello',
      shell,
      cwd: tmpdir(),
      testPath: 'test.mjs',
      timeoutMs: 5000,
      reportPath: '',
      reportFormat: 'junit',
      hostOs: process.platform,
      device: '',
      envRemove: [],
      envKeep: [],
      onOutput: (line) => lines.push(line),
    });

    assert.equal(result.platform, 'linux');
    assert.equal(result.executor, 'local');
    assert.equal(result.method, 'repo_command');
    assert.equal(result.timed_out, false);
    assert.equal(result.exit_code, 0);
    assert.ok(result.duration_ms >= 0);
    assert.ok(result.output_tail.includes('hello'));
    assert.equal(result.runner_version, '0.1.0');
  });

  it('captures exit code for failing commands', async () => {
    const result = await runCommand({
      platform: 'linux',
      command: isWindows ? 'exit 1' : 'exit 1',
      shell,
      cwd: tmpdir(),
      testPath: 'test.mjs',
      timeoutMs: 5000,
      reportPath: '',
      reportFormat: 'junit',
      hostOs: process.platform,
      device: '',
      envRemove: [],
      envKeep: [],
      onOutput: () => {},
    });

    assert.notEqual(result.exit_code, 0);
  });
});

describe('runCommand — {file} substitution', () => {
  it('substitutes {file} with the quoted test path', async () => {
    const lines = [];
    const result = await runCommand({
      platform: 'linux',
      command: isWindows ? 'echo {file}' : 'echo {file}',
      shell,
      cwd: tmpdir(),
      testPath: 'path/to/my test.mjs',
      timeoutMs: 5000,
      reportPath: '',
      reportFormat: 'junit',
      hostOs: process.platform,
      device: '',
      envRemove: [],
      envKeep: [],
      onOutput: (line) => lines.push(line),
    });

    assert.ok(result.output_tail.includes('my test.mjs'));
  });
});

describe('runCommand — timeout and process-tree kill', () => {
  it('kills a sleeping process and sets timed_out=true', async () => {
    resetSummaryFlag();
    const sleepCmd = isWindows
      ? 'powershell -Command "Start-Sleep -Seconds 30"'
      : 'sleep 30';

    const result = await runCommand({
      platform: 'linux',
      command: sleepCmd,
      shell,
      cwd: tmpdir(),
      testPath: 'sleep.mjs',
      timeoutMs: 300, // 300 ms — will fire before sleep finishes
      reportPath: '',
      reportFormat: 'junit',
      hostOs: process.platform,
      device: '',
      envRemove: [],
      envKeep: [],
      onOutput: () => {},
    });

    assert.equal(result.timed_out, true);
  });
});

describe('runCommand — stale report deletion', () => {
  it('deletes a stale report before running', async () => {
    const dir = join(tmpdir(), `reprise-exec-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const reportPath = join(dir, 'junit.xml');
    writeFileSync(reportPath, '<old/>', 'utf8');

    // Command that does nothing
    await runCommand({
      platform: 'linux',
      command: isWindows ? 'echo ok' : 'echo ok',
      shell,
      cwd: dir,
      testPath: 'test.mjs',
      timeoutMs: 5000,
      reportPath,
      reportFormat: 'junit',
      hostOs: process.platform,
      device: '',
      envRemove: [],
      envKeep: [],
      onOutput: () => {},
    });

    // Report should have been deleted (command didn't recreate it)
    const { existsSync } = await import('node:fs');
    assert.ok(!existsSync(reportPath), 'Stale report should have been deleted before the run');
  });
});

describe('runCommand — output_tail capped at 200 lines', () => {
  it('keeps only the last 200 lines when output is very long', async () => {
    const bigCommand = isWindows
      ? 'for /L %i in (1,1,250) do @echo line %i'
      : 'for i in $(seq 1 250); do echo "line $i"; done';

    const result = await runCommand({
      platform: 'linux',
      command: bigCommand,
      shell,
      cwd: tmpdir(),
      testPath: 'test.mjs',
      timeoutMs: 10000,
      reportPath: '',
      reportFormat: 'junit',
      hostOs: process.platform,
      device: '',
      envRemove: [],
      envKeep: [],
      onOutput: () => {},
    });

    const lines = result.output_tail.split('\n').filter(l => l.trim());
    assert.ok(lines.length <= 200, `output_tail should have ≤200 lines, got ${lines.length}`);
  });
});

describe('runCommand — local execution failures and output', () => {
  const options = {
    platform: 'linux', shell, cwd: tmpdir(), testPath: '', timeoutMs: 5000,
    reportPath: '', reportFormat: 'junit', hostOs: process.platform, device: '',
    envRemove: [], envKeep: [], onOutput: () => {},
  };
  it('returns a null exit status and streams a process-start failure', async () => {
    const lines = [];
    const result = await runCommand({ ...options, command: 'echo no', cwd: join(tmpdir(), 'missing-reprise-directory-9342'), onOutput: line => lines.push(line) });
    assert.equal(result.exit_code, null);
    assert.equal(result.timed_out, false);
    assert.match(result.output_tail, /Failed to start process/);
    assert.ok(lines.some(line => line.includes('Failed to start process')));
  });
  it('collects stdout and stderr including incomplete trailing lines', async () => {
    const result = await runCommand({ ...options, command: `node -e "process.stdout.write('out');process.stderr.write('err')"` });
    assert.equal(result.exit_code, 0);
    assert.match(result.output_tail, /out/);
    assert.match(result.output_tail, /err/);
  });
});
