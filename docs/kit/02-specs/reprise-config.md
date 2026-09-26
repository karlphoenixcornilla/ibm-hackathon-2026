# `.reprise.yml` (version 3)

Lives at the root of each target repository. Validated against `schemas/reprise-config.schema.json` by the extension (read from the opened folder) and by the Reprise Runner (read from its `--root`). The runner uses only its own copy to decide what to execute (PD-18); if the two copies differ, the IDE warns "The runner's .reprise.yml differs from the opened folder". Values in angle brackets come from `../00-context/demo-apps.md`; nothing here is assumed about the team's apps.

Changes from version 2: `trials` becomes a policy (PD-25, `statistics.md` §2a); a plain number is still accepted and means a fixed count. New fix-flow keys (PD-26 to PD-29, `fix-and-verify.md`).

```yaml
version: 3
issues:
  labels: ["bug"]                    # PD-5
components: ["<optional list of component names>"]
defaults:
  executor: local                    # local | ci
  trials:                            # PD-25; or a number for a fixed count, e.g. trials: 20
    min: 10
    max: 20
    limit: 100                       # most runs reachable with "Run more trials"
    # max_minutes: 30                # optional time budget after min runs
  max_test_attempts: 3
fix:
  candidates: 3                      # PD-26: candidate fixes per round
  quick_runs: 5                      # reproduction runs per candidate in the quick check
  max_rounds: 3                      # rounds of candidates before FIX_ABANDONED (was max_fix_iterations)
  candidate_executor: auto           # PD-27: auto (ci if configured, else local with approval) | ci | local
  draft_pr: true                     # PD-28
  self_review: true                  # PD-29
verify:
  min_runs: 3
  max_runs: 200
  regression_reruns: 3
edit_scope:
  test: ["<paths where provided tests may be written>"]
  fix: ["<paths a proposed fix may change>"]
  never: [".github/**", ".reprise.yml", ".reprise/**"]
platforms:
  windows:
    shell: pwsh
    cwd: "<path>"
    prereq: ["<commands that must exist>"]
    build: "<optional build command>"
    test:
      pattern: "<glob for test files the repo runner accepts>"
      single: "<command with {file}>"
      all: "<command>"
      report: junit                  # junit | <adapter parser name>
      report_path: "<path to the report file>"
    lint: "<optional lint command, used by self-review>"
    run_timeout_seconds: 300
    trials: { min: 5, max: 10, max_minutes: 20 }   # optional override (e.g. slow device tests)
    driver:                          # optional fallback
      name: windows
      appium_port: 4723
      capabilities: { "<key>": "<value>" }
  android: { ... same shape ..., device: "<adb serial or emulator name>" }
  ios:     { ... same shape ..., device: "<simulator name or device id>" }
  macos:   { ... same shape ... }
  linux:   { ... same shape, no driver unless G-13 ... }
```

Only the platforms a repository actually targets are listed. A report whose platform is not listed gets `BLOCKED_ENV`.
