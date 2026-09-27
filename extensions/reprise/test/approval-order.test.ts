import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFakeServices } from '../src/index';
import { makeBlankRecord } from '../src/pipeline/record-factory';
import { testStage } from '../src/pipeline/test-stage';
import { firstRunStage } from '../src/pipeline/first-run';
import type { PipelineContext } from '../src/pipeline/types';
import { Result } from '../src/util/result';

function context(): PipelineContext {
  const services = buildFakeServices();
  services.providers.getActive = () => ({
    id: 'stub', capabilities: { images: false, implemented: true },
    run: async () => ({ json: { test_file: 'tests/new.js', signature: { kind: 'assertion_message', pattern: 'bug' } }, files: [{ path: 'tests/new.js', content: 'test content' }], usage: { calls: 1, detail: {} }, provider: 'stub', stubbed: true }),
  });
  services.runnerClient.isPaired = () => true;
  return { services, repo: 'team/app', issue: 1, record: makeBlankRecord('team/app', 1, 'Bug', '', 'test'), token: { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) }, addEvent: () => {} };
}

test('#16 provided test stage awaits runner approval before completing', async () => {
  const ctx = context();
  let release: () => void = () => {};
  let arrived: () => void = () => {};
  const entered = new Promise<void>(resolve => { arrived = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  ctx.services.runnerClient.approve = async () => { arrived(); await gate; return Result.ok({ ok: true }); };
  let finished = false;
  const stage = testStage.run(ctx).then(result => { finished = true; return result; });
  await entered;
  assert.equal(finished, false);
  release();
  assert.equal((await stage).ok, true);
});

test('#16 refused approvals stop test generation and revision before more executions', async () => {
  const ctx = context();
  ctx.services.runnerClient.approve = async () => Result.err('approval refused');
  const generated = await testStage.run(ctx);
  assert.equal(generated.ok, false);
  assert.match(generated.error ?? '', /approval refused/);
  ctx.record.replication.repro.test_origin = 'provided';
  let runs = 0;
  ctx.services.executors.local.run = async () => {
    runs++;
    return [{ platform: 'linux', executor: 'local', method: 'repo_command', exit_code: 0, timed_out: false, duration_ms: 1, tests: [], output_tail: '', host_os: 'linux', device: '', ci_run_url: null, runner_version: 'test' }];
  };
  assert.equal((await firstRunStage.run(ctx)).ok, false);
  assert.equal(runs, 1);
});
