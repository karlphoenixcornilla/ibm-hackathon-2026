#!/usr/bin/env node
// dashboard/build.mjs — build the static dashboard into an output folder.
// Spec: 02-specs/dashboard.md §Data loading, data-contracts.md §Dashboard index
//
// Usage: node dashboard/build.mjs --out _site [--sample]
//   Reads the public `reprise-data` branch of every repository in dashboard/repos.json
//   (GITHUB_TOKEN raises the API rate limit; public data needs no token), validates
//   each record, and writes data/index.json + data/<owner>/<repo>/issues/<N>.json.
//   With no live records (or --sample) it publishes dashboard/fixtures as sample data.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndex, validateIndex, validateRecord } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const STATIC = ['index.html', 'app.js', 'lib.mjs', 'styles.css', 'lifecycle.svg', 'favicon.svg'];
const FONTS = [
  ['@ibm/plex-sans', 'IBMPlexSans-Regular.woff2'],
  ['@ibm/plex-sans', 'IBMPlexSans-SemiBold.woff2'],
  ['@ibm/plex-mono', 'IBMPlexMono-Regular.woff2'],
];

function args(argv) {
  const out = { out: '_site', sample: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') out.out = argv[++i];
    else if (argv[i] === '--sample') out.sample = true;
  }
  return out;
}

async function gh(url, token) {
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'reprise-dashboard-build' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

/** Every valid record on one repository's reprise-data branch. */
async function liveRecords(repo, token) {
  let listing;
  try {
    listing = await gh(`https://api.github.com/repos/${repo}/contents/issues?ref=reprise-data`, token);
  } catch (err) {
    console.warn(`  ${repo}: no reprise-data records (${err.message})`);
    return [];
  }
  const records = [];
  for (const f of Array.isArray(listing) ? listing : []) {
    if (f.type !== 'file' || !/^\d+\.json$/.test(f.name)) continue;
    try {
      const raw = await gh(f.url, token);
      const record = JSON.parse(Buffer.from(raw.content, 'base64').toString('utf8'));
      const errors = validateRecord(record);
      if (errors.length) {
        console.warn(`  ${repo}/${f.name}: skipped, invalid (${errors.slice(0, 4).join(', ')})`);
        continue;
      }
      if (record.repo.toLowerCase() !== repo.toLowerCase()) {
        console.warn(`  ${repo}/${f.name}: skipped, record names ${record.repo}`);
        continue;
      }
      records.push(record);
    } catch (err) {
      console.warn(`  ${repo}/${f.name}: skipped (${err.message})`);
    }
  }
  console.log(`  ${repo}: ${records.length} record(s)`);
  return records;
}

function fixtureRecords() {
  const root = join(here, 'fixtures');
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.json')) out.push(JSON.parse(readFileSync(p, 'utf8')));
    }
  };
  if (existsSync(root)) walk(root);
  return out;
}

function copyFonts(outDir) {
  let copied = 0;
  for (const [pkg, file] of FONTS) {
    for (const base of [join(here, 'node_modules'), join(here, '..', 'node_modules')]) {
      const src = join(base, pkg, 'fonts', 'complete', 'woff2', file);
      if (existsSync(src)) {
        mkdirSync(join(outDir, 'fonts'), { recursive: true });
        cpSync(src, join(outDir, 'fonts', file));
        copied++;
        break;
      }
    }
  }
  if (copied < FONTS.length) {
    // No 404s in the console: without the font files, drop the @font-face rules.
    const cssPath = join(outDir, 'styles.css');
    writeFileSync(cssPath, readFileSync(cssPath, 'utf8').replace(/@font-face\s*\{[^}]*\}\s*/g, ''));
  }
  console.log(copied === FONTS.length ? 'Fonts: IBM Plex copied' : 'Fonts: IBM Plex not installed; the system font stack is used');
}

async function main() {
  const opts = args(process.argv.slice(2));
  const outDir = resolve(opts.out);
  mkdirSync(outDir, { recursive: true });

  for (const f of STATIC) cpSync(join(here, f), join(outDir, f));
  copyFonts(outDir);

  const repos = JSON.parse(readFileSync(join(here, 'repos.json'), 'utf8'));
  if (!Array.isArray(repos) || !repos.every((r) => typeof r === 'string' && /^[\w.-]+\/[\w.-]+$/.test(r))) {
    throw new Error('dashboard/repos.json must be an array of "owner/repo" strings');
  }

  let records = [];
  if (!opts.sample) {
    console.log(`Reading reprise-data from ${repos.length} repositor${repos.length === 1 ? 'y' : 'ies'}`);
    for (const repo of repos) records.push(...(await liveRecords(repo, process.env.GITHUB_TOKEN)));
  }

  let dataSource = 'live';
  let indexRepos = repos;
  if (records.length === 0) {
    records = fixtureRecords();
    dataSource = 'sample';
    indexRepos = [...new Set(records.map((r) => r.repo))];
    console.log(`No live records; publishing ${records.length} sample record(s)`);
  }

  const index = buildIndex(records, { dataSource, repos: indexRepos });
  const errors = validateIndex(index);
  if (errors.length) throw new Error(`Generated index is invalid: ${errors.join(', ')}`);

  const dataDir = join(outDir, 'data');
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, 'index.json'), JSON.stringify(index, null, 2));
  for (const r of records) {
    const dir = join(dataDir, ...r.repo.split('/'), 'issues');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${r.issue}.json`), JSON.stringify(r));
  }
  writeFileSync(join(outDir, '.nojekyll'), '');
  console.log(`Dashboard: ${index.issues.length} report(s), data_source=${dataSource} → ${outDir}`);
}

main().catch((err) => {
  console.error(`dashboard build failed: ${err.message}`);
  process.exit(1);
});
