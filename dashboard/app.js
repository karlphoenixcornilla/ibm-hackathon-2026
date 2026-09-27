// dashboard/app.js — Reprise dashboard (02-specs/dashboard.md)
// Vanilla ES module. Every string from data goes in through textContent; links
// are built only from https://github.com/ URLs. Hash routes:
//   #/  ·  #/r/<owner>/<repo>/issues/<N>  ·  #/how-it-works

import {
  DISPLAY,
  PLATFORM_NAMES,
  cellLabel,
  cellsFromSequence,
  displayState,
  formatDuration,
  formatPercent,
  recordPlatform,
  safeGithubUrl,
  stateTone,
  stripSummary,
  validateIndex,
  validateRecord,
  verificationSequence,
  whereRan,
} from './lib.mjs';

const main = document.getElementById('main');
const banner = document.getElementById('banner');
const filterRepo = document.getElementById('filter-repo');
const filterPlatform = document.getElementById('filter-platform');

/** @type {Promise<any> | null} */
let indexPromise = null;

// ── Input modality: keyboard-triggered actions are never animated ────────────
document.addEventListener('keydown', () => { document.documentElement.dataset.modality = 'keyboard'; }, true);
document.addEventListener('pointerdown', () => { document.documentElement.dataset.modality = 'pointer'; }, true);

// ── DOM helper (text only) ──────────────────────────────────────────────────

/**
 * @param {string} tag
 * @param {Record<string, string | number | boolean | null | undefined>} [attrs]
 * @param {...(Node | string | null | undefined | false)} children
 */
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

function link(url, text) {
  const safe = safeGithubUrl(url);
  return safe ? h('a', { href: safe, rel: 'noopener' }, text) : h('span', {}, text);
}

function render(title, ...nodes) {
  document.title = title ? `${title} · Reprise` : 'Reprise reports';
  main.replaceChildren(...nodes.filter(Boolean));
}

// ── Trial strip ─────────────────────────────────────────────────────────────

/**
 * @param {string} sequence  P/F/X/E per run
 * @param {{ variant: 'mini' | 'large'; animate?: boolean }} opts
 */
function trialStrip(sequence, { variant, animate = false }) {
  const all = cellsFromSequence(sequence);
  const cells = variant === 'mini' ? all.slice(0, 20) : all;
  const strip = h('div', {
    class: `strip ${variant}${animate ? ' enter' : ''}`,
    role: 'img',
    'aria-label': stripSummary(sequence),
  });
  cells.forEach((kind, i) => {
    if (variant === 'mini') {
      strip.append(h('span', { class: `cell ${kind}`, 'aria-hidden': 'true' }));
      return;
    }
    const cell = h('span', { class: `cell ${kind}`, tabindex: '0', 'aria-hidden': 'true' },
      h('span', { class: 'tooltip' }, cellLabel(kind, i)));
    cell.style.setProperty('--i', String(i));
    strip.append(cell);
  });
  if (variant === 'large' && all.length) {
    const list = h('ol', { class: 'visually-hidden' });
    all.forEach((kind, i) => list.append(h('li', {}, cellLabel(kind, i))));
    return h('div', {}, strip, list);
  }
  return strip;
}

function stateText(state, duplicateOf) {
  const tone = stateTone(state);
  return h('span', { class: tone ? `state-${tone}` : null }, displayState(state, duplicateOf));
}

function stubTag(stubbed) {
  return stubbed ? h('span', { class: 'stub-tag' }, 'Stub response') : null;
}

// ── Data ────────────────────────────────────────────────────────────────────

async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
  return res.json();
}

function loadIndex() {
  indexPromise ??= fetchJson('data/index.json').then((index) => {
    const errors = validateIndex(index);
    if (errors.length) throw new Error(`Invalid index: ${errors.slice(0, 5).join(', ')}`);
    banner.hidden = index.data_source !== 'sample';
    fillFilters(index);
    return index;
  });
  return indexPromise;
}

function fillFilters(index) {
  if (filterRepo.options.length > 1) return;
  for (const repo of index.repos) filterRepo.append(h('option', { value: repo }, repo));
  const platforms = [...new Set(index.issues.map((i) => i.platform))].sort();
  for (const p of platforms) filterPlatform.append(h('option', { value: p }, PLATFORM_NAMES[p] ?? p));
  const params = new URLSearchParams(location.hash.split('?')[1] ?? '');
  filterRepo.value = params.get('repo') ?? '';
  filterPlatform.value = params.get('platform') ?? '';
}

