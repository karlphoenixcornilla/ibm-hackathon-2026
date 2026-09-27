import { readJson, validate, recordPath, createDataSource } from './data.js';

const dataSource = createDataSource(globalThis.repriseDashboard);

const main = document.querySelector('main');
const names = {
  LISTED: 'Not acknowledged',
  REPLICATING: 'Replicating',
  STOPPED: 'Stopped by user',
  CONFIRMED: 'Reproduced',
  FLAKY: 'Reproduced sometimes',
  DUPLICATE: 'Duplicate report',
  NEEDS_INFO: 'Needs one answer',
  BLOCKED_ENV: 'Test environment missing',
  ERROR: 'Reprise hit an error',
  FIXING: 'Fix in progress',
  FIX_ABANDONED: 'No fix proposed',
  VERIFYING: 'Checking fix',
  FIX_VERIFIED: 'Fix verified',
  FIX_INCOMPLETE: 'Still reproduces',
  REGRESSION_DETECTED: 'Fix breaks other tests',
  RESOLVED: 'Resolved'
};
const platforms = {
  android: 'Android',
  ios: 'iOS',
  windows: 'Windows',
  linux: 'Linux',
  macos: 'macOS'
};
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

function routeFor(issue) {
  return `#/r/${issue.repo}/issues/${issue.issue}`;
}

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
  runs.forEach((status, i) => {
    const title = `Run ${i + 1}: ${statusNames[status] || 'unknown'}`;
    const cell = el('span', undefined, `cell ${status}`);
    cell.title = title;
    cell.setAttribute('aria-hidden', 'true');
    cells.append(cell);
    list.append(el('li', title));
  });
  wrapper.append(cells, list);
  return wrapper;
}

function stripRow(label, sequence) {
  const row = el('div', undefined, 'strip-row');
  row.append(el('span', label, 'strip-label'), strip(sequence));
  return row;
}

function legend() {
  const container = el('div', undefined, 'legend');
  container.append(
    legendItem('F', 'Reproduced'),
    legendItem('P', 'Passed'),
    legendItem('I', 'Invalid')
  );
  return container;
}

function legendItem(kind, text) {
  const item = el('span', undefined, 'legend-item');
  item.append(el('span', undefined, `cell ${kind}`), el('span', text));
  return item;
}

function section(title) {
  const node = el('section', undefined, 'detail-section');
  node.append(el('h2', title));
  return node;
}

function runLocation(record) {
  const run = record.replication?.runs?.[0];
  if (!run) return 'Unrecorded';
  const where = run.where === 'local' ? 'This machine' : 'CI';
  return run.device ? `${where} · ${run.device}` : where;
}

function verificationView(iteration) {
  const node = section('Verification');
  const verification = iteration?.verification;
  if (!verification) {
    node.append(el('p', 'No verification recorded yet.'));
    return node;
  }
  const summary = el('p', undefined, 'meta');
  summary.append(
    verdict(verification.status),
    document.createTextNode(` · ${verification.runs_planned} runs planned · provider calls: ${iteration.provider_calls ?? 0}`)
  );
  node.append(summary);
  if (verification.pre_change_sequence && verification.post_change_sequence) {
    node.append(
      stripRow('Before fix', verification.pre_change_sequence),
      stripRow('After fix', verification.post_change_sequence)
    );
  } else {
    node.append(
      el('p', `Before fix: ${verification.pre_change_failures ?? 0} failures in ${verification.runs_planned} runs`),
      el('p', `After fix: ${verification.post_change_failures ?? 0} failures in ${verification.runs_planned} runs`)
    );
  }
  node.append(legend());
  if (verification.regressions_checked) {
    const regressions = el('div', undefined, 'meta');
    regressions.append(
      el('p', `${verification.regressions_passed ?? 0} existing tests passed`),
      verification.regression_failures?.length
        ? el('p', `Regressions: ${verification.regression_failures.join(', ')}`)
        : el('p', 'No regressions detected.')
    );
    node.append(regressions);
  }
  if (verification.ci_run_url?.startsWith('https://github.com/')) {
    node.append(link('View CI run ↗', verification.ci_run_url));
  }
  return node;
}

