# Reprise IDE

> Bug replication and fix pipeline for mobile and desktop apps — built on a rebranded [Code - OSS](https://github.com/microsoft/vscode) web build.

## Overview

Reprise IDE is a browser-based IDE that helps you reproduce flaky bugs, run AI-assisted diagnosis, propose and verify fixes — all from a GitHub-hosted static page, without any server.

Architecture: see [`docs/kit/01-architecture/architecture.md`](docs/kit/01-architecture/architecture.md).  
Implementation plan: see [`docs/implementation/plan.md`](docs/implementation/plan.md).

## Requirements

### Running the IDE

| Requirement | Version | Notes |
|---|---|---|
| **Google Chrome** or **Microsoft Edge** | 86 or later | Required for the File System Access API (`showDirectoryPicker`). Firefox and Safari are not supported. |

### Running the Reprise Runner (local test execution)

| Requirement | Version | Notes |
|---|---|---|
| **Node.js** | **22 or later** (LTS recommended) | The runner is a plain Node.js program — no install step, no dependencies. Install via [nodejs.org](https://nodejs.org/) or `winget install OpenJS.NodeJS.LTS` on Windows. |
| Platform toolchain | — | Android SDK + `adb`, Xcode, etc. — only for the platforms your app targets. See `docs/kit/00-context/demo-apps.md`. |

### Building the IDE from source

| Requirement | Version | Notes |
|---|---|---|
| **Node.js** | Exact version in `.nvmrc` at the pinned Code-OSS tag (≥ 22) | Required to build the Code-OSS web target. |
| RAM | 6 GB minimum, 8 GB recommended | Code-OSS web build requirement. |
| CPU | 4 cores minimum | Code-OSS web build requirement. |

## Quick start

### Start the Reprise Runner against a local clone

```bash
node runner/reprise-runner.mjs --root /path/to/your/app-clone
```

The runner prints a pairing code. Enter it in the IDE under **Reprise → Connect Runner**.

### Development (extension only)

```bash
cd extensions/reprise
npm install
npm run typecheck   # TypeScript type check
npm run lint        # ESLint
npm test            # Unit tests (node --test)
```

### Build the IDE (Code-OSS web + Reprise)

`pages.yml` does this on every push to `main` and deploys it to `/ide/`. To build it yourself (Linux or macOS, or Windows with the Visual Studio C++ build tools):

```bash
git clone --depth 1 --branch "$(cat ide/CODE_OSS_TAG)" https://github.com/microsoft/vscode.git ../vscode
# Use the Node.js version in ../vscode/.nvmrc
node ide/build.mjs --vscode ../vscode --out _ide
python -m http.server 8000 --bind 127.0.0.1 --directory _ide   # then open http://localhost:8000/ in Chrome or Edge
```

See `docs/kit/02-specs/ide-fork.md` for what the build changes.

### Run the runner tests

```bash
cd runner
node --test test/**/*.test.mjs
```

## Repository layout

```
extensions/reprise/     Web extension (TypeScript, web worker target)
  src/
    contracts/          Frozen interfaces and JSON schemas (change via CR only)
    util/               Shared utilities (Result, sha256, log)
    config/             .reprise.yml loader — fully implemented
    fakes/              In-memory fakes for every service interface
    wiring/             buildServices() — composes real or fake services
    auth/ github/ workspace/ runner-client/ views/
    pipeline/ providers/ exec/ fix/ verify/ stats/ store/ security/
  test/                 Unit tests

runner/                 Reprise Runner (Node.js, ESM)
  reprise-runner.mjs    Entry point
  src/server.mjs        HTTP server (127.0.0.1 only)
  test/                 Runner unit tests

dashboard/              Static dashboard placeholder
docs/
  kit/                  Full design kit (specs, architecture, build plan)
  implementation/       Parallel implementation plans (base + 5 tracks)

verification-gates.md   Gate research results (updated as gates are resolved)
CONTRIBUTING.md         Change-request process for frozen files
```

## Branch strategy

| Branch | Purpose |
|---|---|
| `main` | Stable, tagged releases |
| `feature/base-skeleton` | Base plan (this work) — tags `base-v1` when acceptance checks pass |
| `track/t1-github` | T1: GitHub auth, views, store |
| `track/t2-runner` | T2: Runner client, local executor |
| `track/t3-pipeline` | T3: Pipeline, providers, stats, security |
| `track/t4-fix-verify` | T4: Fix, verify, CI executor |
| `track/t5-dashboard` | T5: Dashboard, deployment |

## CI

GitHub Actions runs on every push:
- TypeScript typecheck
- ESLint
- `dependency-cruiser` boundary checks
- Extension unit tests
- Runner unit tests

See [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## Licence

MIT — see `LICENSE`.
