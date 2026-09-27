# Local repo import + local execution — design (issue #31)

Part of the pivot epic #27. Builds on the backend (#30, `server/`) and the runner (`runner/`). The user's repository stays on their machine. The Reprise Runner is the local bridge. The agent's fix is applied and tested on a runner-created worktree, and it leaves the machine only as a PR (#34).

## Problems this fixes

1. **Acknowledging with a generated test fails on the hosted backend.** Core's test stage writes the generated test through `workspace.writeFile`. The backend's GitHub `FileSystem` is read-only, so the stage ends in `NEEDS_INFO`. Even with a successful write, trials run with `ref: null`, meaning the runner's working copy, where the file doesn't exist.
2. **Core's `/approve` wiring (#16) never runs on the backend.** It is guarded by `runnerClient.isPaired()`, which is false because the browser, not the backend, pairs with the runner.
3. **No path takes the agent's diff to the runner.** Core's `FixService.runQuickCheck` also runs with `ref: null`, and nothing in core creates an overlay.
4. **Runner gaps:**
   - There is no way to read repository files for display.
   - `/overlays` only accepts paths inside `edit_scope.fix`, so an overlay can't carry the reproduction test.
   - `/overlays` checks that an approval exists but not that its hash matches.
   - `done` is emitted before worktree cleanup and before `busy` is cleared, so an immediate next `/runs` can get a 409.
   - `isTrackedInGit` interpolates the path into a shell command.

## Decisions