async function getRecord(issue) {
  const key = routeFor(issue);
  if (records.has(key)) return records.get(key);
  const data = await readJson(recordPath(issue.repo, issue.issue));
  const schema = await readJson('data/issue-record.schema.json');
  validate(data, schema);
  records.set(key, data);
  return data;
}

function landing(view) {
  document.title = 'Reprise | Reproduce the bug. Prove the fix.';
  const hero = el('header', undefined, 'overview-hero landing-hero');
  const copy = el('div', undefined, 'landing-copy');
  const headline = el('h1', 'Reproduce the bug.');
  headline.append(el('span', 'Prove the fix.'));
  const actions = el('div', undefined, 'hero-cta-group');
  actions.append(link('Open IDE', 'ide/', 'button primary ide-launch'));
  copy.append(
    el('p', 'For mobile and desktop developers', 'eyebrow'),
    headline,
    el('p', 'A bug replication and fix pipeline for mobile and desktop apps. Repeat flaky bugs, review a proposed fix, and check it against repeated runs.', 'intro'),
    actions
  );

  const visual = el('figure', undefined, 'hero-visual');
  const latest = index.issues.find(issue => issue.sequence);
  visual.append(el('figcaption', 'Reproduction evidence', 'hero-visual-title'));
  if (latest) {
    visual.append(link(latest.title, routeFor(latest)), strip(latest.sequence), legend());
  } else {
    visual.append(
      el('p', 'No runs published yet.'),
      el('p', 'Reproduction results will appear here when reports are published.', 'meta')
    );
  }
  hero.append(copy, visual);
  view.append(hero);

  const trust = el('ul', undefined, 'trust-strip');
  trust.setAttribute('aria-label', 'Platforms and project details');
  for (const text of [
    'Mobile + desktop workflows',
    'IDE: Chrome & Edge on desktop',
    'MIT-licensed extension + runner'
  ]) trust.append(el('li', text, 'trust-item'));
  view.append(trust);

  const workflow = el('section', undefined, 'landing-workflow');
  workflow.setAttribute('aria-labelledby', 'workflow-heading');
  const workflowHeading = el('h2', 'From a bug report to evidence.');
  workflowHeading.id = 'workflow-heading';
  workflow.append(el('p', 'How it works', 'eyebrow'), workflowHeading);
  const steps = el('ol', undefined, 'steps landing-steps');
  for (const [title, text] of [
    ['Choose a bug', 'Start with a GitHub issue and the affected mobile or desktop app.'],
    ['Make it repeat', 'Run the reproduction test repeatedly to see when the bug appears.'],
    ['Check the fix', 'Review the proposed change, repeat the test, and inspect regression checks.']
  ]) {
    const item = el('li');
    item.append(el('h3', title), el('p', text));
    steps.append(item);
  }
  workflow.append(steps, link('Read the full workflow', '#/how-it-works'));
  view.append(workflow);

  const evidence = el('section', undefined, 'landing-evidence');
  evidence.setAttribute('aria-labelledby', 'evidence-heading');
  const evidenceHeading = el('h2', 'See what the runs show.');
  evidenceHeading.id = 'evidence-heading';
  evidence.append(
    el('p', 'Read the evidence', 'eyebrow'),
    evidenceHeading,
    el('p', 'Compare before-and-after results, review the diagnosis, and check for regressions. Passing trials are evidence, not a guarantee that a bug can never recur.', 'intro'),
    el('p', index.issues.length ? 'Totals from the published reports.' : 'No reports published yet.', 'meta')
  );
  const metrics = el('dl', undefined, 'metrics');
  metrics.setAttribute('aria-label', 'Published report totals');
  for (const [label, value] of [
    ['Published reports', index.issues.length],
    ['Fixes verified', index.totals.fixes_verified],
    ['Platforms in reports', Object.keys(index.totals.by_platform).length],
    ['Median time to result', index.issues.length ? `${Math.round(index.totals.median_time_to_verdict_ms / 60000)} min` : 'No runs yet']
  ]) {
    const metric = el('div', undefined, 'metric');
    metric.append(el('dt', label), el('dd', String(value)));
    metrics.append(metric);
  }
  evidence.append(metrics);
  view.append(evidence);

  const banner = el('section', undefined, 'landing-cta-banner');
  const bannerText = el('div');
  bannerText.append(
    el('h2', 'Investigate your next bug.'),
    el('p', 'Open the IDE to start your reproduction and verification workflow.')
  );
  banner.append(bannerText, link('Open IDE', 'ide/', 'button primary ide-launch'));
  const reportLink = el('p', undefined, 'landing-reports');
  reportLink.append(link(index.issues.length ? 'Browse all reports' : 'View the reports dashboard', '#/reports'));
  view.append(banner, reportLink);
}

