import { mkdir, writeFile, copyFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const samples = [
  ['sample/mobile-app', 12, 'Checkout stalls after reconnecting', 'android', 'FIX_VERIFIED', 'FPPFPPPPFPPPPPFPPPPP', 'local', 'Android emulator', 420000],
  ['sample/mobile-app', 18, 'Saved items disappear after refresh', 'ios', 'FLAKY', 'PPFPPPPFPPPPFPPPPPPP', 'ci', 'iPhone simulator', 360000],
  ['sample/desktop-app', 7, 'Export closes the application', 'windows', 'CONFIRMED', 'FFFFFFFFFF', 'local', 'Windows desktop', 180000],
  ['sample/desktop-app', 9, 'Search drops the first character', 'linux', 'NEEDS_INFO', '', 'local', 'Linux desktop', 120000],
  ['sample/desktop-app', 14, 'Settings reset when the window reopens', 'macos', 'VERIFYING', 'FPFPPPFPPP', 'ci', 'macOS desktop', 540000],
];
const issues = [];
for (const [repo, issue, title, platform, state, sequence, executor, device, duration_ms] of samples) {
  const updated_at = `2026-09-26T10:${String(60 - issue).padStart(2, '0')}:00Z`;
  const failed = [...sequence].filter(c => c === 'F').length;
  const verdict = sequence ? (failed === sequence.length ? 'CONFIRMED' : 'FLAKY') : 'NEEDS_INFO';
  const rate = sequence ? failed / sequence.length : 0;
  const run_context = { platform, executor, method: 'repo_command', host_os: platform, device, ci_run_url: null, runner_version: 'sample' };
  const record = {
    schema: 3, repo, issue, title, url: `https://github.com/${repo}/issues/${issue}`, state, provider: 'stub', stubbed: true,
    created_at: '2026-09-26T09:00:00Z', updated_at,
    replication: { verdict, duration_ms, question: sequence ? '' : 'Which keyboard layout triggers the missing character?',
      repro: { sequence, trials: sequence.length, failed, invalid: 0, rate, run_context },
      diagnosis: { summary: sequence ? 'Sample diagnosis: an asynchronous update uses state from before the latest interaction.' : 'More information is needed before reproducing this report.', locations: [], fix_direction: 'Check the current state before applying the update.', confidence: 'medium' } },
    fix: { iterations: state === 'FIX_VERIFIED' ? [{ n: 1, source: 'provider', pr: null, summary: 'Sample fix: discard stale updates.', verification: { verdict: 'FIX_VERIFIED', run_context, repro: { runs_required: 36, runs: 36, failed: 0, invalid: 0, evidence: 'strong', claim: 'The reported bug did not reproduce in 36 verification runs.' }, regression: { tests_total: 24, counts: { UNCHANGED_PASS: 24 }, blocking: [], notable: [] } } }] : [] },
    events: [{ at: '2026-09-26T09:00:00Z', type: 'acknowledged', detail: 'Sample report acknowledged.' }, { at: updated_at, type: 'verdict', detail: 'Sample results recorded.' }],
  };
  const path = new URL(`data/${repo}/issues/`, root);
  await mkdir(path, { recursive: true });
  await writeFile(new URL(`${issue}.json`, path), JSON.stringify(record, null, 2) + '\n');
  issues.push({ repo, issue, title, platform, state, verdict, rate, sequence, stubbed: true, updated_at, pr: null });
}
const countBy = key => Object.fromEntries([...new Set(issues.map(row => row[key]))].map(value => [value, issues.filter(row => row[key] === value).length]));
const index = { generated_at: '2026-09-26T11:00:00Z', data_source: 'sample', repos: [...new Set(issues.map(row => row.repo))], totals: { issues: issues.length, by_state: countBy('state'), by_platform: countBy('platform'), median_time_to_verdict_ms: 360000, fixes_verified: 1, regressions_caught: 0 }, issues };
await writeFile(new URL('data/index.json', root), JSON.stringify(index, null, 2) + '\n');
await copyFile(new URL('../extensions/reprise/src/contracts/schemas/dashboard-index.schema.json', root), new URL('data/dashboard-index.schema.json', root));
console.log('Generated five sample reports and copied the dashboard index schema.');
