# Phase 9 — Web deployment, runner release, build from source

**Serves:** R-14, R-16. **Specs:** `ide-fork.md` (deployment, build from source), `browser-runtime.md` (hosting), `local-runner.md`, `06-deployment/deployment.md`. **Gates:** G-5, G-6, G-8, G-18. **Decision:** PD-20 must be confirmed by the team before this phase is called done.

Do the Pages part right after phase 1, and the runner release once phase 3 has a working runner.

## Task prompt

```
1. Create .github/workflows/pages.yml in reprise-ide: build the minified Code - OSS web target with the task recorded for gate G-5, place it under ide/ in the Pages artifact, build the dashboard into the root, and deploy with the official Pages actions (versions per G-18). Triggers: workflow_dispatch, pushes to reprise/main, and a schedule for dashboard data. Respect the 6-hour job limit (V-4) and the 1 GB site limit (V-5); if either cannot be met, report it. Apply the G-6 result (headers) exactly as recorded; do not add a workaround that G-6 did not choose.
2. Create .github/workflows/release-runner.yml: on tags v*, bundle runner/ into a single reprise-runner.mjs, compute SHA-256, and upload both to the GitHub Release with the checksum and the start command in the release notes.
3. Finish BUILDING.md so a new person can build and serve the web IDE locally, open it in Chrome or Edge, and run the runner from source against a local clone; every command must have been run by a team member.
```

## Acceptance

`https://OWNER.github.io/reprise-ide/ide/` opens Reprise IDE in Chrome and Edge and shows the unsupported-browser page in Firefox; a tagged release holds `reprise-runner.mjs` and its checksum; a team member who did not write the runner downloads it, verifies the checksum, starts it and pairs it from the deployed IDE by following the release notes only.