function onFilterChange() {
  const params = new URLSearchParams();
  if (filterRepo.value) params.set('repo', filterRepo.value);
  if (filterPlatform.value) params.set('platform', filterPlatform.value);
  const q = params.toString();
  location.hash = `#/${q ? `?${q}` : ''}`;
}
filterRepo.addEventListener('change', onFilterChange);
filterPlatform.addEventListener('change', onFilterChange);

// ── Views ───────────────────────────────────────────────────────────────────

function issueHref(it) {
  return `#/r/${it.repo}/issues/${it.issue}`;
}

async function overview() {
  const index = await loadIndex();
  const issues = index.issues.filter((i) =>
    (!filterRepo.value || i.repo === filterRepo.value) && (!filterPlatform.value || i.platform === filterPlatform.value));

  if (index.issues.length === 0) {
    render('', h('p', { class: 'empty-state' },
      'No reports yet. Reports appear here after someone acknowledges them in Reprise IDE and publishes the record.'));
    return;
  }

  // Latest before/after pair: the most recent report with a verification run.
  let latest = null;
  for (const it of index.issues) {
    if (it.state === 'FIX_VERIFIED' || it.state === 'RESOLVED' || it.state === 'REGRESSION_DETECTED' || it.state === 'FIX_INCOMPLETE') {
      latest = it;
      break;
    }
  }
  latest ??= index.issues.find((i) => i.sequence) ?? null;

  let hero = null;
  if (latest) {
    hero = h('section', { 'aria-labelledby': 'latest-h' },
      h('h2', { id: 'latest-h' }, 'Latest: ', h('a', { href: issueHref(latest) }, `#${latest.issue} ${latest.title}`)),
      row('Before', latest.sequence));
    try {
      const rec = await fetchJson(`data/${latest.repo}/issues/${latest.issue}.json`);
      const after = verificationSequence(rec.fix?.iterations?.at(-1));
      if (after) hero.append(row('After', after));
    } catch { /* the before strip still stands */ }
  }

  const table = h('table', {},
    h('caption', { class: 'visually-hidden' }, 'Bug reports and what Reprise proved about each'),
    h('thead', {}, h('tr', {},
      h('th', { scope: 'col' }, '#'),
      h('th', { scope: 'col' }, 'Title'),
      h('th', { scope: 'col', class: 'col-platform' }, 'Platform'),
      h('th', { scope: 'col' }, 'Result'),
      h('th', { scope: 'col', class: 'col-trials' }, 'Trials'))),
    h('tbody', {}, ...issues.map((it) => h('tr', {},
      h('td', { class: 'num' }, String(it.issue)),
      h('td', {}, h('a', { href: issueHref(it) }, it.title), index.repos.length > 1 ? h('span', { class: 'meta' }, ` ${it.repo}`) : null),
      h('td', { class: 'col-platform' }, PLATFORM_NAMES[it.platform] ?? it.platform),
      h('td', {}, stateText(it.state), stubTag(it.stubbed)),
      h('td', { class: 'col-trials' }, it.sequence ? trialStrip(it.sequence, { variant: 'mini' }) : '-')))));

  const t = index.totals;
  const platforms = Object.keys(t.by_platform).length;
  const totals = h('p', { class: 'totals' },
    `${t.issues} report${t.issues === 1 ? '' : 's'} · ${platforms} platform${platforms === 1 ? '' : 's'}` +
    (t.median_time_to_verdict_ms ? ` · median time to result ${formatDuration(t.median_time_to_verdict_ms)}` : '') +
    ` · ${t.fixes_verified} fix${t.fixes_verified === 1 ? '' : 'es'} verified · ${t.regressions_caught} regression${t.regressions_caught === 1 ? '' : 's'} caught`);

  render('', hero, h('h2', {}, 'Reports'), issues.length ? table : h('p', {}, 'No reports match these filters.'), totals);
}

function row(label, sequence) {
  const cells = cellsFromSequence(sequence);
  const fails = cells.filter((c) => c === 'fail').length;
  const valid = cells.filter((c) => c !== 'invalid').length;
  return h('div', { class: 'strip-row' },
    h('span', {}, label),
    trialStrip(sequence, { variant: 'mini' }),
    h('span', { class: 'count' }, `${fails} of ${valid}`));
}

