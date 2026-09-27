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
  const tone = ['FIX_VERIFIED', 'RESOLVED'].includes(state) ? 'good' : ['CONFIRMED', 'FIX_INCOMPLETE', 'REGRESSION_DETECTED'].includes(state) ? 'bad' : state === 'FLAKY' ? 'mixed' : '';
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
    cell.tabIndex = 0;
    cell.setAttribute('aria-label', label);
    cell.addEventListener('focus', () => { caption.textContent = label; });
    cell.addEventListener('blur', () => { caption.textContent = mini ? '' : summary; });
    cells.append(cell);
  });
  const caption = el('p', mini ? '' : summary, 'strip-caption');
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
  view.append(el('h1', 'Every result, backed by runs.'), el('p', 'See what reproduced, what changed, and whether the fix held.', 'intro'));
  const highlights = el('section', undefined, 'evidence');
  view.append(highlights);
  const heading = el('div', undefined, 'section-heading');
  heading.append(el('h2', 'Reports'));
  const controls = el('div', undefined, 'filters');
  const output = el('div');
  const status = el('p', '', 'summary');
  status.setAttribute('role', 'status');
  for (const [key, title, options] of [['repo', 'Repository', index.repos], ['platform', 'Platform', [...new Set(index.issues.map(i => i.platform))]]]) {
    const label = el('label', title);
    const select = el('select');
    const all = el('option', key === 'repo' ? 'All repositories' : 'All platforms'); all.value = ''; select.append(all);
    for (const value of options) { const option = el('option', platforms[value] || value); option.value = value; select.append(option); }
    select.value = filters[key];
    select.addEventListener('change', () => { filters[key] = select.value; renderRows(); });
    label.append(select); controls.append(label);
  }
  heading.append(controls); view.append(heading, output, status);
  const allRecords = await Promise.all(index.issues.map(async issue => { try { return await getRecord(issue); } catch { return null; } }));
  function renderRows() {
    const shown = index.issues.filter(i => (!filters.repo || filters.repo === i.repo) && (!filters.platform || filters.platform === i.platform));
    output.replaceChildren();
    if (!shown.length) output.append(el('p', index.issues.length ? 'No reports match these filters.' : 'No reports yet. Reports appear here after someone acknowledges them in Reprise IDE and publishes the record.', 'empty'));
    else {
      const scroll = el('div', undefined, 'table-scroll');
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
        row.append(el('td', `#${issue.issue}`), title, el('td', platforms[issue.platform] || issue.platform), el('td', runLocation(allRecords[index.issues.indexOf(issue)])), result, trials);
        body.append(row);
      }
      table.append(body); scroll.append(table); output.append(scroll);
    }
    status.textContent = `${shown.length} of ${index.issues.length} reports · ${new Set(shown.map(i => i.platform)).size} platforms · Overall median time to result: ${Math.round(index.totals.median_time_to_verdict_ms / 60000)} min`;
  }
  const latest = allRecords.filter(r => r?.fix?.iterations?.some(i => i.verification)).sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
  if (latest) {
    highlights.append(el('h2', 'Latest verified report'), link(`#${latest.issue} ${latest.title}`, routeFor(latest)), stripRow('Before', latest.replication.repro.sequence));
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
  timeline.append(events);
  view.append(reproduction, diagnosis, fix, verificationView(iteration), timeline);
}
function howItWorks(view) {
  document.title = 'How it works | Reprise';
  view.append(el('h1', 'From bug report to evidence.'), el('p', 'Reprise repeats a reported bug, helps propose a fix, and checks what changed.', 'intro'));
  const steps = el('ol', undefined, 'steps');
  for (const [title, text] of [['Acknowledge', 'Choose a report and confirm that Reprise should investigate it.'], ['Replicate', 'Run the reproduction test repeatedly on the affected platform. Each trial becomes one cell in the evidence strip.'], ['Help fix', 'Review the diagnosis and proposed change before applying it.'], ['Prove the fix', 'Repeat the test after the change and check the wider test suite for regressions.']]) {
    const item = el('li'); item.append(el('h2', title), el('p', text)); steps.append(item);
  }
  view.append(steps, el('p', 'Reprise IDE runs in Google Chrome and Microsoft Edge on desktop.'), link('Open Reprise IDE', 'ide/'));
}
async function render() {
  if (location.hash === '#content') { main.focus(); return; }
  const version = ++routeVersion;
  main.setAttribute('aria-busy', 'true');
  main.replaceChildren(el('p', 'Loading reports...', 'meta'));
  const view = el('div');
  try {
    const route = location.hash || '#/';
    if (route === '#/how-it-works') howItWorks(view);
    else if (route === '#/') await overview(view);
    else {
      const issue = index.issues.find(item => routeFor(item) === route);
      if (issue) await detail(view, issue);
      else { document.title = 'Report not found | Reprise'; view.append(el('h1', 'Report not found'), el('p', 'There is no report at this address.'), link('Go to all reports', '#/')); }
    }
  } catch { view.replaceChildren(el('h1', 'Reports unavailable'), el('p', "The report data didn't load. Reload the page. If a deploy is in progress, it finishes within a few minutes.")); }
  if (version !== routeVersion) return;
  main.replaceChildren(view); main.setAttribute('aria-busy', 'false');
}
try {
  const [data, schema] = await Promise.all([readJson('data/index.json'), readJson('data/dashboard-index.schema.json')]);
  validate(data, schema); index = data;
  document.querySelector('#sample').hidden = data.data_source !== 'sample';
  addEventListener('hashchange', render);
  await render();
} catch {
  main.replaceChildren(el('h1', 'Reports unavailable'), el('p', "The report data didn't load. Reload the page. If a deploy is in progress, it finishes within a few minutes."));
  main.setAttribute('aria-busy', 'false');
}
