# Phase 5 — Fix assistance, verification, regression check

**Serves:** R-12. **Specs:** `fix-and-verify.md`, `statistics.md`, diagrams `fix-verify-sequence.mmd`, `regression-classification.mmd`.

## Task prompt

```
Implement fix/ and verify/ exactly as docs/kit/02-specs/fix-and-verify.md specifies: the diagnosis checkpoint, candidate rounds (generation, scope filtering, diff-hash duplicates, CI or runner-overlay quick checks with batch approval, filtering, ranking, round cap), the draft PR with its live checklist, self-review, Mark ready (GraphQL), Address review comments, then: propose fix via the provider, edit-scope filtering, diff review with Apply/Reject writing through workspace.fs, quick check (runner worktree for the base), branch reprise/fix-N and PR creation through the Git Data API, verification with base and head in runner worktrees (PD-24) or on CI, the repro hash check or injection, required runs from statistics.md section 5, regression comparison and reruns per regression-classification.mmd, verdict precedence, claim sentences, records, RESOLVED detection on refresh, optional PR comment (off by default).
Unit tests: every test class, verdict precedence, the linked-issue regex, scope filtering including the reproduction test and .reprise/**, diff normalisation and duplicate detection, candidate ranking, checklist rendering, round cap.
Then demo it on the first platform the team chooses: of three stub candidates (one still reproducing, one breaking a test, one correct) the correct one is selected and gives FIX_VERIFIED; a deliberately wrong fix prepared by the team (it must pass the reproduction test and break an existing test) gives REGRESSION_DETECTED.
```

## Acceptance

Both outcomes shown on at least one platform; records and panel correct; required-run counts match `statistics.md` for the observed replication rate.
