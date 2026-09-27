// Build a dependency-free Node ESM distribution with isolated module scopes.
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const outfile = fileURLToPath(new URL('./dist/reprise-runner.mjs', import.meta.url));
await build({
  entryPoints: [fileURLToPath(new URL('./reprise-runner.mjs', import.meta.url))],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
});
const bytes = readFileSync(outfile);
const digest = createHash('sha256').update(bytes).digest('hex');
writeFileSync(`${outfile}.sha256`, `${digest}\n`);
console.log(`Built: ${outfile} (${(bytes.length / 1024).toFixed(1)} KB)\nSHA-256: ${digest}`);
