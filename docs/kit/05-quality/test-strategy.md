# Test Strategy (v3)

## Layers

| Layer | Where | Runs |
| --- | --- | --- |
| Unit (extension) | `extensions/reprise/test/`, run in a browser-like environment (no Node APIs in code under test) | On every push (CI of `reprise-ide`, extension and runner tests only) |
| Unit (runner) | `runner/test/` in Node.js | Same |
| Pipeline with stub fixtures | `extensions/reprise/test/pipeline/` with fake executors returning recorded `RunResult`s and a mocked `fetch` for GitHub | Same |
| Browser smoke | The deployed `/ide/` in current Chrome and Edge: open folder, reload and regrant, sign in, pair runner; Firefox shows the unsupported page | After each Pages deploy, by hand |
| Platform integration | Each demo app on its machine through the paired runner | Phase 3 and rehearsal |
| CI executor integration | `reprise-run.yml` in each demo app repository | Phase 7 and rehearsal |
| End-to-end rehearsal | All four machines | Phase 10 |

## Unit coverage required

Statistics worked examples; trial policy (early stop at `min`, run to `max`, extend to `limit`, time budget, fixed count shorthand); Git Data API commit helper including the 422 retry; `.git/HEAD` and `packed-refs` parsing; runner request validation (every refusal in `local-runner.md`); runner pairing (expiry, single use, lockout); trial classification for every signature kind; dedupe scoring (platform field, renormalisation, threshold edge); config validation; RunResult parsing for each demo framework's report format; environment filter; edit-scope filtering (including the reproduction test and `.reprise/**`); regression classes and verdict precedence; linked-issue regex; redaction patterns; stub provider (present, missing, invalid fixture); record schema (valid, unknown enum rejected); webview rendering with no unreplaced placeholders.

## Security cases

| Case | Expected |
| --- | --- |
| S1 Stub `fix` proposes a change to `.github/workflows/x.yml` | Dropped and listed; not shown for apply |
| S2 Stub output contains the current GitHub token value | Write and display aborted, `ERROR`, value appears nowhere |
| S3 Issue body contains `</untrusted_report>` | Escaped in prompts (tested on the prompt builder used by future providers) |
| S4 Provided test declined in the approval dialog | State `STOPPED`, nothing executed |
| S5 Fix proposal includes the reproduction test | Dropped; verification of a PR that modifies it gives `FIX_INCOMPLETE` |
| S6 Fix deletes an existing test | `REMOVED` blocks verification |
| S7 Issue title with an HTML payload | Rendered as text in the panel and dashboard; no CSP violation |
| S8 Environment contains `MY_API_KEY` when the runner starts | Not visible to the test process unless listed in `env_keep` |
| S9 A page on another origin sends `POST /runs` to the runner | `403`, nothing executed, refusal logged in the runner console |
| S10 Paired tab sends `test_path: "../outside.sh"` | Refused, nothing executed |
| S11 Provided test edited on disk after approval | SHA-256 mismatch, runner refuses with "Test not approved" |
| S12 Runner `--root` is a different repository from the opened folder | IDE refuses to use the runner |
| S13 GitHub token value appears in a runner request body | Request not sent (outbound scan, T3) |
| S14 Six wrong pairing codes | Pairing locked until the runner restarts |
| S15 A candidate overlay includes a file outside `edit_scope.fix` or not approved | Runner refuses the overlay |
| S16 Local candidates not approved | Nothing runs; candidates stay listed |

## Failure cases

Executor timeout; missing device; missing toolchain; malformed report file; stub fixture missing for a stage; GitHub API rate limit; ref update conflict (`422`) on `reprise-data`; CI run cancelled; artifact missing; runner stopped mid-run; folder permission revoked or not regranted after reload; tab reloaded during a run; runner and folder on different commits.
