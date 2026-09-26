# Replication Pipeline Spec

Implements R-1, R-4, the concept paper, and duplicate detection (R-12). Diagrams: `acknowledge-sequence.mmd`, `replication-pipeline.mmd`. Statistics: `statistics.md`. Provider stages: `ai-providers.md`.

## 0. Preconditions

Supported browser, opened folder with read and write permission granted, linked repository, signed-in session, `.reprise.yml` present and valid (`reprise-config.md`). Otherwise `BLOCKED_ENV` naming what is missing. For the local executor, a paired runner whose repository matches (`local-runner.md`).

## 1. Intake (provider stage `intake`)

Input: title, body, comments, text attachments, the list of configured platforms and components. Output fields: fingerprint (`platform`, `component`, `functions`, `symptom`, `trigger`, `expected`, `actual`, `error_signature`), `attempt_possible`, `missing`, `question`.

`platform` must be one of the platforms configured in `.reprise.yml` or `unknown`. If `unknown`, the IDE asks the user to pick the platform (one quick pick) before continuing.

If `attempt_possible` is false → `NEEDS_INFO` with `question`.

## 2. Duplicate detection

Same scoring as kit v1, with `platform` added:

| Field | Method | Weight |
| --- | --- | --- |
| `platform` | 1 if equal, else 0 | 0.10 |
| `component` | 1 if equal and not `unknown` | 0.15 |
| `functions` | Jaccard of identifier sets | 0.30 |
| `symptom` | Jaccard of normalised tokens | 0.20 |
| `trigger` | Jaccard of normalised tokens | 0.10 |
| `error_signature` | Jaccard of normalised tokens | 0.15 |

Normalisation, empty-field renormalisation and threshold 0.60 as in v1 (lowercase, split on non-alphanumerics and camelCase, drop tokens of length 1 and the stopword list `a an and are as at be but by for from has have in is it of on or that the this to was were when with`). Weights and threshold are starting values; phase 5 calibrates them on the demo reports and records the final values and all pair scores here.

Candidates are earlier records in the same repository whose verdict is not `DUPLICATE`. The top candidate is confirmed by the provider stage `dedupe` (`same_bug`, `reason`). If the candidate has a reproduction test for the same platform and an executor is available, it is run once as supporting evidence; if it now passes, the new report is not treated as a duplicate.

## 3. Executor resolution

As `test-execution.md`. No capable executor → `BLOCKED_ENV` naming the missing machine, device, toolchain or runner ("No Reprise Runner connected on a machine that can run <platform>").

## 4. Test: provide or validate (R-1)

- **Validate:** the user picks a test file (command "Choose Test File for Report", or the panel). The user states the signature: the panel suggests the failure message from the first run and the user confirms or edits it.
- **Provide:** provider stage `test` returns a test file and a signature. Shown in a diff view for approval before it is written to the folder or run (PD-10); on approval the IDE writes it and registers its SHA-256 with the runner. Declining sets `STOPPED`.

Signature rules as v1: JavaScript regular expression source, at most 200 characters, compiles, does not match the empty string; matched against the per-test failure message, then the captured output. `kind` is `assertion_message`, `error_type`, `output_regex` or `timeout`.

## 5. First run and revision

Run once through the resolved executor and adapter. Accept when the outcome is `FAIL_MATCH`. For provided tests, on any other outcome the provider stage `test` is called again with the outcome, failure message and output tail; each revision is approved again; at most 3 attempts. For user tests, show the outcome and let the user edit the test or the signature and retry.

No accepted test → `NEEDS_INFO` with what was tried and one question (provider stage `intake` in question-only mode).

## 6. Trials

Run the accepted test under the trial policy for the platform (`statistics.md` §2a, PD-25): by default 10 runs, stopping there if every run failed, otherwise up to 20. The Acknowledge action shows the policy that will apply ("10 to 20 runs") with a **Change** link that edits min, max and time budget for this replication only. "Run more trials" in the panel appends runs up to `limit`. Local: sequential by default; parallel only if the adapter declares it safe (for example several emulators). CI: one job loops the runs and uploads one result file (`test-execution.md`). Outcomes, invalid-run rule and verdicts exactly as `statistics.md` §1–2.

## 7. Diagnosis (CONFIRMED and FLAKY)

Provider stage `rootcause` → `summary`, `locations` (validated to exist), `fix_direction`, `confidence`. Locations are narrowed files → functions → lines, each with the evidence behind it. **Checkpoint:** the panel shows **Accept diagnosis** and **Edit**; Propose fix stays disabled until the user accepts (edits are saved to the record and used by the fix stage). Bisect from v1 is **not** part of this version (it needs one executor run per commit per platform); it is listed as a later improvement.

## 8. Record and display

Write the record (`data-contracts.md`), commit it to `reprise-data` (`github-connection.md`), refresh the panel and the Bug Reports row, and post a comment only if enabled (PD-6).

## Failure handling

Any exception, provider error, executor error, runner disconnection, lost folder permission or cancellation other than declining a test → `ERROR` with the stage and message, partial evidence kept. "Acknowledge again" restarts from intake.
