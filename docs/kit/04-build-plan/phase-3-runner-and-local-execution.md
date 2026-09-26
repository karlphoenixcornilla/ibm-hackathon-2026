# Phase 3 — Reprise Runner and local execution on all five platforms

**Serves:** R-6, R-7 (local), R-8 (repository command), R-10, R-16. **Specs:** `local-runner.md`, `test-execution.md`, `reprise-config.md`, `security.md` (T11 to T15, environment filter). **Gates:** G-14, G-23. **Input:** `00-context/demo-apps.md`.

One person writes the runner core first; then each platform owner does the adapter work on their machine, with their app.

## Task prompt (runner core)

```
First, resolve gate G-23: write a 30-line Node.js HTTP server on 127.0.0.1 with CORS for the IDE origin and Access-Control-Allow-Private-Network: true on preflight, and call it with fetch from the Reprise web extension served from the deployed or dev /ide/ URL, in Chrome and in Edge. Record whether it works, any browser prompt, and the exact Origin header received, in docs/kit/02-specs/local-runner.md. If it fails, stop and report; do not pick a fallback without the team.
Then implement runner/ exactly as docs/kit/02-specs/local-runner.md specifies: --root/--port/--allow-origin, 127.0.0.1 binding, Origin allow-list, pairing code and session token, the HTTP API (/pair, /status, /approve, /runs, /runs/<id>/events, DELETE /runs/<id>), all checks on POST /runs, the console lines, and worktrees for base/head refs (PD-24). Implement the shared adapter layer and the local executor from test-execution.md inside the runner: prerequisite checks, shell and timeout handling, process-tree kill, report deletion before each run, the environment filter from security.md, and the RunResult format with runner_version.
In the extension, implement runner-client/ and the local executor: Connect Runner (port and code), same-repository check, heartbeat, /approve after each approved write, streaming events into the Runs view and an output channel, and "Reprise: Show Machine Capabilities".
Tests: every refusal case in local-runner.md (wrong Origin, no token, wrong code, lockout, path outside root, unapproved test, platform not runnable), RunResult parsing, timeout handling, environment filtering, trial outcome classification.
```

## Task prompt (per platform)

```
For the <PLATFORM> demo app described in docs/kit/00-context/demo-apps.md, write its .reprise.yml platforms.<platform> section using only the commands and paths recorded there. If a needed value is missing from demo-apps.md, stop and ask. Start the runner with --root at the local clone, pair it from the IDE in Chrome or Edge, run the app's full suite and one single test through Reprise, and confirm per-test results are parsed (gate G-14; write a runner-side parser if the framework has no JUnit output).
```

## Acceptance

On each of the four machines, with the IDE open in Chrome or Edge and the runner paired, "Show Machine Capabilities" reports its platform(s) as runnable, and a single test and the full suite of that platform's demo app run through Reprise with per-test results in the output channel. A request from a page on another origin is refused by the runner.
