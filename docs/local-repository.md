# Local repository import and execution (pivot #31)

Import selects an existing Git working repository by starting a runner against it and pairing the application with that runner. The browser never receives or resolves an arbitrary OS path. There is no clone, IDE dependency, or server-side execution.

## Select the repository

Requires Node.js 22+, Git, and the platform toolchain used by the repository.

```sh
node runner/reprise-runner.mjs --root '/path/to/existing repository' --allow-origin http://localhost:8080
```

Use the application's actual origin. The runner validates the directory, requires the repository root and a committed HEAD, and reads a version 3 `.reprise.yml` with at least one configured test/lint platform. It supports local Git worktrees and repositories without a remote. GitHub issue/PR features still require a GitHub origin and authentication; local execution does not.

A relative `--root` resolves against the runner process's starting directory. Platform `cwd`, test paths, and `report_path` are relative to that repository root. The runner resolves `{file}` to the selected test's absolute path so commands still work when `cwd` is a subdirectory. Configured working directories must exist. Absolute paths, traversal, symlinks, and Git metadata access are refused at the file boundary.

## Application integration

The core package exports:

```ts
const imported = await importLocalRepository({
  auth,                 // existing AuthService adapter for GitHub features
  views,                // existing host UI adapter
  pairingCode,          // entered by the user from the runner terminal
  runnerPort: 47410,    // optional; probes this port and the following nine
  expectedRemote,      // optional same-repository check
  confirmChanges: async files => showApproval(files),
});
if (!imported.ok) throw new Error(imported.error);
const { services, repository } = imported.value;
// repository contains root_name, remote, head, host_os, platforms and busy.
// services.config is loaded; workspace reads/writes go through the paired runner.
```

`confirmChanges` is supplied by the host. It receives repository-relative paths and proposed bytes; return true only after user approval. Imported workspace writes first register the exact SHA-256 through `/approve`, then send those bytes to `/file`. Writes are refused while execution is active. Call `services.runnerClient.disconnect()` when the host closes or replaces an imported workspace.

Browser fetch supplies the Origin header automatically. A Node host must supply the explicitly allowed Origin through its HTTP transport. No origin is trusted implicitly.

Read-only `GET /file?path=...` and approved `POST /file` require the paired session and allowed origin. File data uses base64 to preserve bytes. Reads and writes are constrained to `edit_scope.test` or `edit_scope.fix`, minus `edit_scope.never`; the configuration file is a read-only exception so the core can initialize. With no allowed scopes, repository files are inaccessible. File reads are limited to 1 MB; request bodies retain the runner's existing 1 MB limit.

GitHub repository detection uses paired metadata instead of reading `.git/config`, which also handles imported Git worktrees correctly.

## Execute locally

Use `services.executors.local.run(request, cancellationToken, onEvent)` for the existing `RunRequest`/`RunResult` contract. A null ref executes in the imported working repository. Output events include stdout and stderr; `output_tail` contains the last 200 lines, and results preserve exit status, timeout, duration, and parsed test reports. Transport/refusal errors reject the run; cancellation terminates the active process tree and rejects as cancelled. A truncated event stream fails instead of waiting indefinitely.

To verify a proposed fix without changing the source checkout:

```ts
const results = await runLocalOverlay(
  services,
  { base: repository.head, files: proposedFiles }, // { path, content } UTF-8 files
  { platform: 'linux', mode: 'single', test_path: 'tests/repro.cjs', runs: 3 },
  cancellationToken,
  onEvent,
  async files => showApproval(files),
);
```

The helper snapshots the proposal, carries the current reproduction test (including uncommitted generated tests), awaits approval for exact hashes, registers `/overlays`, and delegates to the same local executor with `{ overlay: id }`. A fix cannot replace the reproduction test. The runner creates an isolated temporary worktree from a locally available commit, applies scoped contents, executes, and removes the worktree before reporting completion. It never fetches, commits, pushes, or opens a PR. Only explicitly supplied files plus the reproduction test are carried over; other uncommitted changes and untracked dependencies are not copied to a worktree.

The application UI and agent workstreams must call these exported helpers and provide approval rendering. This pivot supplies their local import/execution integration; it does not add a UI framework, change provider behavior, or automate PR publication.

## Incorporated fixes and validation

- #16: initial and revised reproduction tests await runner approval and stop on refusal. No execution races with a fire-and-forget approval request.
- #19: pairing probes ten ports from the host-supplied start, remembers the responding port, and stops on wrong-code/lockout responses.
- Tests cover real repository import, scoped reads and approved writes, uncommitted tests, isolated overlays, stdout/stderr and nonzero status, worktree cleanup, cancellation, bad roots, path escapes, symlinks, approval ordering, port discovery, mismatch, and truncated streams.

The runner remains dependency-free at runtime. Build its single-file distribution with `npm ci --prefix runner` then `npm run build --prefix runner`; esbuild is a build-only dependency. CI checks the emitted program's syntax and `--help`, not just whether a file was written.
