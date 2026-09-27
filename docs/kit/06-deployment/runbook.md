# Runbook

## Reset a demo repository

Close demo issues and PRs, delete branches `reprise/*`, reset `reprise-data` to a single commit with a README, recreate the demo issues from `demo-apps.md`, re-run `pages.yml`. On each machine: `git checkout` the demo branch and `git clean` the local clone (the IDE writes provided tests and applied fixes into it), stop the runner, and delete `~/.reprise-runner/worktrees/`.

## Troubleshooting

| Symptom | Likely cause | Action |
| --- | --- | --- |
| "Reprise IDE needs a Chromium-based desktop browser that can open folders" | Not a Chromium-based desktop browser (Firefox, Safari, mobile), or the browser or a policy turns the File System Access API off | Open the URL in a Chromium-based desktop browser such as Chrome or Edge, or turn the API on; check policies listed from G-28 |
| "Allow access to <folder> to continue" after reload | The browser asks again for folder permission after a reload | Click the button and allow |
| Bug Reports view empty | No folder open, not signed in, wrong repository linked, or label filter | Follow the first-run checklist; "Link Repository"; `.reprise.yml` `issues.labels` |
| "Runner: not connected" | Runner not started, wrong port, pairing code expired | Start `node reprise-runner.mjs --root <clone>`; "Connect Runner" with the new code |
| Runner refuses with 403 | IDE origin not in `--allow-origin`, or the browser blocked local network access (G-23) | Restart the runner with the right origin; allow the browser's local network prompt |
| "Runner's root is a different repository" | `--root` points at another clone | Restart the runner with the clone the IDE has open |
| "Test not approved" | The test file changed on disk after approval | Approve it again in the IDE |
| `BLOCKED_ENV` naming a tool or device | Prerequisite missing on the runner's machine | "Show Machine Capabilities"; install or attach, restart the runner; acknowledge again; or use CI |
| Many `ERROR` trials | Test unstable or report path wrong | Check the output channel and the runner console; fix `report_path` or the test |
| Stub says "No stub response" | Fixture missing for that stage | Add the file under `.reprise/stubs/<issue>/` or use validate mode |
| CI run never starts | `reprise-run.yml` not on the default branch, or repository private | "Set Up CI Runs"; make repository public |
| Dashboard missing a report | Record not published, or repository not in `repos.json` | "Publish Record"; add to `repos.json`; re-run `pages.yml` |
| CI results "unavailable" | Browser cannot download the artifact (G-24) and no runner is paired | Pair a runner, or follow the G-24 fallback |
| "The browser blocked a request to <host>" | CORS or the IDE's CSP | Check the gate named in the message |