// ---------------------------------------------------------------------------
// Dynamic Reports Dashboard View (#/reports)
// ---------------------------------------------------------------------------
async function reports(view) {
  document.title = 'Bug Reports | Reprise';

  const hero = el('header', undefined, 'overview-hero');
  const title = el('h1', 'Verified Bug Reports');
  hero.append(
    el('p', 'Dynamic Evidence Directory', 'eyebrow'),
    title,
    el('p', 'Interactive log of replicated bugs, trial evidence strips, and fix outcomes.', 'intro')
  );
  view.append(hero);

  const repos = ['All repositories', ...new Set(index.issues.map(i => i.repo))];
  const platformList = ['All platforms', ...new Set(index.issues.map(i => platforms[i.platform] || i.platform))];

  const controls = el('div', undefined, 'filters');
  const repoSelect = el('select');
  repoSelect.setAttribute('aria-label', 'Filter reports by repository');
  repos.forEach((repo, i) => {
    const opt = el('option', repo);
    opt.value = i === 0 ? '' : repo;
    opt.selected = filters.repo === opt.value;
    repoSelect.append(opt);
  });

  const platformSelect = el('select');
  platformSelect.setAttribute('aria-label', 'Filter reports by platform');
  platformList.forEach((platform, i) => {
    const opt = el('option', platform);
    opt.value = i === 0 ? '' : Object.keys(platforms).find(k => platforms[k] === platform) || platform;
    opt.selected = filters.platform === opt.value;
    platformSelect.append(opt);
  });

  const clear = el('button', 'Clear filters');
  clear.type = 'button';
  clear.disabled = !filters.repo && !filters.platform;

  controls.append(repoSelect, platformSelect, clear);
  view.append(controls);

  const status = el('p', '', 'meta');
  status.setAttribute('role', 'status');
  view.append(status);

  const output = el('div');
  view.append(output);

  repoSelect.addEventListener('change', () => {
    filters.repo = repoSelect.value;
    clear.disabled = !filters.repo && !filters.platform;
    renderRows();
  });
  platformSelect.addEventListener('change', () => {
    filters.platform = platformSelect.value;
    clear.disabled = !filters.repo && !filters.platform;
    renderRows();
  });
  clear.addEventListener('click', () => {
    filters.repo = '';
    filters.platform = '';
    repoSelect.value = '';
    platformSelect.value = '';
    clear.disabled = true;
    renderRows();
  });

  const allRecords = await Promise.all(index.issues.map(issue => getRecord(issue).catch(() => null)));

  function renderRows() {
    output.replaceChildren();
    const shown = index.issues.filter(i =>
      (!filters.repo || i.repo === filters.repo) &&
      (!filters.platform || i.platform === filters.platform)
    );

    if (shown.length === 0) {
      const empty = el('div', undefined, 'empty');
      empty.append(
        el('h2', index.issues.length ? 'No reports match your filters.' : 'No reports published yet.'),
        el('p', index.issues.length ? 'Try changing or clearing your selected filters.' : 'Reports will appear here after a reproduction run is published.')
      );
      output.append(empty);
    } else {
      const scroll = el('div', undefined, 'table-scroll');
      scroll.setAttribute('tabindex', '0');
      scroll.setAttribute('aria-label', 'Reports table');

      const table = el('table');
      const head = el('thead');
      head.append(el('tr'));
      ['#', 'Report', 'Platform', 'Run Location', 'Verdict', 'Reproduction Trials'].forEach(text => {
        head.firstChild.append(el('th', text));
      });
      table.append(head);

      const body = el('tbody');
      for (const issue of shown) {
        const row = el('tr');
        const title = el('td');
        title.append(link(issue.title, routeFor(issue), 'report-title'), el('span', issue.repo, 'repo'));
        if (issue.stubbed) title.append(el('span', 'Stub response', 'badge'));
        const result = el('td');
        result.append(verdict(issue.state));
        const trials = el('td');
        trials.append(strip(issue.sequence, true));
        const record = allRecords[index.issues.indexOf(issue)];
        row.append(
          el('td', `#${issue.issue}`),
          title,
          el('td', platforms[issue.platform] || issue.platform),
          el('td', record ? runLocation(record) : 'Details unavailable'),
          result,
          trials
        );
        body.append(row);
      }
      table.append(body);
      scroll.append(table);
      output.append(scroll);
    }
    status.textContent = index.issues.length
      ? `Showing ${shown.length} of ${index.issues.length} reports · ${new Set(shown.map(i => i.platform)).size} platforms · Overall median time to result: ${Math.round(index.totals.median_time_to_verdict_ms / 60000)} min`
      : 'No published runs yet.';
  }

  renderRows();
}

