// test/env.test.mjs — unit tests for the credential-stripping environment filter
// Spec: 02-specs/security.md §Environment filter for runner-started tests (PD-15)

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildEnv, resetSummaryFlag } from '../src/env.mjs';

beforeEach(() => resetSummaryFlag());

describe('buildEnv — basic credential removal', () => {
  it('removes GITHUB_TOKEN', () => {
    const { env, removed } = buildEnv({ GITHUB_TOKEN: 'ghp_abc', PATH: '/usr/bin' });
    assert.ok(!('GITHUB_TOKEN' in env));
    assert.ok(removed.includes('GITHUB_TOKEN'));
    assert.equal(env.PATH, '/usr/bin');
  });

  it('removes GH_TOKEN', () => {
    const { env, removed } = buildEnv({ GH_TOKEN: 'token123', HOME: '/home/user' });
    assert.ok(!('GH_TOKEN' in env));
    assert.ok(removed.includes('GH_TOKEN'));
  });

  it('removes variables containing TOKEN in their name', () => {
    const { env, removed } = buildEnv({ MY_AUTH_TOKEN: 'secret', CI: 'true' });
    assert.ok(!('MY_AUTH_TOKEN' in env));
    assert.ok(removed.includes('MY_AUTH_TOKEN'));
    assert.equal(env.CI, 'true');
  });

  it('removes variables containing SECRET', () => {
    const { env, removed } = buildEnv({ APP_SECRET: 'x', NODE_ENV: 'test' });
    assert.ok(!('APP_SECRET' in env));
    assert.ok(removed.includes('APP_SECRET'));
    assert.equal(env.NODE_ENV, 'test');
  });

  it('removes variables containing PASSWORD', () => {
    const { env, removed } = buildEnv({ DB_PASSWORD: 'hunter2' });
    assert.ok(!('DB_PASSWORD' in env));
  });

  it('removes variables containing API_KEY', () => {
    const { env, removed } = buildEnv({ OPENAI_API_KEY: 'sk-abc' });
    assert.ok(!('OPENAI_API_KEY' in env));
  });

  it('removes variables containing PRIVATE_KEY', () => {
    const { env, removed } = buildEnv({ GPG_PRIVATE_KEY: '-----BEGIN' });
    assert.ok(!('GPG_PRIVATE_KEY' in env));
  });

  it('keeps unrelated variables', () => {
    const { env } = buildEnv({ NODE_ENV: 'test', HOME: '/root', TERM: 'xterm' });
    assert.equal(env.NODE_ENV, 'test');
    assert.equal(env.HOME, '/root');
    assert.equal(env.TERM, 'xterm');
  });
});

describe('buildEnv — env_remove extra list', () => {
  it('removes extra variables listed in env_remove', () => {
    const { env, removed } = buildEnv(
      { MY_CUSTOM_VAR: 'val', PATH: '/usr' },
      ['MY_CUSTOM_VAR']
    );
    assert.ok(!('MY_CUSTOM_VAR' in env));
    assert.ok(removed.includes('MY_CUSTOM_VAR'));
  });

  it('env_remove is case-insensitive', () => {
    const { env } = buildEnv({ my_custom_var: 'val' }, ['MY_CUSTOM_VAR']);
    // env_remove matched uppercase of key — key is 'my_custom_var'
    // Since we upper-case both sides, this should be removed
    assert.ok(!('my_custom_var' in env));
  });
});

describe('buildEnv — env_keep override', () => {
  it('keeps a variable that would otherwise be stripped', () => {
    const { env, removed } = buildEnv(
      { ANDROID_TOKEN: 'needed-by-sdk', GITHUB_TOKEN: 'ghp_no' },
      [],
      ['ANDROID_TOKEN']
    );
    assert.equal(env.ANDROID_TOKEN, 'needed-by-sdk');
    assert.ok(!('GITHUB_TOKEN' in env));
    assert.ok(!removed.includes('ANDROID_TOKEN'));
  });
});

describe('buildEnv — undefined values are skipped', () => {
  it('skips undefined environment values', () => {
    const base = { SOME_VAR: 'x', UNDEF_VAR: undefined };
    const { env } = buildEnv(base);
    assert.equal(env.SOME_VAR, 'x');
    assert.ok(!('UNDEF_VAR' in env));
  });
});
