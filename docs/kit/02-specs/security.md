# Security Spec (v3)

v3 moves the IDE into the browser and adds the Reprise Runner. T1 to T9 are v2's threats, adapted; T10 to T16 are new.

## Threat model

| # | Threat | Control | Residual risk |
| --- | --- | --- | --- |
| T1 | A provided (stub or AI) test or fix does something harmful when run on the user's machine | Diff view and explicit approval before anything is written (PD-10); `edit_scope` enforcement; runner runs only approved test files with a matching SHA-256 (`local-runner.md`); credentials removed from the test environment (PD-15); CI executor available for isolation on ephemeral runners | An approved harmful test runs with the user's privileges; there is no sandbox for native GUI apps locally |
| T2 | Prompt injection in issue text (relevant once real providers exist) | Providers cannot execute commands; outputs are schema-validated; file proposals go through T1 controls; issue text wrapped in `<untrusted_report>` with the closing tag escaped | Misleading but valid output, caught by the user's review |
| T3 | GitHub token leakage | Fine-grained token limited to the target repositories (PD-23); stored only in the workbench's secret storage; sent only to `api.github.com`; never sent to the runner, providers or test processes; outbound text scanned for the token value and `ghp_`, `ghs_`, `gho_`, `github_pat_` patterns, write aborted if found | Any script running in the IDE origin could read it (see T10) |
| T4 | Provider API keys (future) leak | Stored in secret storage; redacted like T3; never in records | Same origin exposure as T3 |
| T5 | Stub fixtures changed by a proposed fix to fake a pass | `.reprise/**` is in `edit_scope.never` | None |
| T6 | A fix weakens or deletes tests | Reproduction test hash check; `REMOVED` blocks verification | None |
| T7 | CI workflow abused | `reprise-run.yml` has `permissions: contents: read`, `persist-credentials: false`, only `workflow_dispatch` (only users with write access can dispatch); no secrets used | None known |
| T8 | XSS in webviews or dashboard from issue text | `textContent` only; strict CSP in every webview (nonce-based scripts, no inline handlers) and on the dashboard | None known |
| T9 | The runner file replaced by an attacker | Release notes publish its SHA-256; BUILDING.md shows how to run it from source | Users who skip checksum checks |
| T10 | Script injected into the IDE origin (compromised dependency in the web build, or a third-party extension) reads the token | Extension gallery off (PD-21); IDE CSP restricts `script-src` to the build's own files and `connect-src` to the list in `browser-runtime.md`; pinned build dependencies | A compromised build dependency; mitigated by the token's narrow scope and expiry |
| T11 | Another web page (any tab) calls the runner on `127.0.0.1` | Runner checks `Origin` against its allow-list, requires a paired session token, and binds `127.0.0.1` only | A malicious page served from the allowed origin itself (T10) |
| T12 | A tab tells the runner to execute an arbitrary command | The runner has no endpoint that accepts commands; it reads commands only from its own `--root/.reprise.yml` (PD-18); `test_path` is confined to the root and the configured pattern | A malicious commit to `.reprise.yml` in the user's own clone |
| T13 | Pairing code guessed | 6-digit code, single use, 5-minute expiry, 5 wrong tries lock pairing until restart; shown only in the runner's own terminal | None known |
| T14 | IDE writes outside the chosen folder | The File System Access API confines handles to the picked folder; Reprise writes only paths inside `edit_scope` and never inside `.git/` | The user picks too broad a folder (for example their home folder); the first-run step requires `.reprise.yml` at the root |
| T15 | Runner and IDE point at different repositories, so a test approved in one runs in another | Remote and `HEAD` comparison after pairing (`local-runner.md`); approvals are by path and SHA-256 | None known |
| T16 | Runner worktrees fetch or run untrusted refs | Worktrees only for the base SHA and a PR head the user chose to verify; runner never pushes (PD-24) | Running a PR's code locally is inherent in local verification; CI is the isolated option |

## Environment filter for runner-started tests (PD-15)

Applied by the Reprise Runner (and the CI run loop) before starting a test process. Removed: `GITHUB_TOKEN`, `GH_TOKEN`, `GITHUB_PAT`, any variable whose name contains `TOKEN`, `SECRET`, `PASSWORD`, `API_KEY` or `PRIVATE_KEY`, plus variables listed in `.reprise.yml` `platforms.<p>.env_remove`. Variables listed in `platforms.<p>.env_keep` are kept even if they match (for test toolchains that need them); the list is shown in the runner's console the first time and sent to the IDE, which shows it once.

## Webview rules

`localResourceRoots` limited to the extension's `media/`; CSP `default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource}; font-src ${webview.cspSource}; script-src 'nonce-<random>'`; messages from the webview validated against a fixed command list.

## Browser rules

- The IDE page's CSP is recorded in `ide-fork.md` and must list only the origins in `browser-runtime.md` under `connect-src`.
- No token, record or issue text is placed in a URL, including hash fragments.
- Folder permission is requested only with `mode: "readwrite"` on the folder the user picks; Reprise never asks for a second folder.