// ---------------------------------------------------------------------------
// Issue Detail View (#/r/...)
// ---------------------------------------------------------------------------
async function detail(view, issue) {
  const record = await getRecord(issue);
  document.title = `#${issue.issue} ${issue.title} | Reprise`;
  view.append(link('← Back to reports', '#/reports', 'back'), el('h1', `#${issue.issue} ${issue.title}`), verdict(record.state));
  view.append(el('p', `${platforms[issue.platform] || issue.platform} · ${runLocation(record)} · ${Math.round((record.replication?.duration_ms || 0) / 60000)} min`, 'meta'));
  if (record.stubbed) view.append(el('span', 'Stub response', 'badge'));

  const reproduction = section('Reproduction');
  reproduction.append(strip(record.replication?.repro?.sequence || ''), legend());
  if (record.replication?.question) reproduction.append(el('p', record.replication.question));

  const diagnosis = section('Diagnosis');
  diagnosis.append(el('p', record.replication?.diagnosis?.summary || 'No diagnosis yet.'));
  if (record.replication?.diagnosis?.fix_direction) diagnosis.append(el('p', record.replication.diagnosis.fix_direction));

  const fix = section('Fix');
  const iteration = record.fix?.iterations?.at(-1);
  fix.append(el('p', iteration?.summary || 'No fix proposed yet.'));
  if (iteration) fix.append(el('p', `Iteration ${iteration.n} · ${iteration.source === 'provider' ? 'Provider' : 'Developer'}`, 'meta'));
  if (iteration?.pr?.startsWith('https://github.com/')) fix.append(link('View pull request ↗', iteration.pr));

  const timeline = section('Timeline');
  const events = el('ol', undefined, 'timeline');
  for (const event of [...(record.events || [])].sort((a, b) => a.at.localeCompare(b.at))) {
    events.append(el('li', `${new Date(event.at).toLocaleString()} · ${event.detail}`));
  }
  timeline.append(events.children.length ? events : el('p', 'No activity recorded yet.'));

  view.append(reproduction, diagnosis, fix, verificationView(iteration), timeline);
}

// ---------------------------------------------------------------------------
// How It Works Guide (#/how-it-works)
// ---------------------------------------------------------------------------
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
  explanation.append(
    el('p', 'Read the evidence', 'eyebrow'),
    el('h2', 'A clearer picture, one run at a time.'),
    el('p', 'Each box represents a test run. Compare the reproduction results before and after a change, then review the regression checks in the report.'),
    link('Explore Dynamic Reports →', '#/reports', 'button')
  );

  const example = el('div', undefined, 'guide-example');
  example.append(
    el('h3', 'Reading a report'),
    el('p', 'Before: how often the bug reproduced. After: what changed when the fix was applied.', 'meta'),
    el('p', 'The legend identifies each recorded test outcome.', 'meta'),
    legend()
  );
  evidence.append(explanation, example);

  const cta = el('section', undefined, 'guide-cta');
  const ctaText = el('div');
  ctaText.append(
    el('h2', 'Ready to investigate your next bug?'),
    el('p', 'Open Reprise IDE to choose a report and start the workflow.'),
    el('p', 'Available in Google Chrome and Microsoft Edge on desktop.', 'meta')
  );
  cta.append(ctaText, link('Open IDE', 'ide/', 'button primary ide-launch'));
  view.append(steps, evidence, cta);
}

