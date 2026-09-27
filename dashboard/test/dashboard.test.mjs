// dashboard/test/dashboard.test.mjs — lib.mjs logic, fixtures against the real
// issue-record schema, and the site build end to end (sample mode, no network).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildIndex,
  cellsFromSequence,
  displayState,
  formatPercent,
  safeGithubUrl,
  stateTone,
  stripSummary,
  validateIndex,
  validateRecord,
  verificationSequence,
} from '../lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const dashboard = join(here, '..');
const repoRoot = join(dashboard, '..');

function fixtures() {
  const out = [];
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (n.endsWith('.json')) out.push(JSON.parse(readFileSync(p, 'utf8')));
    }
  };
  walk(join(dashboard, 'fixtures'));
  return out;
}

describe('display', () => {
  it('uses plain words, never enum names', () => {
    assert.equal(displayState('FLAKY'), 'Reproduced sometimes');
    assert.equal(displayState('DUPLICATE', 2), 'Duplicate of #2');
    assert.equal(displayState('DUPLICATE'), 'Duplicate');
    assert.equal(displayState('REGRESSION_DETECTED'), 'Fix breaks other tests');
  });

  it('colours only evidence states', () => {
    assert.equal(stateTone('CONFIRMED'), 'reproduced');
    assert.equal(stateTone('FIX_VERIFIED'), 'clean');
    assert.equal(stateTone('FLAKY'), 'intermittent');
    assert.equal(stateTone('NEEDS_INFO'), '');
  });

  it('summarises a strip for screen readers', () => {
    assert.equal(stripSummary('FPPFP'), 'Reproduced in 2 of 5 runs: runs 1, 4');
    assert.equal(stripSummary('PPX'), 'Did not reproduce in 2 runs; 1 invalid');
    assert.equal(stripSummary(''), 'No runs yet');
    assert.deepEqual(cellsFromSequence('PFXE'), ['pass', 'fail', 'invalid', 'invalid']);
  });

  it('formats rates', () => {
    assert.equal(formatPercent(0.077), '7.7%');
    assert.equal(formatPercent(0.4), '40%');
    assert.equal(formatPercent(0), '0%');
  });

  it('only links to github.com', () => {
    assert.equal(safeGithubUrl('https://github.com/o/r/pull/1'), 'https://github.com/o/r/pull/1');
    assert.equal(safeGithubUrl('javascript:alert(1)'), null);
    assert.equal(safeGithubUrl('https://github.com.evil.example/x'), null);
    assert.equal(safeGithubUrl(null), null);
  });

  it('builds the verification strip from counts', () => {
    assert.equal(verificationSequence({ verification: { repro: { runs: 4, failed: 1, invalid: 1 } } }), 'FXPP');
    assert.equal(verificationSequence(undefined), '');
  });
});

describe('fixtures', () => {
  it('pass the dashboard record check', () => {
    for (const r of fixtures()) assert.deepEqual(validateRecord(r), [], `${r.repo}#${r.issue}`);
  });

  it('pass the extension issue-record JSON Schema (contract drift check)', (t) => {
    const ext = join(repoRoot, 'extensions', 'reprise');
    if (!existsSync(join(ext, 'node_modules', 'ajv'))) {
      t.skip('extensions/reprise/node_modules not installed');
      return;
    }
    const require = createRequire(join(ext, 'package.json'));
    const Ajv = require('ajv/dist/2020').default;
    const ajv = new Ajv({ allErrors: true, strict: false });
    const schema = JSON.parse(readFileSync(join(ext, 'src', 'contracts', 'schemas', 'issue-record.schema.json'), 'utf8'));
    const validate = ajv.compile(schema);
    for (const r of fixtures()) {
      assert.ok(validate(r), `${r.repo}#${r.issue}: ${ajv.errorsText(validate.errors)}`);
    }
  });

  it('rejects a broken record', () => {
    assert.ok(validateRecord({ schema: 2 }).length > 0);
  });
});

describe('buildIndex', () => {
  const index = buildIndex(fixtures(), { dataSource: 'sample', repos: ['a/b'], now: '2026-09-27T00:00:00Z' });

  it('is valid against the index schema', () => {
    assert.deepEqual(validateIndex(index), []);
  });

  it('computes totals', () => {
    assert.equal(index.totals.issues, 5);
    assert.equal(index.totals.fixes_verified, 1);
    assert.equal(Object.keys(index.totals.by_platform).length, 5);
    assert.ok(index.totals.median_time_to_verdict_ms > 0);
  });

  it('sorts newest first and carries the PR', () => {
    const times = index.issues.map((i) => i.updated_at);
    assert.deepEqual(times, [...times].sort().reverse());
    assert.equal(index.issues.find((i) => i.issue === 7)?.pr, 'https://github.com/reprise-demo/field-notes/pull/12');
  });

  it('flags an invalid index', () => {
    assert.ok(validateIndex({ ...index, data_source: 'demo' }).includes('data_source'));
  });
});

describe('build.mjs', () => {
  it('builds the sample site without network access', () => {
    const out = mkdtempSync(join(tmpdir(), 'reprise-site-'));
    execFileSync(process.execPath, [join(dashboard, 'build.mjs'), '--out', out, '--sample'], { stdio: 'pipe' });
    for (const f of ['index.html', 'app.js', 'lib.mjs', 'styles.css', 'data/index.json', 'data/reprise-demo/field-notes/issues/7.json']) {
      assert.ok(existsSync(join(out, f)), f);
    }
    const index = JSON.parse(readFileSync(join(out, 'data', 'index.json'), 'utf8'));
    assert.equal(index.data_source, 'sample');
    const html = readFileSync(join(out, 'index.html'), 'utf8');
    assert.match(html, /Content-Security-Policy/);
    assert.match(html, /script-src 'self'/);
  });

  it('never uses innerHTML', () => {
    const app = readFileSync(join(dashboard, 'app.js'), 'utf8');
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML/.test(app));
  });
});
