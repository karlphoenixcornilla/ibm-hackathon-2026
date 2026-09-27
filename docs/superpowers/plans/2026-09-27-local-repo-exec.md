# Local Repo Import + Local Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user pairs their local Reprise Runner from the deployed app. The app reads their clone through it, and an agent-proposed diff is applied and tested on a runner worktree. Nothing is checked out on the server and the user's clone is never modified.

**Architecture:** A runner `GET /file` endpoint plus tightened `/overlays`. On the server:
- a generalized browser relay (`runner.request`)
- a `RunnerWorkspace` FileSystem that stages writes in backend memory
- an overlay-aware `RelayExecutor` that turns `ref: null` into approve → overlay → `{ overlay }`
- a `/check` endpoint that applies a unified diff and runs the repro test and the suite locally

A browser-safe `RunnerBridge` pairs (ports 47410–47419) and services relay requests in order. Core is unchanged.

**Tech Stack:** Node 22, TypeScript, Fastify 5, `diff` (jsdiff 9), node:test, the existing runner (plain ESM).

Spec: `docs/superpowers/specs/2026-09-27-local-repo-exec-design.md`. Stacked on `feat/backend-hosting` (#37).

---

## File map

| File | Change |
|---|---|
| `runner/src/server.mjs` | `GET /file`; overlays scope (test ∪ fix − never), hash match and path safety; emit `done` after cleanup; `isTrackedInGit` via `execFileSync` |
| `runner/test/file-overlay.test.mjs` | New: git-backed runner tests for the above |
| `server/src/api/types.ts`, `server/openapi.yaml` | `RunnerCall`, `RunnerResponse`, `runner.request`, 3-way `ExecResult`, `check` kind, `LocalCheck`, `RunnerFile`, `CheckRequest` |
| `server/src/api/remote.ts` | `remoteMatches(remote, repo)`, browser-safe |
| `server/src/api/sse.ts` | `readSse(stream, onData)`: sequential SSE reader, browser-safe |
| `server/src/api/client.ts` | `check()`, `streamRun()` |
| `server/src/api/runner-bridge.ts` | `RunnerBridge` |
| `server/src/runs.ts` | Pending relay requests typed by kind; `requestRunner()`; `settleExec()` returns `'ok' \| 'unknown' \| 'invalid'`; `check` result |
| `server/src/staging.ts` | `StagedFiles` (base + fix layers, version) and `StagingStore` |
| `server/src/runner-relay.ts` | `RunnerRelay` (status/readFile/approve/createOverlay over the relay) |
| `server/src/repo-context.ts` | `RunnerContext`, `connectRunner()` |
| `server/src/runner-workspace.ts` | `createRunnerWorkspace(runner)` |
| `server/src/relay-executor.ts` | Options object `{ connectGraceMs, runner }`; `overlayId()`; `ref: null` → overlay or `{ head }` |
| `server/src/patch.ts` | `applyUnifiedDiff()`, `PatchError` |
| `server/src/local-check.ts` | `runLocalCheck()`, `localCheckHandler`, scope helpers |
| `server/src/handlers.ts` | `CheckHandler`, `CheckContext` |
| `server/src/core-factory.ts` | `runner?` in `CoreRequest` → `RunnerWorkspace` + overlay-aware relay |
| `server/src/app.ts`, `routes/issues.ts`, `routes/runs.ts` | `staging`, `check`, `connectRunner` options; `POST …/check`; acknowledge resets the stage; `settleExec` outcomes |
| `server/src/mock.ts`, `main.ts` | `mockCheckHandler`; mock relay also issues `GET /status`; wiring |
| `server/test/*` | Unit, route, bridge and end-to-end tests |
| `server/README.md`, `docs/…/pairing-ux.md` | Docs |

---

### Task 1: Runner — `GET /file`, overlay rules, `done` ordering, safe `isTrackedInGit`

**Files:** Modify `runner/src/server.mjs`. Create `runner/test/file-overlay.test.mjs`.

- [ ] **Step 1: Write failing tests** (`runner/test/file-overlay.test.mjs`). In `before()`, create a git repo in a temp dir:
  - `git init -q`, user config.
  - Files: `src/a.js` (`exports.a = 1;\n`), `test/ok.test.js`, and a `.reprise.yml` with `edit_scope.test: [test/**]`, `edit_scope.fix: [src/**]`, and `platforms.linux` whose `test.all` is `node --version` (shell `cmd` on win32, else `bash`), `pattern: "test/**"`.
  - Commit, then add remote `https://github.com/acme/calc.git`.
  - `startServer({ root, port: 47470, allowOrigins: [ORIGIN] })`, capturing the pairing code from `console.log`, then pair.

  Tests:
  - `GET /file?path=src/a.js` → 200 with `content`, `sha256` (sha256 of content) and `ref` (40-hex HEAD)
  - `GET /file?path=src/a.js&ref=<HEAD>` → 200
  - untracked file (write `src/untracked.js` without committing) → 404
  - `path=../x` → 400, `path=.git/config` → 400, `path=/etc/passwd` → 400
  - a directory (`path=src`) → 404
  - an unknown ref (`ref=deadbeef`) → 404
  - no token → 401
  - `/overlays` with a test-scope file (`test/new.test.js`), approved with its real sha256 → 200
  - `/overlays` with `.reprise.yml` (in `never` by default), approved → 403
  - `/overlays` with a file approved under a different sha256 → 409 `/does not match/`
  - `/overlays` with `src/../x.js` → 400
  - `POST /runs` (`mode: all`, `ref: { overlay }`), read its SSE until `done`, then immediately `POST /runs` again → 200 (not 409 busy)

- [ ] **Step 2: Run** `cd runner && node --test test/file-overlay.test.mjs`. Expected: FAIL (404 for `/file`, 403 for the test-scope overlay, …).

- [ ] **Step 3: Implement in `server.mjs`:**
  - `GET /file`, after the auth gate. Parse with `new URL(url, 'http://runner')`. Validate the path (relative, no `\`, no `..` segment, not `.git`, no drive letter) and the ref (`HEAD` or 7–40 hex). Resolve the ref with `git rev-parse --verify <ref>^{commit}`. Find the entry with `git ls-tree -l <sha> -- <path>`, requiring a `blob` line; its size field enforces a 1 MB cap (413). Read with `git show <sha>:<path>` (`execFileSync`, `maxBuffer`). Respond `{ path, ref: sha, sha256, content }`.
  - `/overlays`:
    - Reject absolute paths, `..` segments and `\` (400).
    - Reject paths matching `edit_scope.never` (default `['.github/**', '.reprise.yml', '.reprise/**']` when undefined) with 403.
    - Reject paths outside `[...test, ...fix]` with 403 (an empty list allows everything).
    - Reject any file whose approval is missing, or whose approved sha256 differs from `sha256(content)`, with 409.
  - `executeRun`'s `finally`: remove the worktree, then set `runData.done = true` and `busy = false`, then emit `done` and close the stream.
  - `isTrackedInGit`: use `execFileSync('git', ['ls-files', '--error-unmatch', '--', relPath], …)`.

- [ ] **Step 4: Run** `cd runner && node --test "test/**/*.test.mjs"`. Expected: all pass, including the existing suites.

- [ ] **Step 5: Commit** `feat(runner): GET /file, overlay scope/hash checks, done after cleanup`

---

### Task 2: Contract + relay generalization (`runs.ts`)

**Files:** Modify `server/src/api/types.ts`, `server/openapi.yaml`, `server/src/runs.ts`, `server/src/routes/runs.ts`. Tests: `server/test/runs.test.ts`, `openapi.test.ts`.

- [ ] **Step 1: Types.**
  - Add `RunnerCall`, `RunnerResponse { status; body }`, `RunnerFile { path; ref; sha256; content }` and `CheckRequest { diff }`.
  - Add `LocalCheck` exactly as in the spec.
  - `RunKind` gains `'check'`, and `RunStatus` gains `check: LocalCheck | null`.
  - `RunStreamEvent` gains `{ type: 'runner.request'; reqId; call: RunnerCall }`.
  - `ExecResult` gains `{ ok: true; status: number; body: unknown }`.
- [ ] **Step 2: OpenAPI.**
  - New schemas: `RunnerCall`, `LocalCheck`, `RunnerFile`.
  - `RunStreamEvent` gets a `runner.request` branch, and `ExecResult` gets a third branch.
  - `RunStatus` gains `check` and the `check` kind.
  - New path `POST /api/repos/{owner}/{repo}/issues/{n}/check`.
  - `POST /api/runs/{id}/exec/{reqId}` also lists `400` for an answer of the wrong kind.
- [ ] **Step 3: Tests first** (`runs.test.ts`):
  - `requestRunner` emits `runner.request` and resolves `{ status, body }` from `settleExec(reqId, { ok: true, status: 200, body })`.
  - `settleExec` returns `'invalid'` when an exec request gets a runner-shaped answer (and vice versa), and the request stays pending.
  - An unknown `reqId` returns `'unknown'`.
  - Update the existing assertions from `true/false` to `'ok'/'unknown'`.
  - `succeed({ check })` sets `status().check`.
- [ ] **Step 4: Implement.** Pending entries become `{ kind: 'exec' | 'runner'; resolve(v: unknown); reject }`, with one private `relay(kind, makeEvent, timeoutMs, token)` shared by `requestExec` and `requestRunner`. The route maps `settleExec` outcomes: `'unknown'` → 404, `'invalid'` → 400.
- [ ] **Step 5:** `cd server && npm test`. Expected: all pass.
- [ ] **Step 6: Commit** `feat(server): relay generic runner calls (runner.request) alongside exec.request`

---

### Task 3: Staging, runner relay, repo context, runner workspace

**Files:** Create `server/src/staging.ts`, `server/src/runner-relay.ts`, `server/src/api/remote.ts`, `server/src/repo-context.ts`, `server/src/runner-workspace.ts`. Tests: `staging.test.ts`, `repo-context.test.ts`, `runner-workspace.test.ts`, plus `test/helpers/fake-browser.ts`.

- [ ] **Step 1: `test/helpers/fake-browser.ts`.** `answerRelay(run, { runner?(call) → { status, body }, exec?(request) → RunResult[] })` subscribes to the run and settles each relay request with the handler's answer. A handler that throws posts `{ ok: false, error }`.
- [ ] **Step 2: Tests first.**
  - `StagedFiles`:
    - `write` goes to the base layer.
    - `setFix` replaces the fix layer.
    - `get` prefers fix.
    - `files()` merges the layers with fix winning.
    - `version` increments on every change.
  - `StagingStore.reset` returns an empty `StagedFiles`; `for` returns the same instance per `repo#issue`.
  - `remoteMatches` accepts `https://github.com/acme/calc(.git)`, `git@github.com:acme/calc.git` and `ACME/Calc`; it rejects `acme/calc2`, `other/calc` and `''`.
  - `connectRunner`:
    - fails fast with the "Open the Review UI…" message when no subscriber appears within `graceMs`
    - fails with "The runner is serving …" on a remote mismatch
    - skips the remote check when `checkRepo: false`
    - otherwise resolves `{ head, remote }`
  - `RunnerWorkspace`:
    - `readFile` returns staged content without a relay call.
    - Otherwise it calls `GET /file?path=…&ref=<head>`.
    - A 404 from the runner rejects.
    - `writeFile` stages the file and makes no relay call.
- [ ] **Step 3: Implement** per the spec's unit table. `RunnerRelay.call` turns non-2xx responses into `RunnerCallError(status, "Runner GET /file: <error>")`.
- [ ] **Step 4:** `npm test`. Expected: all pass.
- [ ] **Step 5: Commit** `feat(server): staging store, runner relay, same-repo check, runner-backed workspace`

---

### Task 4: Overlay-aware RelayExecutor + core factory

**Files:** Modify `server/src/relay-executor.ts`, `server/src/core-factory.ts`. Tests: `relay-executor.test.ts`, `core-factory.test.ts`.

- [ ] **Step 1: Tests first.**
  - The constructor takes `(run, timeoutMs, { connectGraceMs?, runner? })`; update the existing tests.
  - With a runner context and staged files, `run({ ref: null })` issues these relay requests in order: `POST /approve` for each staged file (sha256 of its content), then `POST /overlays { base: head, files }`, then `exec.request` with `ref: { overlay: <id> }`.
  - A second `run` with an unchanged stage reuses the overlay (no new approve or overlay calls). After `stage.setFix(...)`, a new overlay is created.
  - With a runner context and an empty stage, `ref: null` becomes `{ head }`.
  - An explicit `{ base }` ref passes through unchanged.
  - With no runner context, `ref: null` stays `null`.
  - `realCoreFactory` given a `runner` reads `.reprise.yml` through the relay (`core.config.load()` issues `GET /file?path=.reprise.yml`).
- [ ] **Step 2: Implement.** `overlayId()` is public; `/check` uses it to report `overlay_id`.
- [ ] **Step 3:** `npm test`. Expected: all pass.
- [ ] **Step 4: Commit** `feat(server): run staged changes as runner overlays; core reads the clone via the runner`

---

### Task 5: Patch application + local check

**Files:** Create `server/src/patch.ts`, `server/src/local-check.ts`. Modify `server/src/handlers.ts`, `server/package.json` (add `diff`). Tests: `patch.test.ts`, `local-check.test.ts`.

- [ ] **Step 1:** `cd server && npm install diff@^9`. Confirm `import { parsePatch, applyPatch } from 'diff'` type-checks under `moduleResolution: node`. If it doesn't, import from `diff/lib/index.js`, or add a local declaration.
- [ ] **Step 2: Patch tests first.**
  - Modify one file.
  - Two files in one diff.
  - A new file (`--- /dev/null`).
  - A deletion throws `PatchError` /not supported/.
  - A hunk that doesn't match throws `PatchError` naming the file.
  - A path with `..` throws.
  - An empty diff throws.
- [ ] **Step 3: Local-check tests first.** Use a scripted fake browser; the record is `mockRecord` with `repro.test_file = 'test/add.test.js'` and signature `{ kind: 'output_regex', pattern: 'BUG-ADD' }`.
  - **Fixed:** repro runs all exit 0 and the suite is the same on base and overlay → `FIX_VERIFIED`, `repro.fixed`, `files[].sha256` correct, `overlay_id` set.
  - **Still failing:** repro exits 1 with `BUG-ADD` in `output_tail` → `FIX_INCOMPLETE`.
  - **Regression:** a test that passed on base fails on the overlay → `REGRESSION_DETECTED`.
  - **No `test.all` configured:** `regression: null`.
  - **No staged repro test** and the runner's `/file` returns 404 for it → error /acknowledge this issue again/.
  - **No record** → /acknowledge the issue first/.
  - **A diff touching the repro test** → error /must not change the reproduction test/.
  - **A diff touching `.reprise.yml`** → error /edit_scope.never/.
  - A second check replaces the previous fix layer: the second overlay's files exclude the first diff's files.
- [ ] **Step 4: Implement** `runLocalCheck(ctx)` per the spec. It clears the fix layer, reads originals through `core.workspace`, applies the patch, checks scope, sets the fix layer, runs the repro, optionally runs the suite on base and on the overlay, then derives the verdict. It emits `status` events for each step. Also add `localCheckHandler`, plus `CheckHandler`/`CheckContext` in `handlers.ts`.
- [ ] **Step 5:** `npm test`. Expected: all pass.
- [ ] **Step 6: Commit** `feat(server): apply the agent's diff on a runner overlay and verify it locally`

---

### Task 6: Routes, app wiring, mock mode

**Files:** Modify `server/src/app.ts`, `routes/issues.ts`, `routes/runs.ts`, `mock.ts`, `main.ts`, `test/helpers/app.ts`. Tests: `issues-routes.test.ts`, `runs-routes.test.ts`, `app.test.ts`.

- [ ] **Step 1: Tests first.**
  - `POST …/check { diff }` in mock mode → 202, and the run succeeds with a `LocalCheck` that matches the schema.
  - A missing or empty diff → 400.
  - With a fake `connectRunner` that returns a context backed by a scripted fake browser, acknowledge resets the issue's stage, and check reaches the check handler with `runner` set.
  - When `connectRunner` rejects, the run fails with its message.
  - Mock relay mode (`MockWorld({ relay: true })` plus a lenient connector): the SSE carries a `runner.request` (`GET /status`) before the `exec.request`. Update the existing relay round-trip test to answer both.
  - The exec endpoint returns 400 for a runner-shaped answer to an exec request.
- [ ] **Step 2: Implement.**
  - `AppOptions` gains `check: CheckHandler`, `staging?: StagingStore` and `connectRunner?: (run, repo, stage) => Promise<RunnerContext | undefined>`.
  - Acknowledge does `stage = staging.reset(repo, issue)`, then `runner = await connectRunner?.(…)`, then `coreFactory({ …, runner })`.
  - Check does the same with `staging.for(repo, issue)`, then `run.succeed({ check })`.
  - `main.ts`:
    - Real mode: `connectRunner` with `checkRepo: true`, plus `localCheckHandler`.
    - Mock mode: `mockCheckHandler`, and a connector with `checkRepo: false` only when `REPRISE_MOCK_RELAY=1`.
- [ ] **Step 3:** `npm test`. Expected: all pass.
- [ ] **Step 4: Commit** `feat(server): POST /check, runner connection per run, mock check`

---

### Task 7: Browser bridge + client additions

**Files:** Create `server/src/api/sse.ts`, `server/src/api/runner-bridge.ts`. Modify `server/src/api/client.ts`. Test: `runner-bridge.test.ts`, using a fake runner built on `node:http`.

- [ ] **Step 1: Tests first.**
  - `readSse` splits `data:` blocks across chunk boundaries, ignores `:` comments, and awaits each handler in order.
  - `pair` skips a closed port, pairs on the next one, and remembers the base and session.
  - A wrong code → `RunnerError('wrong_code')`; locked → `'locked'`.
  - No ports answering → `'not_found'` with a message mentioning 47410–47419.
  - `readFile` sends `Authorization: Bearer <session>`.
  - `sameRepo('acme', 'calc')` is true for the paired remote and false otherwise.
  - `attach`:
    - Against the mock server in relay mode with a fake runner, it answers `runner.request GET /status` and `exec.request` (fake `/runs` plus SSE `result` then `done`), and resolves with the final `RunStatus` (`succeeded`).
    - A `runner.request` outside the allow-list (inject `{ method: 'POST', path: '/pair' }` via a crafted run) is answered with `{ ok: false, error: /not allowed/ }`.
    - Requests are processed sequentially: the second request's runner call starts only after the first request's answer was posted.
- [ ] **Step 2: Implement** `readSse`, `RepriseApi.streamRun(id, handler, signal?)`, `RepriseApi.check()` and `RunnerBridge`.
- [ ] **Step 3:** `npm test && npm run lint`. Expected: all pass.
- [ ] **Step 4: Commit** `feat(server): browser RunnerBridge (pairing on 47410–47419, sequential relay servicing)`

---

### Task 8: End-to-end test with the real runner

**Files:** Create `server/test/e2e-runner.test.ts`.

- [ ] **Step 1: Write the test.**
  1. Build a temp git repo with remote `https://github.com/acme/calc.git` and these files:
     - `src/calc.js` (bug: `a - b`)
     - `test/other.test.js` (passes)
     - `.reprise.yml`: `edit_scope.test: [test/**]`, `edit_scope.fix: [src/**]`, `fix.quick_runs: 2`, `platforms.linux` running `node --test --test-reporter=junit --test-reporter-destination=junit.xml {file}` and the same for `"test/**/*.test.js"` as `all`, `report_path: junit.xml`.
  2. Start the real runner (`startServer`, imported via `new Function('s', 'return import(s)')`) on 47460, capturing the pairing code.
  3. Build an app with `realCoreFactory` plus an in-memory store, seeded with the record (`test/add.test.js`, signature `BUG-ADD`, platform `linux`) and a staged `test/add.test.js`. Use the real `connectRunner` with `checkRepo: true` and `localCheckHandler`, then listen.
  4. `RunnerBridge({ ports: [47460], fetchImpl: withOrigin })` pairs.
  5. `api.check(fixDiff)` + `bridge.attach()` → `FIX_VERIFIED`, `repro.fixed`, `regression.blocking` empty.
  6. `api.check(noopDiff)` (changes nothing that matters) + `attach` → `FIX_INCOMPLETE`.
  7. The clone is untouched: `git status --porcelain` is empty, HEAD is unchanged, and `src/calc.js` still has the bug.
- [ ] **Step 2:** `npm test`. Expected: pass. Also run `npx -p node@22 node --test out/test/e2e-runner.test.js`.
- [ ] **Step 3: Commit** `test(server): end-to-end local check through the real runner`

---

### Task 9: Docs + final verification

- [ ] **Step 1:**
  - `docs/superpowers/specs/2026-09-27-pairing-ux.md`: the pairing UX from the spec, expanded with the error copy.
  - `server/README.md`: the relay section (both kinds, ordering, allow-list), `/check`, staging, and the bridge usage snippet.
- [ ] **Step 2:** Run server `typecheck`/`lint`/`test` (Node 24 and Node 22), `runner` tests, and `core` tests. Build the Docker image.
- [ ] **Step 3: Commit** `docs: pairing UX spec and local-execution notes`
