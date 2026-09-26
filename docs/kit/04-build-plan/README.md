# Build Plan (v3, browser-based)

Phases for any builder (IBM Bob, Claude Code, or people). Each phase lists the requirements it serves, inputs, a task prompt, acceptance checks and stop conditions.

| Phase | File | Serves | Needs |
| --- | --- | --- | --- |
| 0 | `phase-0-gates-and-setup.md` | all | — |
| 1 | `phase-1-fork-and-brand.md` | R-2, R-16 | 0 |
| 2 | `phase-2-github-and-views.md` | R-3, R-4, R-16 | 1 |
| 3 | `phase-3-runner-and-local-execution.md` | R-6, R-7, R-8, R-10 | 1, `demo-apps.md` filled |
| 4 | `phase-4-replication.md` | R-1, R-4, R-5, R-12 (dedupe) | 2, 3 |
| 5 | `phase-5-fix-and-verify.md` | R-12 | 4 |
| 6 | `phase-6-dashboard.md` | R-12, R-14 | 4 (records) |
| 7 | `phase-7-ci-executor.md` | R-7 | 2 |
| 8 | `phase-8-driver-fallback.md` | R-8 | 3 |
| 9 | `phase-9-web-deploy-and-runner-release.md` | R-14, R-16 | 1, 3 |
| 10 | `phase-10-hardening-and-rehearsal.md` | all | 5, 6 |
| 11 | `phase-11-submission.md` | V-7 | 10 |

Phase 7 no longer depends on phase 3: CI runs work from the browser without a runner (unless gate G-24 fails).

## Parallel tracks for the deadline (R-9)

The team has four machines (R-11). Only one machine needs to build the web IDE; the others use the deployed `/ide/` URL (or the builder's dev server) in Chrome or Edge, plus the runner.

| Track | Machine | Phases |
| --- | --- | --- |
| A — Core (browser) | the machine that builds the web IDE | 1, 2, 4, 5 |
| B — Runner and platforms | Windows PC, Linux PC, Mac, Android host | 3 (one person writes the runner core; each person owns their platform's adapter and demo app), then 7 and 8 for their platform |
| C — Web and release | any | 6, then 9 |

Phase 9's Pages deployment of the IDE should happen early (right after phase 1) so tracks B and C use the same URL the judges will.

## Critical path and cut line

Must exist for the demo: phases 0, 1, 2, 3 (all five platforms, R-10), 4, 5 (at least one platform), 6, 9 (IDE on Pages), 11.

R-7 (CI runners), R-8 (driver fallback) and R-14 (build from source and the runner release) are **team requirements**. If time runs out, they may only be cut with the team's explicit agreement, in this order, and the submission must then say what was not delivered: 8 (driver fallback) → 7 for platforms whose CI gate failed → 5 on platforms beyond the first.
