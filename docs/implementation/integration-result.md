# Integration Result — IBM Bob, T5 and wiring

**Branch:** `feat/integration-bob` · **Plans:** `05-dashboard-and-deploy.md`, `99-integration.md`, G-15 resolution
**Set-up guide:** [`docs/SETUP.md`](../SETUP.md)

## Summary

T1–T4 were merged but not wired: `buildServices` still returned fakes for the runner client, executors, providers, pipeline, stats, fix, verify and security, and every command except sign-in showed "Not implemented yet". This change wires every real service and command, and makes IBM Bob the AI provider for all six stages. It also implements T5 (dashboard, Pages, runner release) and fixes the gaps that would have broken the flow against a real runner.

## IBM Bob (G-15 resolved, CR-1)

| Piece | File |
| --- | --- |
| Runner bridge `POST /ai/run` — `bob run --format json`, prompt on stdin, fixed caps, read-only tool group, GitHub tokens stripped, 1 call at a time, timeout/abort kills the tree | `runner/src/bob.mjs`, `runner/src/server.mjs` |
| Bob availability in `/pair` and `/status` (`ai: [...]`), `--bob-*` flags and `REPRISE_BOB_*` env | `runner/src/args.mjs` |
| `BobProvider` — renders `03-runtime-prompts/<stage>.md` + stage schema, `<untrusted_report>` wrapping, JSON extraction, `files` proposals, one repair | `extensions/reprise/src/providers/bob/` |
| Context builder — issue body and comments, record, `.reprise.yml`, test source | `providers/bob/context.ts` |
| Generated prompts/schemas/CI templates with a drift test | `scripts/gen-assets.mjs`, `prompts.ts`, `exec/ci/templates.ts` |
| Default provider `bob`; `stub` kept for rehearsals | `package.json`, `wiring/buildServices.ts` |

Contract change CR-1 (additive, all optional): `runner-api.ts` `AiRunRequest/AiRunResponse/AiCapability`, `ai?` on pair/status. `services.ts` adds `GitHubService.getIssue/getDefaultBranch/commitFiles/markPrReady/comment`, `RunnerClientService.runAi/approve/createOverlay` and `ViewsService.approveFile`.

## Fixes to merged tracks

| Problem | Fix |
| --- | --- |
| Extension typecheck failed (`runner-client` decoded a `Result` as bytes), so `npm test` could not run and the same-repository check never ran | Read `Result` properly, including packed-refs; SSH and HTTPS remotes compared as `owner/repo` |
| Provided tests were written and auto-approved without asking (PD-10) and never registered with the runner, so the runner answered 409 | `pipeline/approve-file.ts`: `edit_scope.test` check → diff and approval → write → `security` and runner `/approve` |
| Fix candidates lost their file contents; the quick check ran on the unmodified tree; `applySelected` opened a PR with no commits and a fake head SHA | Contents kept per session; quick check runs in a runner overlay (candidate + test); commit to `reprise/fix-N` off the default branch via the Git Data API; real `base_sha`/`head_sha` |
| `verify` ran on the working tree (`ref: null`), so it could never see the fix | Repro and regression runs use `{head: head_sha}` / `{base: base_sha}` |
| Shell injection: `git ls-files -- ${path}` and `git fetch origin ${sha}` | `execFileSync`; SHAs must be hex (also blocks path traversal in worktree paths) |
| Overlays accepted any content for an approved path | Content SHA-256 must equal the approved hash; `edit_scope.never` enforced; test paths allowed |
| `runner/build.mjs` produced a bundle that did not parse (duplicate imports) | Module-registry bundler: one scope per module, hoisted `node:` imports |
| Webpack needed polyfill packages that were not installed | Polyfills off (none are used); bundle builds |
| "Set Up CI Runs" not implemented | `exec/ci/setup.ts` commits the templates and opens a PR |
| Tree items called the unregistered `reprise.openPanel` | Registered; context menus added for the report lifecycle |
| 21 lint errors | Fixed (0 errors) |

## T5

- `dashboard/`: overview with before/after strips, detail page, "How it works", filters, sample banner, CSP, `textContent` only, reduced-motion and keyboard rules, 360 px layout. `build.mjs` aggregates `reprise-data` from `repos.json`, or falls back to fixtures as `sample`.
- `.github/workflows/pages.yml`: dashboard + extension at `/ide/extension/` always. The Code-OSS IDE at `/ide/` only with `REPRISE_BUILD_IDE=true`.
- `.github/workflows/release-runner.yml`: on `v*` tags.
- `ci.yml`: adds asset drift, web bundle, runner bundle and dashboard jobs.

## Test results (local, Windows, Node 24)

```
Extension  typecheck clean · lint 0 errors · depcheck 0 errors · 201/201 tests · webpack OK
Runner     69/69 tests (23 new for the Bob bridge, incl. a fake `bob` executable) · bundle parses and serves /status
Dashboard  15/15 tests (fixtures validated against issue-record.schema.json) · checked in Chromium, no console errors
```

## Not verified here (expect failures until done)

| Item | Why |
| --- | --- |
| A real `bob run` call | Needs Bob Shell + `BOB_API_KEY`; the bridge was tested against a fake `bob`. Bob's `--mode agent` with tool groups disabled, and whether `--trust` is accepted, need a real check. |
| The extension inside a browser workbench | Not launched here. `npm run web` (`@vscode/test-web`) or vscode.dev "Install Extension from Location" are the ways to try it. |
| G-23 runner origin | The extension-host origin in vscode.dev / Code-OSS must be added with `--allow-origin`; the runner logs it on 403. |
| Code-OSS web build (G-1/G-5) and `workbench.html` | Opt-in in `pages.yml`; modelled on upstream and never run. |
| GitHub workflows | Not run on GitHub yet (Pages, release, the new CI jobs). |
| `markPrReady` (GraphQL), `commitFiles` against real GitHub | Unit-tested paths only via fakes. |
