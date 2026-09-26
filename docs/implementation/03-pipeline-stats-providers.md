# T3 — Replication Pipeline, Statistics, Providers and Security

**Branch:** `track/t3-pipeline` from `base-v1`. **Kit phase:** 4 (R-1, R-4, R-5, R-12 dedupe).
**Kit inputs:** `04-build-plan/phase-4-replication.md`, `02-specs/replication-pipeline.md`, `statistics.md`, `ai-providers.md`, `security.md`, `data-contracts.md`, `03-runtime-prompts/*`, `01-architecture/diagrams/{acknowledge-sequence,replication-pipeline,issue-lifecycle}.mmd`.

**Owns:** `extensions/reprise/src/{pipeline,stats,providers,security}/**`, the stub fixtures under each demo repo's `.reprise/stubs/<issue>/` (PD-11), and their tests.
**Must not touch:** anything else. Develop entirely against `FakeGitHub`, `FakeIssueStore`, `FakeExecutor` and `FakeViews` (for approvals). This track doesn't need a real runner or GitHub until integration.

## Tasks
1. **stats/** (pure functions, do these first; T4 depends on them through the contract):
   - trial outcome derivation (§1)
   - verdict from trials (§2) and adaptive trial count (§2a, PD-25)
   - Wilson interval (§3), the zero-failure upper bound (§4) and runs required to verify (§5)
   - claim text (§6) and rounding (§7)

   Write table-driven tests with the kit's worked numbers. **100 % branch coverage.**
2. **security/**:
   - `redact()`: tokens, secrets, and home paths
   - the approvals policy (PD-10): any non-user test needs `views.approveFile` and then `runnerClient.approve(path, sha256)`
   - trusted-link checks
   - `edit_scope` path checks for `test` and `fix` files
3. **providers/**:
   - `Provider` registry
   - the **stub provider**, which reads `.reprise/stubs/<issue>/<stage>.json` (+ files) through `workspace.fs` and never uses the network
   - schema validation of every stage output, with one repair attempt
   - registered but unimplemented placeholders for `claude`, `bob`, `gemini`, `groq`
   - a "Reprise: Select Provider" handler function (the command is already declared by base)
4. **pipeline/**: a stage orchestrator that avoids a god module. Each stage is its own file implementing `Stage { run(ctx): Promise<StageResult> }`:
   `intake.ts → dedupe.ts → resolve-executor.ts → test.ts (provide|validate, R-1) → first-run.ts → trials.ts → diagnosis.ts → record.ts`.
   `orchestrator.ts` runs the stages, persists state transitions to `store` (states from `data-contracts.md`, following `issue-lifecycle.mmd`), supports cancellation, and follows the spec's failure handling.
   - Dedupe is a field-score comparison plus a provider `dedupe` stage plus the optional behaviour check.
   - `NEEDS_INFO` and `BLOCKED_ENV` paths are included.
5. **Stub fixtures** for each demo bug in `demo-apps.md`: `intake`, `dedupe`, `test` and `rootcause` JSON, the test file, and `fix`/`review` fixtures for T4 to use.

## Acceptance
- With every other module faked, `pipeline.acknowledge(7)` produces a schema-valid issue record for each verdict: CONFIRMED, FLAKY, DUPLICATE, NEEDS_INFO and BLOCKED_ENV. These are covered by scripted `FakeExecutor` scenarios in the tests.
- Statistics tests pass with 100 % branch coverage.
- A provider output that fails its schema is rejected after one repair.
- A non-user test never reaches `executor.run` without approval (test asserts it).
- Every string written to a record passes through `redact` (test with a planted fake token).
- `depcheck` is green: `providers/` doesn't import `exec/`.

## Stop conditions
- G-15 requires a real Bob provider at runtime → stop. The team must design the runner endpoint for the `bob` CLI first (ai-providers.md says it's not designed yet).
- A statistics spec formula is ambiguous → stop and ask; don't guess.