function showError(view) {
  const feedback = el('section', undefined, 'feedback');
  feedback.setAttribute('role', 'alert');
  const retry = el('button', 'Try again', 'primary');
  retry.type = 'button';
  retry.addEventListener('click', () => {
    retry.disabled = true;
    retry.textContent = 'Reloading...';
    location.reload();
  });
  feedback.append(
    el('h1', 'Reports unavailable'),
    el('p', 'We could not load the report data. Check your connection and try again. If a deployment is in progress, wait a few minutes before retrying.'),
    retry,
    link('Back to home', '#/', 'back')
  );
  view.replaceChildren(feedback);
}

// ---------------------------------------------------------------------------
// P0: Graceful IDE Launch Handler (Modal fallback when IDE is not reachable)
// ---------------------------------------------------------------------------
function setupIdeModal() {
  const dialog = document.getElementById('ide-dialog');
  const closeBtn = document.getElementById('dialog-close');
  const reportsBtn = document.getElementById('dialog-reports');
  if (!dialog) return;

  closeBtn?.addEventListener('click', () => dialog.close());
  reportsBtn?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });

  document.addEventListener('click', async (e) => {
    const launchBtn = e.target.closest('.ide-launch');
    if (!launchBtn) return;

    const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
    if (isLocal) {
      e.preventDefault();
      dialog.showModal();
      return;
    }

    try {
      const probe = await fetch('ide/', { method: 'HEAD' });
      if (!probe.ok && probe.status === 404) {
        e.preventDefault();
        dialog.showModal();
      }
    } catch {
      // Allow navigation or let default proceed
    }
  });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
async function render() {
  if (location.hash === '#content') { main.focus(); return; }
  const version = ++routeVersion;
  main.setAttribute('aria-busy', 'true');
  const loading = el('p', 'Loading...', 'loading');
  loading.setAttribute('role', 'status');
  main.replaceChildren(loading);

  const view = el('div');
  try {
    const route = location.hash || '#/';
    for (const item of document.querySelectorAll('nav a')) {
      const href = item.getAttribute('href');
      let active = false;
      if (href === '#/' && (route === '#/' || route === '')) active = true;
      else if (href === '#/reports' && (route === '#/reports' || route.startsWith('#/r/'))) active = true;
      else if (href === '#/how-it-works' && route === '#/how-it-works') active = true;

      if (active) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    }

    if (route === '#/how-it-works') {
      howItWorks(view);
    } else if (route === '#/reports') {
      await reports(view);
    } else if (route === '#/' || route === '') {
      await landing(view);
    } else {
      const issue = index.issues.find(item => routeFor(item) === route);
      if (issue) {
        await detail(view, issue);
      } else {
        document.title = 'Report not found | Reprise';
        view.append(
          el('h1', 'Report not found'),
          el('p', 'There is no report at this address.'),
          link('Go to all reports', '#/reports', 'button')
        );
      }
    }
  } catch {
    showError(view);
  }

  if (version !== routeVersion) return;
  main.replaceChildren(view);
  main.setAttribute('aria-busy', 'false');
}

try {
  const [data, schema] = await Promise.all([
    readJson('data/index.json'),
    readJson('data/dashboard-index.schema.json')
  ]);
  validate(data, schema);
  index = data;

  setupIdeModal();
  addEventListener('hashchange', async () => {
    await render();
    main.focus({ preventScroll: true });
  });
  await render();
} catch {
  showError(main);
  main.setAttribute('aria-busy', 'false');
}