async function detail(owner, repo, n) {
  const index = await loadIndex();
  const full = `${owner}/${repo}`;
  if (!index.issues.some((i) => i.repo === full && i.issue === n)) {
    render(`No report #${n}`, h('p', { class: 'empty-state' }, `There is no report #${n}. `, h('a', { href: '#/' }, 'Go to all reports.')));
    return;
  }
  const r = await fetchJson(`data/${full}/issues/${n}.json`);
  const errors = validateRecord(r);
  if (errors.length) throw new Error(`Invalid record: ${errors.slice(0, 5).join(', ')}`);

  const rep = r.replication;
  const repro = rep.repro;
  const last = r.fix.iterations.at(-1);
  const provider = r.stubbed ? 'stub responses' : `AI: ${r.provider}`;

  const head = h('div', { class: 'detail-head' },
    h('h1', {}, `#${r.issue} ${r.title}`),
    h('span', { class: 'verdict' }, stateText(r.state, rep.duplicate?.of)));
  const meta = h('p', { class: 'meta' },
    [whereRan(repro.run_context) || PLATFORM_NAMES[recordPlatform(r)], rep.duration_ms ? `result in ${formatDuration(rep.duration_ms)}` : '', provider]
      .filter(Boolean).join(', '),
    ' · ', link(r.url, 'Issue on GitHub'));

  const reproduction = h('section', { 'aria-labelledby': 'repro-h' },
    h('h2', { id: 'repro-h' }, 'Reproduction'),
    repro.sequence ? trialStrip(repro.sequence, { variant: 'large', animate: true }) : h('p', {}, 'No runs yet.'),
    repro.trials
      ? h('p', {}, `${repro.failed} of ${repro.trials - repro.invalid} runs reproduced the bug (${formatPercent(repro.wilson_low)}–${formatPercent(repro.wilson_high)}, 95% interval).`)
      : null,
    h('dl', {},
      h('dt', {}, 'Signature'), h('dd', {}, h('code', {}, `${repro.signature?.kind ?? ''} /${repro.signature?.pattern ?? ''}/`)),
      h('dt', {}, 'Test'), h('dd', {}, h('code', {}, repro.test_file || '-'), repro.test_origin === 'provided' ? stubTag(r.stubbed) : null,
        repro.test_origin === 'user' ? ' (written by a person)' : ''),
      h('dt', {}, 'Attempts'), h('dd', {}, String(repro.attempts ?? 0))),
    rep.question ? h('p', {}, h('strong', {}, 'Question for the reporter: '), rep.question) : null,
    rep.duplicate?.of ? h('p', {}, `Same defect as #${rep.duplicate.of}. ${rep.duplicate.reason ?? ''}`) : null);

  const d = rep.diagnosis;
  const diagnosis = d?.summary ? h('section', { 'aria-labelledby': 'diag-h' },
    h('h2', { id: 'diag-h' }, 'Diagnosis', stubTag(r.stubbed)),
    h('p', {}, d.summary),
    d.locations?.length ? h('ul', {}, ...d.locations.map((l) =>
      h('li', {}, h('code', {}, `${l.file}:${l.start_line}–${l.end_line}`), ` ${l.reason}`))) : null,
    h('p', {}, h('strong', {}, 'Fix direction: '), d.fix_direction, ` (confidence ${d.confidence}${d.accepted_by ? ', accepted' : ''})`)) : null;

  const fix = last ? h('section', { 'aria-labelledby': 'fix-h' },
    h('h2', { id: 'fix-h' }, 'Fix', last.source === 'provider' ? stubTag(r.stubbed) : null),
    h('p', {}, last.summary || '-'),
    h('dl', {},
      h('dt', {}, 'Pull request'), h('dd', {}, last.pr ? link(last.pr, last.pr.replace('https://github.com/', '')) : 'Not opened'),
      h('dt', {}, 'Source'), h('dd', {}, last.source === 'human' ? 'A person' : `Provider (${r.provider})`),
      h('dt', {}, 'Iterations'), h('dd', {}, String(r.fix.iterations.length)),
      h('dt', {}, 'Candidates'), h('dd', {}, last.candidates.map((c) => `#${c.k} ${c.status.replace('_', ' ')}`).join(', ') || '-'))) : null;

  const v = last?.verification;
  const verification = v?.finished_at ? h('section', { 'aria-labelledby': 'verify-h' },
    h('h2', { id: 'verify-h' }, 'Verification'),
    trialStrip(verificationSequence(last), { variant: 'large' }),
    h('p', {}, stateText(v.verdict), v.repro.claim ? `: ${v.repro.claim}` : ''),
    regressionTable(v.regression),
    v.run_context?.ci_run_url ? h('p', {}, link(v.run_context.ci_run_url, 'CI run')) : null) : null;

  const timeline = h('section', { 'aria-labelledby': 'time-h' },
    h('h2', { id: 'time-h' }, 'Timeline'),
    h('ol', { class: 'timeline' }, ...r.events.map((e) =>
      h('li', {}, h('time', { datetime: e.at }, new Date(e.at).toLocaleString()), e.type.replace(/[._]/g, ' '), e.detail ? ` — ${DISPLAY[e.detail] ? displayState(e.detail) : e.detail}` : ''))));

  render(`#${r.issue} ${r.title}`, head, meta, reproduction, diagnosis, fix, verification, timeline);
}

