#!/usr/bin/env node
// ide/build.mjs — build Reprise IDE: the Code - OSS web build with Reprise as a built-in extension.
//
// Usage: node ide/build.mjs --vscode <microsoft/vscode checkout> --out <output dir> [--skip-install]
//
// The checkout must be at the tag in ide/CODE_OSS_TAG. This script:
//   1. merges ide/product.overrides.json into the checkout's product.json (names, PD-21: no gallery),
//   2. bundles extensions/reprise and stages it as the built-in extension extensions/reprise,
//   3. runs `npm ci` and `npm run gulp vscode-web-min` in the checkout,
//   4. copies the static build plus ide/index.html and ide/reprise-boot.js into --out.
//
// Only the checkout, its sibling folder vscode-web/ (gulp's output) and --out are modified.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

const IDE_DIR = import.meta.dirname;
const REPO_ROOT = path.dirname(IDE_DIR);
const EXTENSION_DIR = path.join(REPO_ROOT, 'extensions', 'reprise');

const { values: args } = parseArgs({
  options: {
    vscode: { type: 'string' },
    out: { type: 'string' },
    'skip-install': { type: 'boolean', default: false },
  },
});

if (!args.vscode || !args.out) {
  console.error('Usage: node ide/build.mjs --vscode <microsoft/vscode checkout> --out <output dir> [--skip-install]');
  process.exit(2);
}

const vscodeDir = path.resolve(args.vscode);
const outDir = path.resolve(args.out);
// gulp vscode-web-min writes to a sibling of the checkout (build/gulpfile.vscode.web.ts, BUILD_ROOT)
const webBuildDir = path.join(path.dirname(vscodeDir), 'vscode-web');

function step(message) {
  console.log(`\n[reprise-ide] ${message}`);
}

function run(command, commandArgs, cwd, env = {}) {
  console.log(`$ ${command} ${commandArgs.join(' ')}   (in ${cwd})`);
  const result = spawnSync(command, commandArgs, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${commandArgs.join(' ')} failed with exit code ${result.status}`);
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, '\t') + '\n');
}

function directorySize(dir) {
  let bytes = 0;
  let files = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) {
      bytes += fs.statSync(path.join(entry.parentPath, entry.name)).size;
      files++;
    }
  }
  return { bytes, files };
}

// ── 1. Check the checkout and apply product.json overrides ─────────────────────
const tag = fs.readFileSync(path.join(IDE_DIR, 'CODE_OSS_TAG'), 'utf8').trim();
const vscodeVersion = readJson(path.join(vscodeDir, 'package.json')).version;
if (vscodeVersion !== tag) {
  throw new Error(`${vscodeDir} is Code - OSS ${vscodeVersion}, but ide/CODE_OSS_TAG pins ${tag}`);
}

step(`Applying product.json overrides to Code - OSS ${tag}`);
const productPath = path.join(vscodeDir, 'product.json');
const product = { ...readJson(productPath), ...readJson(path.join(IDE_DIR, 'product.overrides.json')) };
if (product.extensionsGallery) {
  throw new Error('product.json must not configure extensionsGallery (PD-21)');
}
writeJson(productPath, product);

// ── 2. Bundle and stage the Reprise extension ─────────────────────────────────
step('Bundling extensions/reprise');
if (!args['skip-install']) {
  run('npm', ['ci'], EXTENSION_DIR);
}
run('npm', ['run', 'compile'], EXTENSION_DIR);

step('Staging Reprise as a built-in web extension');
const stagedDir = path.join(vscodeDir, 'extensions', 'reprise');
fs.rmSync(stagedDir, { recursive: true, force: true });
fs.mkdirSync(stagedDir, { recursive: true });

// The bundle already contains every runtime dependency, so the staged manifest declares none.
// (The Code - OSS build lists extension files with `npm list --production`.)
const manifest = readJson(path.join(EXTENSION_DIR, 'package.json'));
delete manifest.scripts;
delete manifest.dependencies;
delete manifest.devDependencies;
// vsce rejects extensionKind "web"; the `browser` entry alone makes it a web extension.
delete manifest.extensionKind;
manifest.browser = './extension.js';
writeJson(path.join(stagedDir, 'package.json'), manifest);
fs.copyFileSync(path.join(EXTENSION_DIR, 'dist', 'extension.js'), path.join(stagedDir, 'extension.js'));
fs.cpSync(path.join(EXTENSION_DIR, 'media'), path.join(stagedDir, 'media'), { recursive: true });

// ── 3. Build the Code - OSS web target ────────────────────────────────────────
if (!args['skip-install']) {
  step('Installing Code - OSS dependencies (npm ci)');
  run('npm', ['ci'], vscodeDir, {
    ELECTRON_SKIP_BINARY_DOWNLOAD: '1',
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
  });
}

step('Building the minified web target (gulp vscode-web-min)');
const started = Date.now();
run('npm', ['run', 'gulp', 'vscode-web-min'], vscodeDir);
console.log(`vscode-web-min took ${Math.round((Date.now() - started) / 60000)} min`);

if (!fs.existsSync(path.join(webBuildDir, 'out', 'vs', 'code', 'browser', 'workbench', 'workbench.js'))) {
  throw new Error(`Expected the web build in ${webBuildDir}, but workbench.js is missing`);
}
if (!fs.existsSync(path.join(webBuildDir, 'extensions', 'reprise', 'package.json'))) {
  throw new Error('The web build does not contain the Reprise built-in extension');
}

// ── 4. Assemble the static site ───────────────────────────────────────────────
step(`Writing ${outDir}`);
fs.rmSync(outDir, { recursive: true, force: true });
fs.cpSync(webBuildDir, outDir, { recursive: true });
fs.copyFileSync(path.join(IDE_DIR, 'index.html'), path.join(outDir, 'index.html'));
fs.copyFileSync(path.join(IDE_DIR, 'reprise-boot.js'), path.join(outDir, 'reprise-boot.js'));

const { bytes, files } = directorySize(outDir);
console.log(`Reprise IDE (Code - OSS ${tag}): ${files} files, ${(bytes / 1024 / 1024).toFixed(1)} MB`);
