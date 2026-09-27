// dashboard/lib.mjs — shared by the browser app (app.js), the site build
// (build.mjs) and the tests. No DOM, no Node APIs.
// Spec: 02-specs/dashboard.md, 02-specs/data-contracts.md

/** State or verdict → the words users read (dashboard.md §Display names). */
export const DISPLAY = {
  LISTED: 'Not acknowledged',
  REPLICATING: 'Replicating',
  STOPPED: 'Stopped by user',
  CONFIRMED: 'Reproduced',
  FLAKY: 'Reproduced sometimes',
  DUPLICATE: 'Duplicate of #M',
  NEEDS_INFO: 'Needs one answer',
  BLOCKED_ENV: 'Test environment missing',
  ERROR: 'Reprise hit an error',
  FIXING: 'Fix in progress',
  FIX_ABANDONED: 'No fix proposed',
  VERIFYING: 'Checking fix',
  FIX_VERIFIED: 'Fix verified',
  FIX_INCOMPLETE: 'Still reproduces',
  REGRESSION_DETECTED: 'Fix breaks other tests',
  RESOLVED: 'Resolved',
};

export const PLATFORM_NAMES = {
  windows: 'Windows',
  android: 'Android',
  ios: 'iOS',
  macos: 'macOS',
  linux: 'Linux',
  unknown: 'Unknown platform',
};

/** @param {string} state @param {number | null} [duplicateOf] */
export function displayState(state, duplicateOf = null) {
  if (state === 'DUPLICATE') return duplicateOf ? `Duplicate of #${duplicateOf}` : 'Duplicate';
  return DISPLAY[state] ?? state;
}

/** Colour family for a state: only the three evidence colours are used. */
export function stateTone(state) {
  if (['CONFIRMED', 'FIX_INCOMPLETE', 'REGRESSION_DETECTED'].includes(state)) return 'reproduced';
  if (['FIX_VERIFIED', 'RESOLVED'].includes(state)) return 'clean';
  if (state === 'FLAKY') return 'intermittent';
  return '';
}

/** Trial outcomes from a sequence string: P pass, F reproduced, X/E invalid. */
export function cellsFromSequence(sequence) {
  return [...(sequence ?? '')].map((ch) => (ch === 'F' ? 'fail' : ch === 'P' ? 'pass' : 'invalid'));
}

export function cellLabel(kind, i) {
  const word = kind === 'fail' ? 'reproduced' : kind === 'pass' ? 'passed' : 'invalid';
  return `Run ${i + 1}: ${word}`;
}

/** aria-label for a strip: "Reproduced in 4 of 20 runs: runs 1, 4, 9, 15". */
export function stripSummary(sequence) {
  const cells = cellsFromSequence(sequence);
  const fails = cells.flatMap((c, i) => (c === 'fail' ? [i + 1] : []));
  const invalid = cells.filter((c) => c === 'invalid').length;
  const valid = cells.length - invalid;
  if (cells.length === 0) return 'No runs yet';
  const base = fails.length
    ? `Reproduced in ${fails.length} of ${valid} runs: run${fails.length > 1 ? 's' : ''} ${fails.join(', ')}`
    : `Did not reproduce in ${valid} runs`;
  return invalid ? `${base}; ${invalid} invalid` : base;
}

export function formatPercent(x) {
  if (!Number.isFinite(x)) return '';
  const p = x * 100;
  return `${p < 10 && p !== 0 ? p.toFixed(1) : Math.round(p)}%`;
}

export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const min = Math.round(ms / 60000);
  if (min < 1) return `${Math.max(1, Math.round(ms / 1000))} s`;
  if (min < 90) return `${min} min`;
  return `${(min / 60).toFixed(1)} h`;
}

/** Only links to github.com are ever rendered (dashboard.md §Data loading). */
export function safeGithubUrl(url) {
  return typeof url === 'string' && url.startsWith('https://github.com/') ? url : null;
}

/** Where the runs happened, in words. */
export function whereRan(runContext) {
  if (!runContext) return '';
  const place = runContext.executor === 'ci' ? 'CI' : 'this machine';
  const device = runContext.device ? `${runContext.device}, ` : '';
  const platform = PLATFORM_NAMES[runContext.platform] ?? runContext.platform ?? '';
  return `${platform}, ${device}${place}`;
}

export function recordPlatform(record) {
  return record?.replication?.repro?.run_context?.platform
    || record?.replication?.fingerprint?.platform
    || 'unknown';
}

// ── Validation (schemas in extensions/reprise/src/contracts/schemas) ────────

