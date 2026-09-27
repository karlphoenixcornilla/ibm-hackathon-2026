# IDE Fork Spec (web build)

Implements R-2, R-16, ADR-1, ADR-2. Gates: G-1 to G-6, G-19, G-21, G-26.

## Source

- Fork `microsoft/vscode` into public `OWNER/reprise-ide`.
- Pin a stable release tag (PD-3). Record it here: **Pinned tag: `1.139.1`** (also in `ide/CODE_OSS_TAG`, which the build reads; `.nvmrc` at the tag: Node 24.18.0).
- Create branch `reprise/main` from the tag. All Reprise changes live on it.

> **As built:** the team repository is not a fork. Instead, `pages.yml` checks out `microsoft/vscode` at the pinned tag and `ide/build.mjs` applies the Reprise changes to that checkout at build time: `ide/product.overrides.json` is merged into `product.json`, and `extensions/reprise` is bundled and staged as the built-in extension `extensions/reprise`. The Code - OSS source itself is not modified. To upgrade, change `ide/CODE_OSS_TAG` and re-check the embedder page (`ide/index.html`, `ide/reprise-boot.js`) against `src/vs/code/browser/workbench/workbench.html` at the new tag.

## Build prerequisites (V-1)

Node.js x64 or ARM64, version 22 or later, using the exact version in `.nvmrc` at the pinned tag; at least 4 cores and 6 GB RAM (8 GB recommended). Only one machine needs to build the web IDE; the other machines only need a supported browser and Node.js for the runner.

## Changes to the fork (and nothing else)

| Change | Where | Gate |
| --- | --- | --- |
| Product names and application name | `product.json` (field names confirmed at the pinned tag) | G-3 |
| Extension gallery removed (PD-21) | `product.json` | G-3 |
| Icons and any logo or name that the licence or trademark rules require replacing | web resources (favicon, manifest, workbench icons) | G-4 |
| Web embedder page for `/ide/`: workbench configuration, supported-browser check (`browser-runtime.md`), Content-Security-Policy | the web entry at the pinned tag (record the file) | G-1, G-6 |
| Reprise built-in web extension | `extensions/reprise/`, registered in the web build | G-2 |
| Reprise Runner | `runner/` (not part of the Code - OSS build) | — |
| Pages workflow building the web IDE and the dashboard | `.github/workflows/pages.yml` | G-5 |
| Runner release workflow | `.github/workflows/release-runner.yml` | G-8 |
| Dashboard | `dashboard/` | — |
| This kit | `docs/kit/` | — |

Record every `product.json` field changed, old and new value, in a table here during phase 1.

`product.json` changes (from `ide/product.overrides.json`, at `1.139.1`):

| Field | Old | New |
| --- | --- | --- |
| `nameShort` | `Code - OSS` | `Reprise` |
| `nameLong` | `Code - OSS` | `Reprise IDE` |
| `applicationName` | `code-oss` | `reprise` |
| `dataFolderName` | `.vscode-oss` | `.reprise` |
| `reportIssueUrl` | `https://github.com/microsoft/vscode/issues/new` | `https://github.com/karlphoenixcornilla/ibm-hackathon-2026/issues/new` |
| `extensionsGallery` (PD-21) | not present in Code - OSS | not present; `ide/build.mjs` fails the build if an override adds it |

## Web build facts to record in phase 1

| Item | Value |
| --- | --- |
| Command that runs the web workbench locally for development (G-1) | **(fill in)** |
| Task that produces the minified static web build, output folder, size (G-5) | `npm run gulp vscode-web-min` (in the checkout) → `../vscode-web` (sibling of the checkout). Measured on `ubuntu-latest` (run 36307547811): **180.2 MB, 2,394 files**; the whole uncached IDE job took **8 min 18 s** (`npm ci` about 5 min, `vscode-web-min` 2 min). Cached runs skip the build. |
| File that is the web entry (embedder) page | `ide/index.html` + `ide/reprise-boot.js` + `ide/reprise-workbench.js`. At `1.139.1` the `web` target builds only the embeddable workbench (`out/vs/workbench/workbench.web.main.internal.js`, exporting `create`); the browser shell `src/vs/code/browser/workbench/workbench.ts` is bundled only for the server. `reprise-workbench.js` is the needed part of that shell (the `?folder=` workspace provider). The page computes its base URL at runtime, so the same build works at `/ide/` on Pages and under a local static server. |
| Secret storage (GitHub token, runner session) | `IndexedDBSecretStorageProvider` in `ide/reprise-workbench.js`: AES-GCM ciphertext in IndexedDB (`reprise-secrets`), under a non-extractable key stored in the same database. Secrets survive reloads, and nothing is in `localStorage`. This protects data at rest, not against script running in the origin (T10). Note that every GitHub Pages site of the account shares the `https://<owner>.github.io` origin. The stock shell without a server key would store plain text in `localStorage`, which `browser-runtime.md` rules out. |
| Headers the build needs, and what happens without them (G-6) | **(fill in: open the deployed `/ide/` and check the console)** |
| Does Open Folder use the File System Access API; does it survive reload (G-21) | **(fill in)** |
| Does the Source Control view work on the opened folder (G-26) | **(fill in)** |
| Where the supported-browser check lives | `ide/reprise-boot.js`: without `window.showDirectoryPicker` or a secure context it shows the unsupported-browser page from `browser-runtime.md` and never loads the workbench. |

**Content-Security-Policy:** `ide/index.html` sets the policy that the Code - OSS server sends for its web client (a meta tag, since Pages cannot set headers). Extension `fetch` calls are governed by the extension host iframe's own policy (`src/vs/workbench/services/extensions/worker/webWorkerExtensionHostIframe.html`: `connect-src 'self' https: … http://127.0.0.1:*`), not by the embedder page. So narrowing `connect-src` to the list in `browser-runtime.md` would mean patching that Code - OSS file; that has not been done.

## Development loop

1. Build the web target once (G-1) on one machine.
2. Develop the extension with the web watch task running and reload the browser tab to pick up changes. Record the exact commands here.
3. Develop the runner separately: `node runner/src/…` with `--allow-origin` set to the local dev origin.
4. For platform work on other machines, use the deployed `/ide/` URL (or the dev server on the builder's machine if reachable) and run the runner locally.

## Deployment (R-14, PD-20)

- `pages.yml` builds the minified web IDE, copies it into `/ide/` of the Pages artifact, builds the dashboard into `/`, and deploys. Runs on `workflow_dispatch`, on pushes to `reprise/main`, and on a schedule (for dashboard data).
- `release-runner.yml` bundles `runner/` into `reprise-runner.mjs` on tags `v*`, computes SHA-256, and uploads both to the GitHub Release.
- No desktop installers (PD-20).

## Build from source (R-14)

`BUILDING.md` at the root of `reprise-ide`: prerequisites, clone, checkout `reprise/main`, install, build the web IDE, serve it locally, open it in Chrome or Edge, and start the runner against a local clone. Every command in it must have been run by a team member.
