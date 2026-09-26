# IDE Fork Spec (web build)

Implements R-2, R-16, ADR-1, ADR-2. Gates: G-1 to G-6, G-19, G-21, G-26.

## Source

- Fork `microsoft/vscode` into public `OWNER/reprise-ide`.
- Pin a stable release tag (PD-3). Record it here: **Pinned tag: (fill in during phase 1)**.
- Create branch `reprise/main` from the tag. All Reprise changes live on it.

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

## Web build facts to record in phase 1

| Item | Value |
| --- | --- |
| Command that runs the web workbench locally for development (G-1) | **(fill in)** |
| Task that produces the minified static web build, output folder, size (G-5) | **(fill in)** |
| File that is the web entry (embedder) page | **(fill in)** |
| Headers the build needs, and what happens without them (G-6) | **(fill in)** |
| Does Open Folder use the File System Access API; does it survive reload (G-21) | **(fill in)** |
| Does the Source Control view work on the opened folder (G-26) | **(fill in)** |
| Where the supported-browser check lives | **(fill in)** |

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