const isStr = (v) => typeof v === 'string';
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isInt = (v) => Number.isInteger(v);
const isBool = (v) => typeof v === 'boolean';
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** dashboard-index.schema.json → list of problems (empty when valid). */
export function validateIndex(index) {
  const errors = [];
  if (!isObj(index)) return ['index is not an object'];
  if (!isStr(index.generated_at)) errors.push('generated_at');
  if (!['live', 'sample'].includes(index.data_source)) errors.push('data_source');
  if (!Array.isArray(index.repos) || !index.repos.every(isStr)) errors.push('repos');
  const t = index.totals;
  if (!isObj(t)) errors.push('totals');
  else {
    for (const k of ['issues', 'fixes_verified', 'regressions_caught']) if (!isInt(t[k])) errors.push(`totals.${k}`);
    if (!isNum(t.median_time_to_verdict_ms)) errors.push('totals.median_time_to_verdict_ms');
    if (!isObj(t.by_state)) errors.push('totals.by_state');
    if (!isObj(t.by_platform)) errors.push('totals.by_platform');
  }
  if (!Array.isArray(index.issues)) errors.push('issues');
  else {
    index.issues.forEach((it, i) => {
      if (!isObj(it)) { errors.push(`issues[${i}]`); return; }
      for (const k of ['repo', 'title', 'platform', 'state', 'verdict', 'sequence', 'updated_at']) if (!isStr(it[k])) errors.push(`issues[${i}].${k}`);
      if (!isInt(it.issue)) errors.push(`issues[${i}].issue`);
      if (!isNum(it.rate)) errors.push(`issues[${i}].rate`);
      if (!isBool(it.stubbed)) errors.push(`issues[${i}].stubbed`);
      if (!(it.pr === null || it.pr === undefined || isStr(it.pr))) errors.push(`issues[${i}].pr`);
    });
  }
  return errors;
}

/** The fields the dashboard reads from an issue record (schema 3). */
export function validateRecord(r) {
  const errors = [];
  if (!isObj(r)) return ['record is not an object'];
  if (r.schema !== 3) errors.push('schema must be 3');
  for (const k of ['repo', 'title', 'url', 'state', 'provider', 'created_at', 'updated_at']) if (!isStr(r[k])) errors.push(k);
  if (!isInt(r.issue)) errors.push('issue');
  if (!isBool(r.stubbed)) errors.push('stubbed');
  if (!isObj(r.replication)) errors.push('replication');
  else {
    const rep = r.replication;
    if (!isObj(rep.repro)) errors.push('replication.repro');
    else {
      for (const k of ['trials', 'failed', 'invalid']) if (!isInt(rep.repro[k])) errors.push(`replication.repro.${k}`);
      if (!isStr(rep.repro.sequence)) errors.push('replication.repro.sequence');
    }
    if (!isObj(rep.fingerprint)) errors.push('replication.fingerprint');
    if (!isObj(rep.diagnosis)) errors.push('replication.diagnosis');
  }
  if (!isObj(r.fix) || !Array.isArray(r.fix.iterations)) errors.push('fix.iterations');
  if (!Array.isArray(r.events)) errors.push('events');
  return errors;
}

function median(xs) {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Aggregate records into the dashboard index (data-contracts.md §Dashboard index).
 * @param {object[]} records  valid issue records
 * @param {{ dataSource: 'live' | 'sample'; repos: string[]; now?: string }} opts
 */
export function buildIndex(records, { dataSource, repos, now = new Date().toISOString() }) {
  const by_state = {};
  const by_platform = {};
  const durations = [];
  let fixes_verified = 0;
  let regressions_caught = 0;

  const issues = records
    .map((r) => {
      const platform = recordPlatform(r);
      by_state[r.state] = (by_state[r.state] ?? 0) + 1;
      by_platform[platform] = (by_platform[platform] ?? 0) + 1;
      if (r.replication.verdict && r.replication.duration_ms > 0) durations.push(r.replication.duration_ms);
      const iterations = r.fix?.iterations ?? [];
      if (iterations.some((it) => it.verification?.verdict === 'FIX_VERIFIED')) fixes_verified++;
      regressions_caught += iterations.filter((it) => it.verification?.verdict === 'REGRESSION_DETECTED').length;
      const lastPr = [...iterations].reverse().find((it) => safeGithubUrl(it.pr))?.pr ?? null;
      return {
        repo: r.repo,
        issue: r.issue,
        title: r.title,
        platform,
        state: r.state,
        verdict: r.replication.verdict ?? '',
        rate: Number(r.replication.repro.rate) || 0,
        sequence: r.replication.repro.sequence ?? '',
        stubbed: r.stubbed,
        updated_at: r.updated_at,
        pr: lastPr,
      };
    })
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0));

  return {
    generated_at: now,
    data_source: dataSource,
    repos,
    totals: {
      issues: issues.length,
      by_state,
      by_platform,
      median_time_to_verdict_ms: median(durations),
      fixes_verified,
      regressions_caught,
    },
    issues,
  };
}

/** The verification strip for a record's latest iteration: runs, with failures first-class. */
export function verificationSequence(iteration) {
  const v = iteration?.verification?.repro;
  if (!v || !v.runs) return '';
  const fails = Math.min(v.failed ?? 0, v.runs);
  const invalid = Math.min(v.invalid ?? 0, v.runs - fails);
  return 'F'.repeat(fails) + 'X'.repeat(invalid) + 'P'.repeat(v.runs - fails - invalid);
}
