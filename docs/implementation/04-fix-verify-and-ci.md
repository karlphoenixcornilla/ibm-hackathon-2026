# T4 — Fix Assistance, Verification and CI Executor

**Branch:** `track/t4-fix-ci` from `base-v1`. **Kit phases:** 5 and 7 (R-7, R-12).
**Kit inputs:** `04-build-plan/phase-5-fix-and-verify.md`, `phase-7-ci-executor.md`, `02-specs/fix-and-verify.md`, `test-execution.md` (CI executor section), `statistics.md` §5–6, `01-architecture/diagrams/{fix-verify-sequence,regression-classification,test-execution}.mmd`, gates G-9, G-10, G-11, G-18, G-24.

**Owns:** `extensions/reprise/src/{fix,verify}/**`, `extensions/reprise/src/exec/ci/**`, `templates/ci/reprise-run.yml`, `templates/ci/run-loop.mjs`, and their tests.
**Must not touch:** `runner/` (the run loop *imports* `runner/src/shared/` parsers once T2 lands, and uses a local copy of the contract until then), `stats/` (call it through `services.stats`, which uses the fake until T3 lands), and `.github/workflows/` in the IDE repo (T5).

## Tasks
1. **exec/ci/**: `Executor` implementation:
   - availability: public repo, and the workflow file exists
   - "Reprise: Set Up CI Runs" handler: commits `reprise-run.yml` and `run-loop.mjs` from `templates/ci/` to a branch through `services.github` and opens a PR (PD-14)
   - run procedure: `reprise/run-<id>` branch with the test file, then `workflow_dispatch` (`platform, ref, mode, test_path, runs`), then poll, then download and unzip the artifact in the browser (G-24), then parse into `RunResult[]`
   - G-24 fallback: ask the paired runner's `/artifacts` endpoint via `services.runnerClient`, or report "CI results unavailable"
2. **templates/ci/**: the workflow with `contents: read`, a job matrix per OS, emulator setup for Android (G-10) and the Xcode version (G-11). `run-loop.mjs` runs `runs` iterations and writes `results/*.json` in the `RunResult` shape. Record the action major versions (G-18).
3. **fix/**:
   - N candidates per round from the provider `fix` stage (PD-26/27)
   - `edit_scope` checks through `services.security`
   - diff review through `services.views.approveFile`
   - quick check of each candidate through the runner `/overlays` or a CI branch
   - candidate status (`selected | survived | rejected_*`)
   - branch `reprise/fix-<N>` and a draft PR (PD-28) through `services.github`
   - human-authored fix iterations (`source: human`)
4. **verify/**:
   - repro check: runs required per `stats` §5, `FIX_VERIFIED` evidence strong/limited, and claim text from §6
   - regression comparison: base vs head with `test.all`, classified into every `TestClass` following `regression-classification.mmd`, deciding the blocking and notable lists
   - verdict `FIX_VERIFIED | FIX_INCOMPLETE | REGRESSION_DETECTED`, plus "no suite configured"
   - self-review via the provider `review` stage (PD-29)
   - "mark ready" flow and optional PR comment (PD-6, off by default)
   - verification is started from the IDE only (PD-16)
5. Write the `fix.iterations[]` part of the record through `services.store`.

## Acceptance
- Against fakes: a scripted fix round produces a schema-valid `fix.iterations[0]` for each verify verdict.
- The regression classifier has a table-driven test covering every `TestClass`.
- On a real public demo repo: "Set Up CI Runs" opens a PR. After it's merged, a dispatched run completes and the browser reads its artifact (or the fallback is recorded).
- The CI OS matrix is tried for each platform, with G-9, G-10 and G-11 recorded. Platforms where a gate failed are marked local-only.

## Stop conditions
- G-24 fails and the team hasn't accepted the token-to-runner risk (local-runner.md `/artifacts`) → implement "CI results unavailable" only, and ask.
- Any CI usage would cost money (G-9) → stop.