function regressionTable(reg) {
  const rows = Object.entries(reg?.counts ?? {}).filter(([, n]) => n > 0);
  if (!rows.length) return null;
  return h('table', {},
    h('caption', { class: 'visually-hidden' }, 'Regression comparison, base against fix'),
    h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Tests'), h('th', { scope: 'col' }, 'Count'))),
    h('tbody', {}, ...rows.map(([cls, n]) => h('tr', {}, h('td', {}, cls.replace(/_/g, ' ').toLowerCase()), h('td', { class: 'num' }, String(n))))));
}

function howItWorks() {
  const steps = [
    ['Acknowledge the report', 'A maintainer opens the repository in Reprise IDE and acknowledges a bug report. IBM Bob reads the report and the code and describes the bug as structured data, or asks the reporter one question.'],
    ['Replicate it on its platform', 'Bob proposes one test that should fail because of the bug. After the maintainer approves it, Reprise runs it many times on the right platform — on this machine through the Reprise Runner, or on CI — and reports how often it reproduced.'],
    ['Help fix it', 'Bob diagnoses the cause and proposes fix candidates. Each candidate is quick-checked against the reproduction test; the best survivor becomes a draft pull request.'],
    ['Prove the fix', 'Reprise runs the reproduction test enough times to support a claim, and compares the whole test suite before and after, so a fix that breaks something else is caught.'],
  ];
  render('How it works',
    h('h1', {}, 'How it works'),
    h('ol', {}, ...steps.map(([t, body]) => h('li', {}, h('h2', {}, t), h('p', {}, body)))),
    h('img', { class: 'lifecycle', src: 'lifecycle.svg', alt: 'Issue lifecycle: listed, replicating, then reproduced, reproduced sometimes, duplicate, needs one answer or test environment missing; from reproduced to fix in progress, checking fix, and fix verified, still reproduces or fix breaks other tests.', width: '960', height: '300' }),
    h('p', {}, h('a', { href: 'ide/' }, 'Open Reprise IDE'), '. Reprise IDE runs in Google Chrome and Microsoft Edge on desktop.'),
    h('p', {}, link('https://github.com/karlphoenixcornilla/ibm-hackathon-2026/releases', 'Download the Reprise Runner'), ' · ',
      link('https://github.com/karlphoenixcornilla/ibm-hackathon-2026/blob/main/BUILDING.md', 'Build from source')));
}

// ── Router ──────────────────────────────────────────────────────────────────

async function route() {
  const path = location.hash.replace(/^#/, '').split('?')[0] || '/';
  try {
    const m = path.match(/^\/r\/([^/]+)\/([^/]+)\/issues\/(\d+)$/);
    if (m) await detail(decodeURIComponent(m[1]), decodeURIComponent(m[2]), Number(m[3]));
    else if (path === '/how-it-works') howItWorks();
    else await overview();
  } catch (err) {
    console.error(err);
    render('Data did not load', h('p', { class: 'error-state' },
      "The report data didn't load. Reload the page. If a deploy is in progress, it finishes within a few minutes."));
  }
  if (document.documentElement.dataset.modality === 'keyboard') main.focus({ preventScroll: true });
}

window.addEventListener('hashchange', route);
route();
