# T2 — Reprise Runner, Platform Adapters and Local Executor

**Branch:** `track/t2-runner` from `base-v1`. **Kit phases:** 3 and 8 (R-6, R-7, R-8, R-10).
**Kit inputs:** `04-build-plan/phase-3-runner-and-local-execution.md`, `phase-8-driver-fallback.md`, `02-specs/local-runner.md`, `test-execution.md`, `security.md` (PD-15 env filter), `reprise-config.md`, `00-context/demo-apps.md` (**must be filled**), gates G-12, G-13, G-14, G-23.

**Owns:** `runner/**`, `extensions/reprise/src/runner-client/**`, `extensions/reprise/src/exec/local/**`, and the `.reprise.yml` in each demo app repository.
**Must not touch:** anything else in the extension. Import only `contracts/runner-api.ts`, `contracts/execution.ts` and `util/`.

**Sub-parallelism:** one person or session writes the runner core (tasks 1–4). After task 4, one session per platform machine takes task 5 for its own adapter. Each works only in `runner/src/adapters/<platform>.mjs`, and those files don't conflict.

## Tasks
1. **G-23 first (a stop gate).** Deploy a minimal runner, then call it from the web build's worker `fetch` in Chrome and Edge. Record the `Origin`, whether PNA/LNA prompts appear, and whether `Access-Control-Allow-Private-Network` is needed. If G-23 fails, implement the fallback it names (https localhost or a postMessage pop-up) and record which one was used.
2. **server.mjs**:
   - binds `127.0.0.1` only
   - Origin allow-list, CORS without `*`, 1 MB body limit
   - `/pair` with a one-time code shown in the console, lockout after 5 wrong codes, and a 32-byte in-memory session token
   - `/status`, `/approve`, `/overlays`, `/runs`, `/runs/<id>/events` (SSE), `DELETE /runs/<id>`
   - every check listed under "Checks on `POST /runs`"
3. **config.mjs, repo.mjs, env.mjs**:
   - read `--root/.reprise.yml` only; the tab never sends commands (PD-18)
   - remote and HEAD detection, worktrees under `~/.reprise-runner/worktrees/<repo>/<sha>` (PD-24)
   - the PD-15 credential-stripping environment filter, with its summary printed once
4. **Execution core**: shell per `platforms.<p>.shell`, `cwd`, timeout with **process-tree kill**, deleting the stale report before each run, redacted output streaming, and building the `RunResult` exactly as in `test-execution.md`. Write a JUnit XML parser, shared with CI through an export path that T4's `run-loop.mjs` imports (`runner/src/shared/`).
5. **Adapters** `adapters/{windows,android,ios,macos,linux}.mjs`: prerequisite checks, `local_possible` and `missing[]`, the repository command, and result parsing (G-14 per app). Each one is tested on its real machine with that platform's demo app.
6. **Driver fallback** (kit phase 8): `drivers/` runs WebdriverIO against local Appium 2 (PD-8) for `windows`, `uiautomator2`, `xcuitest` and `mac2`. Linux gets none unless G-13 passes (PD-9). Method selection follows "Choosing the method".
7. **runner-client/** (extension): pairing UI flow, 30 s heartbeat, the same-repository check (remote mismatch means refuse, HEAD mismatch means warn), and an SSE reader.
8. **exec/local/**: `Executor` implementation over the runner client. Emits events for the Runs view, and reports availability ("Connect Runner" when unpaired).
9. Release bundling script `runner/build.mjs`, producing a single-file `reprise-runner.mjs` with its SHA-256. The workflow that publishes it belongs to T5.

## Acceptance
- On each of the four machines: pair from the IDE, then run a single demo test ×5 through the runner. The Runs view streams output and the `RunResult`s are correct.
- Refusals are tested:
  - wrong Origin → 403
  - unapproved test → 409
  - `..` path → refused
  - a request containing a command field → ignored or refused
  - the runner is unreachable from the LAN
- A timeout kills the process tree (tested with a sleeping child process).
- Running `node --test` in `runner/` passes. Extension unit tests for the client and executor use a mock server.
- G-12, G-13, G-14 and G-23 results are recorded in `verification-gates.md` and `local-runner.md`.

## Stop conditions
- `demo-apps.md` has empty cells → stop; the team must fill them in.
- G-23 fails and neither fallback works → stop and escalate. The local executor becomes unavailable and the demo relies on CI (T4).
