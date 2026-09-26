# T1 — GitHub Connection, Record Store and IDE Views

**Branch:** `track/t1-github` from `base-v1`. **Kit phase:** 2 (R-3, R-4, R-16).
**Kit inputs:** `04-build-plan/phase-2-github-and-views.md`, `02-specs/github-connection.md`, `ide-ux.md`, `security.md` (webview and browser rules), `data-contracts.md`, gates G-7, G-17, G-19, G-22, G-25, G-27.

**Owns:** `extensions/reprise/src/{auth,github,store,views,workspace}/**`, `extensions/reprise/media/**`, their tests.
**Must not touch:** `extension.ts`, `package.json`, `contracts/`, or any other module. Use the `Services` interfaces. Where another service is needed (pipeline, executors), call its fake.

## Tasks
1. **auth/**: implement `AuthService`. If G-7 passes, use `vscode.authentication.getSession('github')`. Otherwise use the PD-23 fine-grained token stored in `SecretStorage`, entered through the sign-in command. Try the G-22 device flow and record the result. Record the token permission list for G-17 in `github-connection.md`.
2. **workspace/**: `workspace.fs` read/write helpers on the opened folder, and `.git/config` + `HEAD` + refs + packed-refs reading (G-27). The fallback is the user typing `owner/repo`.
3. **github/**: implement `GitHubService` over REST with `fetch`:
   - list open issues with the configured label (PD-5), get an issue, and list comments
   - Git Data API commits without git (PD-19): blobs, then tree, then commit, then ref update
   - create a branch and open or update a draft PR
   - `workflow_dispatch` and the artifact list/download calls (only the HTTP calls: T4 owns the CI logic)
   - rate-limit and error handling as in the spec
4. **store/**: implement `IssueStore` on the `reprise-data` branch (PD-12). Read and write `issues/<N>.json`, validate against `schemas/issue-record.schema.json`, and read v2 records as `runner_version: null`. Use an optimistic-concurrency retry on ref conflict. Cache in IndexedDB per G-25.
5. **views/**:
   - Bug Reports tree (states from `data-contracts.md`, icons)
   - Runs tree (fed by `services.executors` events; use `FakeExecutor` now)
   - Reprise panel webview: one per issue, using `textContent` only and a strict CSP. It shows the fingerprint, trial strip, verdict and diagnosis from the record.
   - approvals diff view helper (PD-10): exposes `approveFile(path, content): Promise<boolean>` on `views`
   - status bar item: sign-in, runner and provider state
   - unsaved-work guard
6. **Acknowledge** command (R-4): calls `services.pipeline.acknowledge(issue)`. Against the fake pipeline, this should show a fake verdict end to end in the panel.

## Acceptance
- Signed in against a real demo repository: the Bug Reports view lists real `bug` issues.
- Acknowledging an issue with fakes on shows the fake verdict in the panel.
- A real record is committed to `reprise-data` through the Git Data API, with no git involved.
- Gate results G-7, G-17, G-19, G-22, G-25 and G-27 are recorded.
- Unit tests cover the GitHub client (mocked `fetch`), the store, and `.git` parsing. `depcheck` is green.

## Stop conditions
- G-19: a required API is missing in the web build → record the nearest stable API and tell the base owner (possible CR).
- The token would need permissions beyond G-17's list → stop and ask.
