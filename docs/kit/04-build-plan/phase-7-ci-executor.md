# Phase 7 — CI executor

**Serves:** R-7 (cloud CI runners). **Specs:** `test-execution.md` (CI executor), `github-connection.md` (Git Data API), `security.md` (T7). **Gates:** G-9, G-10, G-11, G-18, G-24.

## Task prompt

```
Implement the CI executor in the web extension and "Reprise: Set Up CI Runs" exactly as test-execution.md specifies: the reprise-run.yml template, .reprise/ci/run-loop.mjs (Node only, sharing the runner's adapter code), branch creation through the Git Data API, workflow dispatch, polling, artifact download and unzip in the browser, parsing into RunResults, branch cleanup. First resolve gate G-24 (artifact download from the browser); if it fails, implement the runner's POST /artifacts fallback and report the token decision to the team before using it.
For each platform, fill the PLATFORM SETUP block only with steps derived from demo-apps.md and confirmed by gates G-9 (macOS and Windows runners free for public repositories), G-10 (Android emulator) and G-11 (Xcode and simulator). If a gate fails for a platform, the IDE must report CI as unavailable for it with the reason; do not work around a failed gate silently.
```

## Acceptance

For every platform whose gates passed, a replication and a verification run on CI from the IDE and produce the same verdict class as local runs; the repository's billing page shows no charge.
