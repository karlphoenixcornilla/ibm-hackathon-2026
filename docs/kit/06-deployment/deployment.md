# Deployment (zero cost, R-13)

Replace `OWNER` with the team's GitHub account or organisation.

## Repositories

- [ ] `OWNER/reprise-ide` is a public fork of `microsoft/vscode`; default branch set to `reprise/main`.
- [ ] Every demo app repository that will use CI runs or appear on the dashboard is public (V-4, V-5). Private ones: local runs only, not on the dashboard.

## GitHub settings

- [ ] `reprise-ide` → Settings → Pages → Source: GitHub Actions.
- [ ] Each team member creates a fine-grained personal access token limited to the demo app repositories, with the permissions from G-17 and an expiry after the hackathon (PD-23). Only if G-22 passed: create a GitHub OAuth App for the device flow and put its client ID (not a secret) in the extension configuration.
- [ ] Action versions confirmed (G-18): record them here.

## Demo app repositories

- [ ] `.reprise.yml` committed (phase 3).
- [ ] `.reprise/stubs/` committed (phase 4).
- [ ] `reprise-run.yml` and `.reprise/ci/run-loop.mjs` merged via "Reprise: Set Up CI Runs" (phase 7).
- [ ] Cloned on the machine that runs its platform, at the path recorded in `demo-apps.md` (the runner's `--root`).
- [ ] `reprise-data` branch created by the first published record.
- [ ] Listed in `reprise-ide/dashboard/repos.json`.

## Releases

- [ ] Tag `v0.1.0` on `reprise/main`; `release-runner.yml` completes; the release has `reprise-runner.mjs`, its SHA-256 and the start command.

## Dashboard

- [ ] Run `pages.yml` manually; `https://OWNER.github.io/reprise-ide/` shows live records and `https://OWNER.github.io/reprise-ide/ide/` opens Reprise IDE in Chrome and Edge.

## Rollback

Delete or mark a release as pre-release if the runner file is broken; re-run the last good `pages.yml` (this also rolls back the IDE); disable `reprise-run.yml` in a demo repository to stop CI runs; revoke a team member's token on GitHub if it may have leaked.
