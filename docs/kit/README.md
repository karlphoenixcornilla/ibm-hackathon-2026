# Reprise IDE — Build Kit (v3, browser-based)

This kit replaces v2 (desktop VS Code fork with installers). It defines **Reprise IDE** as a **browser-based IDE**: the web build of a VS Code (Code - OSS) fork, served as static files from GitHub Pages and opened in a Chromium-based browser (Google Chrome, Microsoft Edge and other browsers built on Chromium, R-16). The user opens their local repository folder in the browser through the **File System Access API**. The IDE connects to GitHub and the user's repository, lists bug reports, and, when the user acknowledges a report, recognises and replicates the bug by providing or validating a failing test and running it on the right platform (Windows native, Android, iOS, macOS, Linux). It then helps fix the bug and verifies the fix with repeated runs and a regression check. Results appear in the IDE and on a public dashboard.

A browser page cannot start processes, so tests that run on the user's own machine and devices go through the **Reprise Runner**: a small Node.js program the user starts on each machine, which only accepts requests from the paired IDE tab on `127.0.0.1` (PD-17). Tests on GitHub-hosted CI runners need no runner.

The AI layer is a **stub** for now, behind a provider interface ready for Claude, IBM Bob, Gemini, Groq and others.

## What changed from v2

| Area | v2 | v3 |
| --- | --- | --- |
| Product form | Desktop Code - OSS fork, installers per OS | Web build of the Code - OSS fork, hosted on GitHub Pages, Chrome and Edge (Chromium) only (R-16) |
| Opening the project | Native file system | File System Access API directory handle, through the workbench's "Open Folder" (`browser-runtime.md`) |
| Reprise extension | Node extension host | **Web extension** running in the browser's web-worker extension host: no Node APIs, no child processes (ADR-2) |
| Local test runs | Extension spawns processes | Reprise Runner on `127.0.0.1`, paired with the tab (`local-runner.md`) |
| Git writes | `git push` with an askpass helper | GitHub REST Git Data API from the browser; the runner uses git only read-only for worktrees (`github-connection.md`) |
| Installers (R-14) | Installers on GitHub Releases | The IDE URL, plus the runner file on GitHub Releases (PD-20, to confirm with the team) |
| Unsupported browsers | — | Firefox, Safari and mobile browsers get a clear "not supported" page (`browser-runtime.md`) |

| Trial count | Fixed 20 per platform | Adjustable policy: min 10, max 20, stop early if every run failed, "Run more trials" up to 100, per platform and per replication (PD-25, `statistics.md` §2a) |
| Fix flow | One proposal per attempt, PR after quick check | Diagnosis checkpoint, 3 candidates per round filtered by tests, draft PR with a live checklist, self-review, review-comment rounds (PD-26 to PD-29, `fix-and-verify.md`) |

Unchanged: verdicts, Wilson interval and verification-run formulas, regression classes, dashboard design.

## Read in this order

1. `00-context/team-answers.md` — the requirements the team stated, including R-16 (browser-based). They override everything else.
2. `00-context/provisional-decisions.md` — decisions this kit had to make that the team has not confirmed yet. Confirm or change each before building the part it affects. PD-17 to PD-29 are new in v3.
3. `00-context/verification-gates.md` — unverified facts. Phase 0 checks them. G-20 to G-28 are the browser gates.
4. `00-context/demo-apps.md` — **the team must fill this in**; nothing about the demo apps is assumed.
5. `01-architecture/`, then `02-specs/` (start with `browser-runtime.md` and `local-runner.md`), then `04-build-plan/`.

## Rules for whoever builds this (person, Bob, Claude Code, or other agent)

- **No assumptions.** A fact not in `verified-facts.md` is a gate. A choice not in `team-answers.md` or confirmed in `provisional-decisions.md` is provisional and must be flagged, not silently adopted.
- **Team answers win**, then confirmed decisions, then specs, then build prompts.
- **Names are contracts** (`02-specs/data-contracts.md`, `02-specs/reprise-config.md`, `02-specs/local-runner.md`).
- **Zero cost is a hard rule** (`06-deployment/cost-ledger.md`). Anything that costs money is out.
- **Stubbed AI is always labelled** in the UI, the records, the dashboard and the video.
- **Browser support is Chromium only** (R-16). Do not add Firefox or Safari workarounds; show the unsupported-browser page instead.

## Directory map

| Path | Contents |
| --- | --- |
| `00-context/` | Brief, team answers, provisional decisions, verified facts, gates, demo-app intake, hackathon requirements, glossary |
| `01-architecture/` | Architecture, ADRs, Mermaid diagrams (`diagrams/*.mmd`) |
| `02-specs/` | Browser runtime, local runner, IDE fork (web build), IDE UX, GitHub connection, replication pipeline, test execution, AI providers, fix and verify, statistics, data contracts, `.reprise.yml`, security, dashboard |
| `03-runtime-prompts/` | Provider-agnostic prompts used once a real AI provider is enabled (v3 adds `review.md`) |
| `04-build-plan/` | Ordered phases with prompts, acceptance criteria and a critical path for the deadline |
| `05-quality/` | Test strategy, definition of done, UI review template |
| `06-deployment/` | Zero-cost deployment, cost ledger, runbook |
| `07-submission/` | Submission text, video script, slides, cover image |

## Diagram index

Diagrams changed in v3 (`system-context`, `ide-components`, `deployment`, `test-execution`, `acknowledge-sequence`, `replication-pipeline`, `fix-verify-sequence`, `runner-pairing`) have not been run through a Mermaid parser yet; phase 0 checks them.

| File | Shows |
| --- | --- |
| `system-context.mmd` | People, browser IDE, Reprise Runner, GitHub, machines and runners, dashboard |
| `ide-components.mmd` | Web workbench, web extension modules, runner, and how they connect |
| `runner-pairing.mmd` | Pairing the IDE tab with a Reprise Runner and checking they see the same repository |
| `acknowledge-sequence.mmd` | From acknowledging a report to a verdict |
| `replication-pipeline.mmd` | Replication decisions (provide vs validate test, trials, verdicts) |
| `test-execution.mmd` | Executor and adapter selection: runner or CI, repo command or driver fallback |
| `fix-verify-sequence.mmd` | Candidate rounds, apply, draft PR, verification, self-review, ready |
| `regression-classification.mmd` | Per-test regression classes (unchanged) |
| `issue-lifecycle.mmd` | States of a bug report under Reprise (unchanged) |
| `data-model.mmd` | Issue record structure |
| `deployment.mmd` | Repositories, Pages (IDE and dashboard), runner release, CI runners |
