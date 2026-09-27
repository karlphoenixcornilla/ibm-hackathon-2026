import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildServices, buildFakeServices, EventEmitter } from '../src/index';

test('real composition loads configuration through host services without an IDE', async () => {
  const host = buildFakeServices();
  await host.workspace.writeFile('.reprise.yml', new TextEncoder().encode('version: 3\ndefaults:\n  trials: 4\n'));
  const services = buildServices(host);
  assert.equal(services.auth, host.auth);
  assert.equal(services.workspace, host.workspace);
  assert.equal(services.views, host.views);
  const result = await services.config.load();
  assert.ok(result.ok);
  assert.equal(result.value.defaults.trials.min, 4);
  assert.equal(services.config.getUri(), '.reprise.yml');
  services.config.invalidate();
  assert.equal(services.config.get(), null);
});

test('host workspace errors propagate through config loading', async () => {
  const services = buildServices(buildFakeServices());
  const result = await services.config.load();
  assert.equal(result.ok, false);
});

test('host events support subscription disposal', () => {
  const emitter = new EventEmitter<number>();
  const values: number[] = [];
  const subscription = emitter.event(value => values.push(value));
  emitter.fire(1);
  subscription.dispose();
  emitter.fire(2);
  emitter.event(value => values.push(value));
  emitter.dispose();
  emitter.fire(3);
  assert.deepEqual(values, [1]);
});
