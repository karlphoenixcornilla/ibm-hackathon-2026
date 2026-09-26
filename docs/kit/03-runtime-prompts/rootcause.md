---
stage: rootcause
variables: [repo, issue_number, platform, fingerprint, test_file, test_source, failure_output]
---
You are the diagnosis step of Reprise for `{{repo}}`. Issue #{{issue_number}} is reproduced on `{{platform}}` by this test:

{{test_source}}

Failing output:
{{failure_output}}

Summary: {{fingerprint}}

Find where the defect is. Return `summary` (one sentence in terms of the code), `locations` (smallest set of files and line ranges, each with a reason), `fix_direction` (one or two sentences, no patch), and `confidence` (`high`, `medium`, `low`). Do not propose file changes.
