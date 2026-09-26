# Reprise Runner Spec

Implements R-7 (runs on the user's machine and devices) for the browser IDE (R-16). Decisions: PD-15, PD-17, PD-18, PD-24. ADR-11. Diagram: `runner-pairing.mmd`. Gate: G-23.

## What it is

A Node.js program, released as one file `reprise-runner.mjs` (PD-20). It runs the local executor's adapters and the driver fallback for one repository clone and one paired IDE tab. It has no dependencies beyond Node.js except what the driver fallback needs (Appium and WebdriverIO, installed on first use of a driver, with the user's confirmation in the runner's console).

Node.js version: the same major the team records in `demo-apps.md` (Machines table), at least 22 (V-1).

## Starting it

```
node reprise-runner.mjs --root <path to the clone> [--port 47410] [--allow-origin https://OWNER.github.io]
```

- `--root` is required and must contain `.reprise.yml`. The runner refuses to start otherwise.
- `--port` defaults to `47410`; if busy, the runner tries the next 9 ports and prints the one it used. The IDE's `connect-src` allows `http://127.0.0.1:47410` to `47419` (`browser-runtime.md`).
- `--allow-origin` defaults to the Pages origin; a second value may be added for local development of the IDE (for example `http://localhost:8080`).
- On start it prints: the root, the repository remote and `HEAD`, the platforms this machine can run (from the adapters' prerequisite checks), the port, and a **pairing code** (6 digits, valid 5 minutes, single use).

## Network rules

- Binds `127.0.0.1` only. Never `0.0.0.0`, never a LAN address.
- Every request must carry an `Origin` in the allow-list; otherwise `403`, no body. The exact `Origin` the web-worker extension host sends is recorded here from gate G-23: **(fill in)**.
- CORS: `Access-Control-Allow-Origin` is the request's allowed origin (never `*`); preflight answers include `Access-Control-Allow-Private-Network: true` if G-23 shows Chrome or Edge require it.
- After pairing, every request needs `Authorization: Bearer <session token>`. The token is 32 random bytes, kept only in memory, and a new pairing replaces the old one (one tab at a time).
- Request bodies over 1 MB are rejected.

## API

All bodies are JSON. Field names are contracts.

| Method and path | Body | Response | Notes |
| --- | --- | --- | --- |
| `POST /pair` | `{ code }` | `{ session, runner_version, root_name, remote, head, host_os, platforms: [{ platform, local_possible, missing: [] }] }` | Code must be unused and unexpired; 5 wrong codes lock pairing until restart |
| `GET /status` | — | Same as `/pair` without `session`, plus `busy` | Also used as a heartbeat every 30 s |
| `POST /approve` | `{ path, sha256 }` | `{ ok }` | Records that the user approved this exact test file in the IDE (PD-10) |
| `POST /overlays` | `{ base: sha, files: [{ path, content }] }` | `{ overlay_id }` | A fix candidate applied on a worktree of `base` (`fix-and-verify.md` §4). Every file's SHA-256 must already be approved through `/approve`; paths must be inside `edit_scope.fix` of the runner's `.reprise.yml` |
| `POST /runs` | `{ platform, mode: "single" \| "all" \| "lint", test_path, runs, ref: null \| { base: sha } \| { head: sha } \| { overlay: overlay_id } }` | `{ run_id }` | See checks below |
| `GET /runs/<id>/events` | — | Server-sent events: `output` (redacted lines), `result` (one `RunResult` per run), `done`, `error` | Streams to the Runs view |
| `DELETE /runs/<id>` | — | `{ ok }` | Kills the whole process tree |
| `POST /artifacts` | `{ url }` | The unpacked `results/` as JSON | Only if G-24 needs the fallback; `url` must be an `https://api.github.com/` artifact URL; the IDE sends the token in this one request's `Authorization` header only if the team accepts that risk (record the decision here) |

The IDE never sends a command, a shell, a working directory or environment variables (PD-18).

## Checks on `POST /runs`

1. `platform` is in `.reprise.yml` under `platforms` and `local_possible` is true on this machine.
2. `mode: "single"`: `test_path` is relative, has no `..`, is inside `--root`, matches `platforms.<p>.test.pattern`, and either is tracked in git at `HEAD` unchanged (a user test) or its current SHA-256 equals an approved `(path, sha256)` pair (a provided test). Otherwise `409` "Test not approved".
3. `runs` is between 1 and `verify.max_runs` from `.reprise.yml`.
4. `ref`: `null` runs in `--root` as it is on disk. `{ overlay }` runs in that overlay's own worktree (one per candidate; removed when the round ends). `{ base }` or `{ head }` runs in a worktree of that SHA (PD-24), created with `git worktree add --detach` under the runner's cache folder (`~/.reprise-runner/worktrees/<repo>/<sha>`), after `git fetch` of that SHA with the user's own git setup. For `head`, the approved reproduction test is copied into the worktree if absent (as `fix-and-verify.md` requires). Worktrees are removed when the verification finishes or the runner exits.
5. One run at a time per runner unless the adapter declares parallel runs safe.

## Executing

Exactly as the local executor in `test-execution.md`: shell from `platforms.<p>.shell`, working directory `platforms.<p>.cwd` inside the root or worktree, environment filtered (PD-15, `security.md`), timeout with process-tree kill, report file deleted before each run, results parsed into `RunResult`s. `host_os`, `device` and `runner_version` are filled by the runner.

## Console

The runner's own terminal shows every accepted request in one line (`run 3: android single tests/LoginTest.kt x20`), every refusal with its reason, and the first-time environment filter summary. It never prints the session token.

## Same repository check

After pairing, the IDE compares the runner's `remote` and `head` with what it reads from `.git/` in the opened folder (gate G-27). If the remotes differ, the IDE refuses to use the runner. If only `HEAD` differs, it warns "The runner's folder is on a different commit" and lets the user continue.

## Stopping

Ctrl+C stops the runner, kills running processes and removes worktrees. The IDE shows "Runner disconnected" after two missed heartbeats and marks active runs `ERROR` ("runner disconnected").