| Question | Decision |
|---|---|
| Where code for display comes from | **The runner.** A new `GET /file?path=&ref=` returns `git show <ref>:<path>` for git-tracked files only. The UI reads it directly from the browser, and the backend reads it through the relay. |
| How changes stay local | **Staged overlays.** Inside a run, core's `FileSystem` is a `RunnerWorkspace`. Reads go to the runner. Writes are staged on the backend and never touch the clone. A run with `ref: null` becomes approve-all → `POST /overlays { base: HEAD, files }` → run `{ overlay }` on a worktree. |
| Where staged files live between runs | **Backend memory**, keyed by `repo#issue`. If the server sleeps or restarts, the user acknowledges again, and the error message says so. |
| How the backend reaches the runner | **The existing browser relay, generalized.** Alongside `exec.request` there is a new `runner.request { method, path, body }`. The browser allows only `GET /status`, `GET /file`, `POST /approve` and `POST /overlays`, and **runs relay requests one at a time, in order**. |
| Same-repo check | At the start of every relayed run, `GET /status` must report a remote matching `owner/repo`, otherwise the run fails. That HEAD sha is the overlay base. |
| Port discovery (#19) | The browser bridge's `pair()` probes 47410–47419. |
| Core changes | **None.** The stages keep calling `workspace.writeFile` and `executor.run({ ref: null })`, and the server maps those onto overlays. Core's `FixService` quick check is superseded in the pivot flow by `/check`; this is noted on #32/#34. |

## Runner changes (`runner/src/server.mjs`)

- **`GET /file?path=<rel>&ref=<sha?>`** (session + Origin required):
  - Rejects absolute paths, `..`, `.git/`, and paths not tracked at that ref (`git ls-tree`).
  - Resolves `ref` to a full sha, defaulting to HEAD.
  - Reads with `execFileSync('git', ['show', `${sha}:${path}`])` and caps at 1 MB.
  - Returns `200 { path, ref, sha256, content }`, or `404` if missing, `400` if the path is invalid, `413` if too large.
- **`POST /overlays`:**
  - Scope is `edit_scope.test ∪ edit_scope.fix`, minus `edit_scope.never`. An empty `test ∪ fix` means everything is allowed except `never`.
  - Each file's approved sha256 must equal the sha256 of `content`; otherwise `409`.
- **`executeRun`** removes the worktree and clears `busy` *before* emitting `done`.
- **`isTrackedInGit`** uses `execFileSync` (no shell).

## Server changes

### Contract (`api/types.ts`, `openapi.yaml`)

```ts
type RunnerCall =
  | { method: 'GET'; path: '/status' }
  | { method: 'GET'; path: `/file?${string}` }
  | { method: 'POST'; path: '/approve'; body: ApproveRequest }
  | { method: 'POST'; path: '/overlays'; body: OverlaysRequest };

type RunStreamEvent = … | { type: 'runner.request'; reqId: string; call: RunnerCall };

// Answer to either kind of relay request, posted to /api/runs/:id/exec/:reqId:
type ExecResult =
  | { ok: true; results: RunResult[] }          // exec.request
  | { ok: true; status: number; body: unknown }  // runner.request (any HTTP status)
  | { ok: false; error: string };                // transport failure (runner unreachable…)

type RunKind = 'acknowledge' | 'propose' | 'check';

interface LocalCheck {
  base_sha: string;
  overlay_id: string;
  files: Array<{ path: string; sha256: string }>;
  repro: { test_file: string; runs: number; failed: number; fixed: boolean };
  regression: VerificationRegression | null;    // null when test.all is not configured
  verdict: 'FIX_VERIFIED' | 'FIX_INCOMPLETE' | 'REGRESSION_DETECTED';
}
// RunStatus gains `check: LocalCheck | null`.

// POST /api/repos/:owner/:repo/issues/:n/check  { diff: string }  → 202 { runId }
```

### Units

| File | Responsibility |
|---|---|
| `runner-relay.ts` | `RunnerRelay`: typed wrappers over `run.requestRunner(call)` covering `status()`, `readFile(path, ref)`, `approve()` and `createOverlay()`. Non-2xx responses become errors carrying the runner's `error`. |
| `staging.ts` | `StagingStore`: an in-memory map from `repo#issue` to a map of path → content. `put`, `get(key)`, `files(key)`, `clear`. |
| `runner-workspace.ts` | `createRunnerWorkspace({ relay, head, stage })`: a `FileSystem` whose reads check the stage first, then `relay.readFile(path, head)`, and whose writes go into the stage. |
| `relay-executor.ts` | `RelayExecutor(run, timeout, { relay, stage, head })`: for `ref: null` with a non-empty stage it approves every file, creates the overlay (cached until the stage changes) and runs with `{ overlay }`. It gains `overlayFor()`, which `/check` reuses. |
| `repo-context.ts` | `connectRepo(relay, repo)`: runs `GET /status` and checks that the remote matches `owner/repo`, accepting `https://github.com/o/r(.git)` and `git@github.com:o/r(.git)`, case-insensitive. Returns `{ head, remote }`. |
| `patch.ts` | `applyUnifiedDiff(diff, read)` → `[{ path, content }]`, built on `diff`'s `parsePatch`/`applyPatch`. Handles new files (`/dev/null`) and strips `a/`/`b/`. Deletions are rejected in this issue. A hunk that fails to apply throws `PatchError(file)`. |
| `local-check.ts` | `runLocalCheck(ctx)`: loads the record, requires a staged repro test, applies the diff, checks edit scope, stages, runs the repro on the overlay (`fix.quick_runs` runs, default 3), optionally runs `test.all` on `{ base }` and on the overlay, then returns a `LocalCheck`. |
| `core-factory.ts` | For relayed runs (acknowledge, check) it builds core on a `RunnerWorkspace` once `connectRepo` has resolved HEAD. Outside runs it keeps the GitHub `FileSystem` (issue list, record). |
| `routes/issues.ts` | Adds `POST …/check`. Acknowledge clears the issue's stage before running. |
| `mock.ts` | Mock `check` returns a canned `FIX_VERIFIED` result. With `REPRISE_MOCK_RELAY=1`, mock acknowledge and check also issue `runner.request`s. |

### Why the stage is keyed by issue

Acknowledge writes the generated test into `stage[repo#issue]`. A later `/check` on the same issue needs that same test in its overlay together with the fix. A fresh acknowledge clears the stage first, so an old fix never carries over.

## Browser runner bridge (`server/src/api/runner-bridge.ts`)

This is browser-safe: it uses only `fetch`, with no Node APIs. #33 wires it into the UI.

```ts
class RunnerBridge {
  constructor(opts?: { ports?: number[]; fetchImpl?: typeof fetch });
  pair(code: string): Promise<PairResponse>;       // probes 47410–47419; keeps the session in memory
  status(): Promise<StatusResponse>;
  sameRepo(owner: string, repo: string): boolean;  // against the last pair/status
  readFile(path: string, ref?: string): Promise<RunnerFile>;
  attach(api: RepriseApi, runId: string): Promise<void>; // follow the run; run relay requests in order
  disconnect(): void;
}
```

- `attach` reads the run's SSE with `fetch` and processes relay events **sequentially**:
  - `exec.request` → `POST /runs`, then follow `/runs/:id/events` until `done`, then post `{ ok: true, results }`.
  - `runner.request` → check the allow-list, make the call, then post `{ ok: true, status, body }`.
  - A network failure → post `{ ok: false, error }`.
  - It resolves on `run.done` / `run.failed`.
- Pair errors map to typed messages: no runner on any port, wrong code, pairing locked, origin not allowed.

## Pairing UX (spec for #33)

1. **Not connected:** show "Start the runner: `node reprise-runner.mjs --root <your clone> --allow-origin <this site>`" and a 6-digit code field.
2. **Connecting:** probe ports; on failure show the typed error, e.g. "No runner found on ports 47410–47419" or "Wrong code (the runner shows a new one after 5 minutes)".
3. **Connected:** show the repo remote, HEAD (short sha) and host OS. If `sameRepo` is false for the selected repository, block Acknowledge/Test with "The runner is serving `<remote>`, not `<owner/repo>`."
4. **During a run:** call `attach(api, runId)` before or right after starting the run; the backend waits up to 10 s for the browser to attach. Show runner output lines.
5. Keep the runner session in memory only. A reload means pairing again, and the runner prints a new code.

## Testing

- **Runner:**
  - `/file` happy path, untracked 404, `..`/absolute 400, no auth 401.
  - `/overlays` accepts a test-scope file; rejects `never` (403) and a hash mismatch (409).
  - `done` is emitted after cleanup: a second `/runs` immediately after `done` is not 409.
- **Server unit tests:** `patch` (modify, add, fail), `connectRepo` (remote forms, mismatch), `RunnerWorkspace`, the `RelayExecutor` overlay flow (approve → overlay → overlay ref; overlay reused while the stage is unchanged), `StagingStore`.
- **Server routes:**
  - `/check` in mock mode, and against a scripted fake browser that answers relay requests.
  - `/check` without a staged test fails with the re-acknowledge message.
  - The contract check validates every new event and response against `openapi.yaml`.
- **Bridge:** against a fake runner (port probing, the allow-list, sequential processing).
- **End to end (`server/test/e2e-runner.test.ts`):**
  1. Create a temp git repo with remote `https://github.com/acme/calc.git`, a `.reprise.yml` for the host platform (`node --test` with the junit reporter), a buggy `calc.js` and a passing suite.
  2. Start the **real runner** (`startServer`) and a real server. The server uses a real core with fake GitHub and store, seeded with a record whose repro test is staged.
  3. The bridge pairs using the code the runner prints.
  4. Assert that `/check` with a one-line fix diff ends in `FIX_VERIFIED`, and that the clone's working tree and HEAD are unchanged.

## Out of scope

- Server-side cloning.
- The pairing UI itself (#33).
- Applying deletions from a diff.
- Persisting staged files across a server restart.
- Changing core's `FixService`.
