# Architecture

Requirements: `../00-context/team-answers.md` (R-n). Provisional decisions: `../00-context/provisional-decisions.md` (PD-n). ADRs: `decisions.md`. Diagrams: `diagrams/`.

## Overview

Reprise IDE is the rebranded **web build** of Code - OSS (R-2, R-16, ADR-1), served as static files from GitHub Pages and opened in desktop Chrome or Edge (PD-22). It bundles one built-in **web extension**, **Reprise** (PD-1, ADR-2), which runs in the browser's web-worker extension host. The user opens their local repository folder through the workbench's "Open Folder", which uses the File System Access API (gate G-21, `browser-runtime.md`).

The extension talks to GitHub over the REST API with the user's token (R-3, PD-19, PD-23), runs a replication pipeline when the user acknowledges a report (R-4), gets reasoning from a pluggable provider that is a stub today (R-5, ADR-4), and runs tests through executors (R-7, ADR-5):

- **local**: the **Reprise Runner** (PD-17, ADR-11), a Node.js program the user starts on the machine that has the toolchain and devices. It listens on `127.0.0.1`, is paired with one IDE tab, reads commands only from `.reprise.yml` in its root (PD-18), and hosts the per-platform adapters (repository command first, Appium driver fallback, R-8, ADR-6).
- **ci**: GitHub-hosted runners started with `workflow_dispatch`, entirely from the browser (PD-14, gate G-24).

Records go to the target repository's `reprise-data` branch through the Git Data API (PD-12) and a GitHub Pages dashboard, on the same site as the IDE, aggregates them (PD-13).

## What runs where

| Part | Runs in | Can | Cannot |
| --- | --- | --- | --- |
| Web workbench (Code - OSS web build) | Browser main thread | Editor, diff editor, views, File System Access folder, secret storage | Start processes, run git |
| Reprise extension | Browser web worker (extension host) | `workspace.fs` on the opened folder, `fetch` to `api.github.com` and to the paired runner, webviews | Node APIs, child processes, raw sockets |
| Reprise Runner | Node.js on the user's machine | Start test processes, adb, xcodebuild, Appium; read-only git worktrees (PD-24) | Accept commands from the tab (PD-18), push to GitHub, listen beyond `127.0.0.1` |
| CI run loop | GitHub-hosted runner | Same adapters as the runner, for one dispatched run | Write to the repository (`contents: read`) |
| Dashboard | Browser, static site | Read generated data | Anything else |

## Repositories

| Repository | Contents |
| --- | --- |
| `OWNER/reprise-ide` (public fork of `microsoft/vscode` at the pinned tag, PD-3) | Branding and web-build changes, `extensions/reprise/` (the web extension), `runner/` (Reprise Runner), `dashboard/` (static site), `.github/workflows/` for the Pages build (IDE and dashboard) and runner releases, `docs/kit/` (this kit) |
| Demo app repositories (R-15, listed in `demo-apps.md`) | Each gets `.reprise.yml`, `.reprise/stubs/`, `.github/workflows/reprise-run.yml` (PD-14), and a `reprise-data` branch; each is cloned locally on the machine that runs its platform |

## Extension layout — `extensions/reprise/` (web extension)

```
extensions/reprise/
  package.json            "browser" entry only; contributes views, viewsContainers, commands, configuration, menus
  src/
    extension.ts          activation, wiring, supported-browser check
    config/               load and validate .reprise.yml from the opened folder (02-specs/reprise-config.md)
    auth/                 GitHub sign-in: built-in provider if G-7 passes, else token (PD-23)
    github/               repository linking from .git/config, issues, comments, Git Data API writes, PRs, workflow dispatch, artifacts
    workspace/            file reads and writes through workspace.fs, SHA-256 with crypto.subtle
    runner-client/        pairing, requests and output streaming to the Reprise Runner
    views/                Bug Reports tree view, Runs view, Reprise panel webview, status bar item
    pipeline/             intake, dedupe, test provide/validate, trials, verdict, diagnosis
    providers/            Provider interface, stub provider, placeholders for claude/bob/gemini/groq
    exec/                 Executor interface, local executor (runner client), CI executor
    fix/                  fix proposal, diff review, PR creation through the REST API
    verify/               repro check and regression comparison
    stats/                statistics (02-specs/statistics.md)
    store/                issue records on reprise-data
    security/             redaction, approvals, trusted-link checks
  media/                  webview scripts and styles, fonts
  test/                   unit tests, fixture records
```

## Runner layout — `runner/`

```
runner/
  reprise-runner.mjs      single-file entry, bundled for release; Node.js only
  src/
    server.mjs            HTTP on 127.0.0.1, CORS and origin checks, pairing, session token
    config.mjs            reads .reprise.yml from --root
    repo.mjs              remote and HEAD detection, worktrees in the cache folder (PD-24)
    adapters/             windows, android, ios, macos, linux: prerequisites, commands, result parsing
    drivers/              Appium fallback runner (PD-8)
    env.mjs               environment filter (PD-15)
  test/
```

The adapters and result parsers are shared with `.reprise/ci/run-loop.mjs`, so a test behaves the same locally and on CI.

## Main flows

| Flow | Diagram | Spec |
| --- | --- | --- |
| Opening the IDE, folder and runner | `runner-pairing.mmd` | `02-specs/browser-runtime.md`, `02-specs/local-runner.md` |
| Acknowledge to verdict | `acknowledge-sequence.mmd`, `replication-pipeline.mmd` | `02-specs/replication-pipeline.md` |
| Choosing where and how a test runs | `test-execution.mmd` | `02-specs/test-execution.md` |
| Fix, review, PR, verification | `fix-verify-sequence.mmd`, `regression-classification.mmd` | `02-specs/fix-and-verify.md` |
| Issue states | `issue-lifecycle.mmd` | `02-specs/data-contracts.md` |
| Build, release, dashboard | `deployment.mmd` | `06-deployment/deployment.md` |

## Boundaries

- Only `providers/` produces reasoning output, and only through the Provider interface. The stub reads fixtures from the opened folder; it never calls a network API.
- Only the Reprise Runner and the CI run loop start test processes. The browser never executes anything, and providers never execute anything.
- The runner executes only commands read from its own `--root/.reprise.yml` (PD-18).
- Only `store/` writes records; only `github/` calls GitHub. The GitHub token never leaves the browser: it is not sent to the runner, to providers or to test processes.
- Every string shown in a webview, written to a record, or posted to GitHub passes through `security/redact`.
- Webviews render with `textContent` only and a strict Content-Security-Policy.

## Why a built-in web extension instead of core changes (PD-1)

The extension API covers everything Reprise needs in the browser (tree views, webviews, diff editor, secret storage, `workspace.fs`, `fetch`), subject to gate G-19. Keeping the fork's own diff to branding, web configuration and bundling means upgrading to a newer Code - OSS tag is mostly a rebase of `product.json`, and the extension can be developed against any Code - OSS web build while the Pages deployment is still being set up.
