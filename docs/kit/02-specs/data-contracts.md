# Data Contracts (v3)

Schemas live in the extension at `schemas/*.schema.json` (draft 2020-12). Field names are final. v3 bumps `schema` to 3 and adds `runner_version` to the run context; v2 records (without it) are read as `runner_version: null`. The runner's HTTP API is a contract too (`local-runner.md`).

## Enumerations

```
Platform:      windows | android | ios | macos | linux
Executor:      local | ci
Method:        repo_command | driver
State:         LISTED | REPLICATING | CONFIRMED | FLAKY | DUPLICATE | NEEDS_INFO | BLOCKED_ENV | STOPPED | ERROR
               | FIXING | FIX_ABANDONED | VERIFYING | FIX_VERIFIED | FIX_INCOMPLETE | REGRESSION_DETECTED | RESOLVED
Verdict:       CONFIRMED | FLAKY | DUPLICATE | NEEDS_INFO | BLOCKED_ENV
VerifyVerdict: FIX_VERIFIED | FIX_INCOMPLETE | REGRESSION_DETECTED
TrialOutcome:  PASS | FAIL_MATCH | FAIL_OTHER | ERROR
SignatureKind: assertion_message | error_type | output_regex | timeout
TestOrigin:    provided | user
FixSource:     provider | human
Evidence:      strong | limited
TestClass:     UNCHANGED_PASS | NEWLY_PASSING | PRE_EXISTING_FAILURE | PRE_EXISTING_FLAKY | ADDED_PASSING | ADDED_FAILING | REMOVED | REGRESSION
Stage:         intake | dedupe | test | rootcause | fix | review
CandidateStatus: selected | survived | rejected_repro | rejected_regression | rejected_duplicate | error
```

## Provider stage outputs

| Stage | Shape |
| --- | --- |
| `intake` | `{ fingerprint: { platform: Platform \| "unknown", component, functions: string[], symptom, trigger, expected, actual, error_signature }, attempt_possible: boolean, missing: string[], question: string }` |
| `dedupe` | `{ same_bug: boolean, reason: string }` |
| `test` | `{ test_file: string, signature: { kind: SignatureKind, pattern: string }, rationale: string }` plus the file in `files` |
| `rootcause` | `{ summary, locations: [{ file, start_line, end_line, reason }], fix_direction, confidence: "high" \| "medium" \| "low" }` |
| `fix` | `{ summary, files_changed: string[], risk_notes, tests_added: string[] }` plus files in `files` (one call per candidate) |
| `review` | `{ verdict: "ok" \| "changes_needed", findings: [{ file, line, severity: "high" \| "medium" \| "low", message }] }` |

## Run context (attached to every set of runs)

```json
{ "platform": "android", "executor": "local", "method": "repo_command", "host_os": "", "device": "", "ci_run_url": null, "runner_version": "" }
```

## Issue record — `issues/<N>.json` on the target repository's `reprise-data` branch

```json
{
  "schema": 3,
  "repo": "OWNER/app",
  "issue": 7,
  "title": "",
  "url": "https://github.com/OWNER/app/issues/7",
  "state": "FLAKY",
  "provider": "stub",
  "stubbed": true,
  "created_at": "ISO-8601",
  "updated_at": "ISO-8601",
  "replication": {
    "verdict": "FLAKY",
    "acknowledged_by": "github-login",
    "started_at": "ISO-8601", "finished_at": "ISO-8601", "duration_ms": 0,
    "fingerprint": { "platform": "android", "component": "", "functions": [], "symptom": "", "trigger": "", "expected": "", "actual": "", "error_signature": "" },
    "duplicate": { "of": null, "score": null, "fields": {}, "reason": "", "behaviour_check": null },
    "question": "",
    "repro": {
      "test_origin": "provided",
      "test_file": "", "test_sha256": "", "branch": "reprise/repro-7",
      "signature": { "kind": "assertion_message", "pattern": "" },
      "attempts": 1,
      "run_context": { "platform": "android", "executor": "local", "method": "repo_command", "host_os": "", "device": "", "ci_run_url": null, "runner_version": "" },
      "trials": 20, "failed": 0, "invalid": 0, "sequence": "",
      "trials_policy": { "min": 10, "max": 20, "limit": 100, "max_minutes": null, "source": "config", "stopped_by": "max_reached" },
      "rate": 0, "wilson_low": 0, "wilson_high": 0
    },
    "diagnosis": { "summary": "", "locations": [], "fix_direction": "", "confidence": "medium", "accepted_by": "github-login", "edited": false }
  },
  "fix": { "iterations": [
    { "n": 1, "source": "provider", "pr": null, "pr_draft": true, "branch": "reprise/fix-7", "base_sha": "", "head_sha": "", "summary": "", "dropped_files": [],
      "candidates": [ { "k": 1, "summary": "", "files_changed": [], "diff_hash": "", "executor": "ci", "quick_check": { "repro_runs": 5, "repro_failed": 0, "blocking": 0 }, "status": "selected" } ],
      "review": { "verdict": "ok", "findings": [], "stubbed": true },
      "verification": {
        "verdict": "FIX_VERIFIED", "finished_at": "ISO-8601",
        "run_context": { "platform": "android", "executor": "ci", "method": "repo_command", "host_os": "", "device": "", "ci_run_url": "", "runner_version": null },
        "repro": { "runs_required": 0, "runs": 0, "failed": 0, "invalid": 0, "evidence": "strong", "claim": "", "injected": false },
        "regression": { "tests_total": 0, "counts": {}, "blocking": [], "notable": [] }
      } } ] },
  "resolution_note": "",
  "usage": { "provider": "stub", "calls": 0, "by_stage": { "intake": 0, "dedupe": 0, "test": 0, "rootcause": 0, "fix": 0 } },
  "events": [ { "at": "ISO-8601", "type": "acknowledged", "detail": "" } ]
}
```

`trials_policy.source` is `config` or `user` (changed for this replication); `stopped_by` is `all_failed_at_min`, `max_reached`, `time_budget` or `user_extended`. Fix iterations are rounds (`fix.max_rounds`).

`events` types: `acknowledged`, `intake.done`, `dedupe.done`, `test.approved`, `test.declined`, `run.started`, `run.finished`, `trials.extended`, `verdict`, `diagnosis.done`, `diagnosis.accepted`, `fix.candidates_proposed`, `fix.candidate_checked`, `fix.candidate_selected`, `fix.proposed`, `fix.applied`, `fix.rejected`, `pr.opened`, `pr.ready`, `review.done`, `review_comments.addressed`, `verify.started`, `verify.verdict`, `resolved`, `error`. Caps: events 200, blocking 50, notable 50.

## Dashboard index — generated at site build

```json
{ "generated_at": "", "data_source": "live", "repos": ["OWNER/app"],
  "totals": { "issues": 0, "by_state": {}, "by_platform": {}, "median_time_to_verdict_ms": 0, "fixes_verified": 0, "regressions_caught": 0 },
  "issues": [ { "repo": "", "issue": 0, "title": "", "platform": "", "state": "", "verdict": "", "rate": 0, "sequence": "", "stubbed": true, "updated_at": "", "pr": null } ] }
```

`data_source` is `sample` only when the site is built from generated sample records; the dashboard then shows a sample-data banner.
