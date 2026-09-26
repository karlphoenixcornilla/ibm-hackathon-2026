# Phase 4 — Replication pipeline with the stub provider

**Serves:** R-1, R-4, R-5, R-12 (duplicate detection), concept paper. **Specs:** `replication-pipeline.md`, `ai-providers.md`, `statistics.md`, `data-contracts.md`.

## Task prompt

```
Implement, in the web extension, providers/ (the Provider interface, the stub provider reading .reprise/stubs/<issue>/ from the opened folder, and registered placeholders claude, bob, gemini, groq that report "not implemented"), stats/ (every function and worked example in statistics.md, including the §2a trial policy and early stop, as unit tests to 4 decimals), pipeline/ (sections 0 to 8 of replication-pipeline.md: intake, dedupe scoring and confirmation, executor resolution, provide or validate, approval diff with write through workspace.fs and /approve to the runner, first run and revision, trials, verdict, diagnosis) and store/ (records per data-contracts.md schema 3, schema-validated, committed to reprise-data through the Git Data API helper with retry).
Label every stubbed output in the panel as ide-ux.md says. Wire Acknowledge to the pipeline.
Then, with the team, create the stub fixtures for each demo bug in demo-apps.md (only from what that file says; ask for anything missing) and run every demo report through the pipeline on its platform, from the browser IDE with that machine's runner paired. Calibrate the dedupe weights and threshold on the demo reports and record the final values and all pair scores in replication-pipeline.md.
```

## Acceptance

Every demo report reaches its expected verdict on its platform; one duplicate is detected with a score breakdown; validate mode works with a user-written test; records appear on `reprise-data`.
