import { readJson, validate, recordPath } from './data.js';

const main = document.querySelector('main');
const names = { LISTED: 'Not acknowledged', REPLICATING: 'Replicating', STOPPED: 'Stopped by user', CONFIRMED: 'Reproduced', FLAKY: 'Reproduced sometimes', DUPLICATE: 'Duplicate report', NEEDS_INFO: 'Needs one answer', BLOCKED_ENV: 'Test environment missing', ERROR: 'Reprise hit an error', FIXING: 'Fix in progress', FIX_ABANDONED: 'No fix proposed', VERIFYING: 'Checking fix', FIX_VERIFIED: 'Fix verified', FIX_INCOMPLETE: 'Still reproduces', REGRESSION_DETECTED: 'Fix breaks other tests', RESOLVED: 'Resolved' };
const platforms = { android: 'Android', ios: 'iOS', windows: 'Windows', linux: 'Linux', macos: 'macOS' };
const statusNames = { F: 'reproduced', P: 'passed', I: 'invalid' };
let index;
let routeVersion = 0;
const records = new Map();
const filters = { repo: '', platform: '' };

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function link(text, href, className) {
  const node = el('a', text, className);
  node.href = href;
  return node;
}
function routeFor(issue) { return `#/r/${issue.repo}/issues/${issue.issue}`; }
function verdict(state) {
  const tone = ['FIX_VERIFIED', 'RESOLVED'].includes(state) ? 'good'
    : ['CONFIRMED', 'FIX_INCOMPLETE', 'REGRESSION_DETECTED', 'ERROR'].includes(state) ? 'bad'
    : ['FLAKY', 'NEEDS_INFO', 'BLOCKED_ENV'].includes(state) ? 'mixed'
    : ['REPLICATING', 'FIXING', 'VERIFYING'].includes(state) ? 'info' : '';
  return el('span', names[state] || 'Unknown result', `verdict ${tone}`);
}
function strip(sequence, mini = false) {
  const wrapper = el('div', undefined, 'strip-wrap');
  if (!sequence) return el('span', 'No runs yet', 'meta');
  const runs = [...sequence];
  const failures = runs.flatMap((c, i) => c === 'F' ? [i + 1] : []);
  const summary = `Reproduced in ${failures.length} of ${runs.length} runs${failures.length ? `: runs ${failures.join(', ')}` : ''}`;
  const cells = el('div', undefined, `strip ${mini ? 'mini' : ''}`);
  cells.setAttribute('role', 'img');
  cells.setAttribute('aria-label', summary);
  const list = el('ol', undefined, 'sr-only');
  runs.forEach((c, i) => {
    const label = `Run ${i + 1}: ${statusNames[c] || 'invalid'}`;
    list.append(el('li', label));
    if (mini && i >= 20) return;
    const cell = el('span', undefined, `cell ${c === 'F' ? 'failed' : c === 'P' ? '' : 'invalid'}`);
    cell.title = label;
    if (!mini) cell.tabIndex = 0;
    cell.setAttribute('aria-label', label);
    cell.addEventListener('focus', () => { caption.textContent = label; });
    cell.addEventListener('blur', () => { caption.textContent = mini ? '' : summary; });
    cells.append(cell);
  });
  const miniCaption = `${runs.filter(c => c === 'F').length}/${runs.length} reproduced${runs.length > 20 ? ' · First 20 shown' : ''}`;
  const caption = el('p', mini ? miniCaption : summary, 'strip-caption');
  caption.setAttribute('aria-live', 'polite');
  wrapper.append(cells, list, caption);
  return wrapper;
}
function stripRow(label, sequence) {
  const row = el('div', undefined, 'strip-row');
  row.append(el('span', label), strip(sequence));
  return row;
}
function legend() {
  const node = el('div', undefined, 'legend');
  for (const [label, cls] of [['Reproduced', 'failed'], ['Passed', ''], ['Invalid', 'invalid']]) {
    const item = el('span');
    const cell = el('i', undefined, `cell ${cls}`);
    cell.setAttribute('aria-hidden', 'true');
    item.append(cell, document.createTextNode(label));
    node.append(item);
  }
  return node;
}
async function getRecord(issue) {
  const path = recordPath(issue);
  if (!records.has(path)) {
    const record = await readJson(path);
    if (record.schema !== 3 || record.repo !== issue.repo || record.issue !== issue.issue) throw new Error('Invalid report');
    records.set(path, record);
  }
  return records.get(path);
}
function section(title) {
  const node = el('section', undefined, 'detail-section');
  node.append(el('h2', title));
  return node;
}
function runLocation(record) {
  const context = record?.replication?.repro?.run_context;
  return context ? `${context.executor === 'ci' ? 'CI' : 'This machine'} · ${context.device || 'Device not recorded'}` : 'Not recorded';
}
function verificationView(iteration) {
  const node = section('Verification');
  const verification = iteration?.verification;
  if (!verification) { node.append(el('p', 'No verification results yet.')); return node; }
  node.append(verdict(verification.verdict), el('p', verification.repro?.claim || 'No claim recorded.'));
  // The contract provides counts, not an ordered verification sequence.
  const result = verification.repro;
  if (result) node.append(el('p', `${result.runs} runs · ${result.failed} reproduced · ${result.invalid} invalid`));
  const rows = Object.entries(verification.regression?.counts || {}).filter(([, count]) => count > 0);
  if (rows.length) {
    const table = el('table');
    table.append(el('caption', 'Regression results'));
    for (const [name, count] of rows) {
      const row = el('tr');
      const heading = el('th', name.toLowerCase().replaceAll('_', ' '));
      heading.scope = 'row';
      row.append(heading, el('td', count)); table.append(row);
    }
    node.append(table);
  }
  return node;
}
async function overview(view) {
  document.title = 'Reports | Reprise';
  const hero = el('header', undefined, 'overview-hero');
  const title = el('h1', 'Every result, ');
  title.append(el('span', 'backed by runs.'));
  hero.append(el('p', 'Reproduction lab / Overview', 'eyebrow'), title, el('p', 'See what reproduced, what changed, and whether the fix held.', 'intro'));
  view.append(hero);
  const metrics = el('dl', undefined, 'metrics');
  for (const [label, value] of [
    ['Published reports', index.issues.length],
    ['Fixes verified', index.totals.fixes_verified],
    ['Platforms covered', new Set(index.issues.map(issue => issue.platform)).size],
    ['Median time to result', `${Math.round(index.totals.median_time_to_verdict_ms / 60000)} min`],
  ]) {
    const metric = el('div', undefined, 'metric');
    metric.append(el('dt', label), el('dd', value ?? 'Not recorded'));
    metrics.append(metric);
  }
  view.append(metrics);
  const highlights = el('section', undefined, 'evidence');
  view.append(highlights);
  const heading = el('div', undefined, 'section-heading');
  heading.append(el('h2', 'Reports'));
  const controls = el('div', undefined, 'filters');
  const output = el('div');
  const status = el('p', '', 'summary');
  status.setAttribute('role', 'status');
  const selects = new Map();
  const reset = el('button', 'Clear filters');
  reset.type = 'button';
  function clearFilters() {
    for (const [key, select] of selects) { filters[key] = ''; select.value = ''; }
    renderRows();
  }
  reset.addEventListener('click', clearFilters);
  for (const [key, title, options] of [['repo', 'Repository', index.repos], ['platform', 'Platform', [...new Set(index.issues.map(i => i.platform))]]]) {
    const label = el('label', title);
    const select = el('select');
    const all = el('option', key === 'repo' ? 'All repositories' : 'All platforms'); all.value = ''; select.append(all);
    for (const value of options) { const option = el('option', platforms[value] || value); option.value = value; select.append(option); }
    select.value = filters[key];
    selects.set(key, select);
    select.addEventListener('change', () => { filters[key] = select.value; renderRows(); });
    label.append(select); controls.append(label);
  }
  controls.append(reset);
  heading.append(controls); view.append(heading, output, status);
  const allRecords = await Promise.all(index.issues.map(async issue => { try { return await getRecord(issue); } catch { return null; } }));
  function renderRows() {
    const shown = index.issues.filter(i => (!filters.repo || filters.repo === i.repo) && (!filters.platform || filters.platform === i.platform));
    reset.disabled = !filters.repo && !filters.platform;
    output.replaceChildren();
    if (!shown.length) {
      const empty = el('div', undefined, 'empty');
      empty.append(el('h3', index.issues.length ? 'No matching reports' : 'Your reports will appear here'), el('p', index.issues.length ? 'Try another repository or platform, or clear the filters above.' : 'Acknowledge a report in Reprise IDE and publish its record to see reproduction evidence here.'));
      if (!index.issues.length) empty.append(link('Open Reprise IDE', 'ide/', 'button primary'));
      output.append(empty);
    }
    else {
      const scroll = el('div', undefined, 'table-scroll');
      scroll.tabIndex = 0;
      scroll.setAttribute('role', 'region');
      scroll.setAttribute('aria-label', 'Reports. Scroll horizontally to view all columns.');
      const table = el('table');
      table.append(el('caption', 'Bug reports and reproduction results', 'sr-only'));
      const head = el('thead'); const header = el('tr');
      for (const text of ['Issue', 'Report', 'Platform', 'Run location', 'Result', 'Trials']) { const th = el('th', text); th.scope = 'col'; header.append(th); }
      head.append(header); table.append(head);
      const body = el('tbody');
      for (const issue of shown) {
        const row = el('tr'); const title = el('td');
        title.append(link(issue.title, routeFor(issue), 'report-title'), el('span', issue.repo, 'repo'));
        if (issue.stubbed) title.append(el('span', 'Stub response', 'badge'));
        const result = el('td'); result.append(verdict(issue.state));
        const trials = el('td'); trials.append(strip(issue.sequence, true));
        const record = allRecords[index.issues.indexOf(issue)];
        row.append(el('td', `#${issue.issue}`), title, el('td', platforms[issue.platform] || issue.platform), el('td', record ? runLocation(record) : 'Details unavailable'), result, trials);
        body.append(row);
      }
      table.append(body); scroll.append(table); output.append(scroll);
    }
    status.textContent = `${shown.length} of ${index.issues.length} reports · ${new Set(shown.map(i => i.platform)).size} platforms · Overall median time to result: ${Math.round(index.totals.median_time_to_verdict_ms / 60000)} min`;
  }
  const latest = allRecords.filter(r => r?.fix?.iterations?.some(i => i.verification)).sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
  if (latest) {
    highlights.append(el('h2', 'Latest verification evidence'), link(`#${latest.issue} ${latest.title}`, routeFor(latest)), stripRow('Before', latest.replication?.repro?.sequence));
    const result = latest.fix.iterations.at(-1)?.verification?.repro;
    if (result && result.failed === 0 && result.invalid === 0 && result.runs > 0 && result.runs <= 100) highlights.append(stripRow('After', 'P'.repeat(result.runs)));
    else highlights.append(el('p', 'See the report for verification counts.'));
    highlights.append(legend());
  } else highlights.append(el('h2', 'Reproduction evidence'), el('p', 'Before and after results will appear here when a fix has been checked.'), legend());
  renderRows();
}
async function detail(view, issue) {
  const record = await getRecord(issue);
  document.title = `#${issue.issue} ${issue.title} | Reprise`;
  view.append(link('Back to all reports', '#/', 'back'), el('h1', `#${issue.issue} ${issue.title}`), verdict(record.state));
  view.append(el('p', `${platforms[issue.platform] || issue.platform} · ${runLocation(record)} · ${Math.round((record.replication?.duration_ms || 0) / 60000)} min`, 'meta'));
  if (record.stubbed) view.append(el('span', 'Stub response', 'badge'));
  const reproduction = section('Reproduction');
  reproduction.append(strip(record.replication?.repro?.sequence || ''), legend());
  if (record.replication?.question) reproduction.append(el('p', record.replication.question));
  const diagnosis = section('Diagnosis');
  diagnosis.append(el('p', record.replication?.diagnosis?.summary || 'No diagnosis yet.'));
  if (record.replication?.diagnosis?.fix_direction) diagnosis.append(el('p', record.replication.diagnosis.fix_direction));
  const fix = section('Fix'); const iteration = record.fix?.iterations?.at(-1);
  fix.append(el('p', iteration?.summary || 'No fix proposed yet.'));
  if (iteration) fix.append(el('p', `Iteration ${iteration.n} · ${iteration.source === 'provider' ? 'Provider' : 'Developer'}`, 'meta'));
  if (iteration?.pr?.startsWith('https://github.com/')) fix.append(link('View pull request', iteration.pr));
  const timeline = section('Timeline'); const events = el('ol', undefined, 'timeline');
  for (const event of [...(record.events || [])].sort((a, b) => a.at.localeCompare(b.at))) events.append(el('li', `${new Date(event.at).toLocaleString()} · ${event.detail}`));
  timeline.append(events.children.length ? events : el('p', 'No activity recorded yet.'));
  view.append(reproduction, diagnosis, fix, verificationView(iteration), timeline);
}
function howItWorks(view) {
  document.title = 'How it works | Reprise';
  const hero = el('header', undefined, 'overview-hero guide-hero');
  const title = el('h1', 'From bug report ');
  title.append(el('span', 'to evidence.'));
  hero.append(el('p', 'The Reprise workflow', 'eyebrow'), title, el('p', 'Reprise repeats a reported bug, helps propose a fix, and checks what changed.', 'intro'));
  view.append(hero);
  const steps = el('ol', undefined, 'steps');
  steps.setAttribute('aria-label', 'Four steps from report to verified fix');
  const stages = [
    ['Acknowledge', 'Choose a report and confirm that Reprise should investigate it.', 'Start with a report', 'M8 3h8v4H8z M8 5H5v16h14V5h-3 M9 14l2 2 4-4'],
    ['Replicate', 'Run the reproduction test repeatedly on the affected platform. Each trial becomes one cell in the evidence strip.', 'Make the bug repeatable', 'M20 7v5h-5 M4 17v-5h5 M6 7a7 7 0 0 1 12-1l2 3 M4 15l2 3a7 7 0 0 0 12-1'],
    ['Help fix', 'Review the diagnosis and proposed change before applying it.', 'Keep the developer in control', 'm8 7-5 5 5 5 M16 7l5 5-5 5 M14 4l-4 16'],
    ['Prove the fix', 'Repeat the test after the change and check the wider test suite for regressions.', 'Back the result with evidence', 'm12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z M8 12l3 3 5-6'],
  ];
  for (const [title, text, outcome, path] of stages) {
    const item = el('li');
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('class', 'step-icon');
    icon.setAttribute('aria-hidden', 'true');
    const drawing = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    drawing.setAttribute('d', path);
    icon.append(drawing);
    item.append(icon, el('h2', title), el('p', text), el('span', outcome, 'step-outcome'));
    steps.append(item);
  }
  const evidence = el('section', undefined, 'guide-evidence');
  const explanation = el('div', undefined, 'guide-explanation');
  explanation.append(el('p', 'Read the evidence', 'eyebrow'), el('h2', 'A clearer picture, one run at a time.'), el('p', 'Each box represents a test run. Compare the reproduction results before and after a change, then review the regression checks in the report.'), link('Explore the reports', '#/', 'button'));
  const example = el('div', undefined, 'guide-example');
  example.append(el('h3', 'Before and after'), el('p', 'Illustrative example, not a live result.', 'meta'), stripRow('Before', 'PPFPPFPPFPPP'), stripRow('After', 'PPPPPPPPPPPP'), legend());
  evidence.append(explanation, example);
  const cta = el('section', undefined, 'guide-cta');
  const ctaText = el('div');
  ctaText.append(el('h2', 'Ready to investigate your next bug?'), el('p', 'Open Reprise IDE to choose a report and start the workflow.'), el('p', 'Available in Google Chrome and Microsoft Edge on desktop.', 'meta'));
  cta.append(ctaText, link('Open Reprise IDE ↗', 'ide/', 'button primary'));
  view.append(steps, evidence, cta);
}
function showError(view) {
  const feedback = el('section', undefined, 'feedback');
  feedback.setAttribute('role', 'alert');
  const retry = el('button', 'Try again', 'primary');
  retry.type = 'button';
  retry.addEventListener('click', () => { retry.disabled = true; retry.textContent = 'Reloading...'; location.reload(); });
  feedback.append(el('h1', 'Reports unavailable'), el('p', 'We could not load the report data. Check your connection and try again. If a deployment is in progress, wait a few minutes before retrying.'), retry, link('Back to reports', '#/', 'back'));
  view.replaceChildren(feedback);
}
async function render() {
  if (location.hash === '#content') { main.focus(); return; }
  const version = ++routeVersion;
  main.setAttribute('aria-busy', 'true');
  const loading = el('p', 'Loading reports...', 'loading');
  loading.setAttribute('role', 'status');
  main.replaceChildren(loading);
  const view = el('div');
  try {
    const route = location.hash || '#/';
    for (const item of document.querySelectorAll('nav a')) {
      const active = item.getAttribute('href') === (route.startsWith('#/r/') ? '#/' : route);
      if (active) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    }
    if (route === '#/how-it-works') howItWorks(view);
    else if (route === '#/') await overview(view);
    else {
      const issue = index.issues.find(item => routeFor(item) === route);
      if (issue) await detail(view, issue);
      else { document.title = 'Report not found | Reprise'; view.append(el('h1', 'Report not found'), el('p', 'There is no report at this address.'), link('Go to all reports', '#/')); }
    }
  } catch { showError(view); }
  if (version !== routeVersion) return;
  main.replaceChildren(view); main.setAttribute('aria-busy', 'false');
}
try {
  const [data, schema] = await Promise.all([readJson('data/index.json'), readJson('data/dashboard-index.schema.json')]);
  validate(data, schema); index = data;
  document.querySelector('#sample').hidden = data.data_source !== 'sample';
  addEventListener('hashchange', async () => { await render(); main.focus({ preventScroll: true }); });
  await render();
} catch {
  showError(main);
  main.setAttribute('aria-busy', 'false');
}
