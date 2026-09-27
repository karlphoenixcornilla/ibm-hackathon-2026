> Historical document: pivot #29 supersedes IDE/Code-OSS and static/Pages requirements, including work in #12, #14 and #22. See [the repository README](../../README.md) for current integration instructions.

# Base Plan Implementation Result

**Branch:** `feature/base-skeleton`  
**Tag:** `base-v1`  
**Date:** 2025  
**Plan:** `docs/implementation/00-base.md`

---

## Summary

The base skeleton is complete and tagged `base-v1`. All five parallel tracks (T1–T5) can now branch from this tag and work simultaneously without merge conflicts. Contracts are frozen.

---

## Tasks completed

| Task | Status | Notes |
|------|--------|-------|
| B1 — Gates and fork | ✅ | `verification-gates.md` created with all G-1..G-27 entries. Phase-0 gates (G-1–G-4, G-15, G-20) are `Pending` — they require the actual Code-OSS fork build on a build machine. Stop conditions recorded. |
| B2 — Extension skeleton | ✅ | `extensions/reprise/` created with complete `package.json` (all 23 commands, 2 views, 6 settings, menus), `extension.ts`, `config/` (fully implemented), and all 14 module folder stubs. |
| B3 — Contracts | ✅ | All 7 contract files + 8 JSON schemas frozen. `services.ts` is the central interface all tracks code against. |
| B4 — Fakes | ✅ | 14 fake implementations (one per service). `wiring/buildServices` toggles real vs fake via `reprise.dev.useFakes`. |
| B5 — Runner skeleton | ✅ | `runner/reprise-runner.mjs` entry, `src/server.mjs` binding `127.0.0.1`, `GET /status` returning static body in `runner-api` shape, `--root` validation and `--allow-origin` parsing. |
| B6 — Dashboard + CI | ✅ | `dashboard/index.html` placeholder, `dashboard/repos.json` (`[]`), `.github/workflows/ci.yml` (typecheck, lint, depcheck, unit tests, runner tests, Mermaid diagram parse). |
| B7 — Guardrails | ✅ | `.dependency-cruiser.cjs` (no-cross-module, no-providers-importing-exec, no-circular), `eslint.config.mjs` (no-innerHTML in `media/`), `.bob/rules/reprise.md` (ownership table + boundary rules), `CONTRIBUTING.md` (CR process). |

---

## Test results

```
Extension tests (node --test):   23 / 23 PASS
Runner tests   (node --test):     5 /  5 PASS
TypeScript typecheck:             CLEAN (0 errors)
```

---

## Files created

### Repository root
| File | Purpose |
|------|---------|
| `.gitignore` | Excludes `node_modules/`, `out/`, `dist/`, `*.tsbuildinfo` |
| `.bob/rules/reprise.md` | Ownership table, boundary rules, stop conditions for all Bob sessions |
| `.github/workflows/ci.yml` | CI: typecheck → lint → depcheck → extension tests → runner tests → Mermaid parse |
| `CONTRIBUTING.md` | Change-request process, track ownership, commit convention |
| `README.md` | Project overview with Node.js 22+ requirement, quick start, layout |
| `verification-gates.md` | All G-1..G-27 gate entries with current status and notes |

### Extension — `extensions/reprise/`
| File/Folder | Purpose |
|------------|---------|
| `package.json` | Complete `contributes` block — 23 commands, 2 tree views, 6 settings. **Never edited by tracks.** |
| `tsconfig.json` | Strict TypeScript, ES2020, web worker compatible |
| `webpack.config.js` | Bundles to `dist/extension.js` with `webworker` target |
| `eslint.config.mjs` | Flat config with `no-innerHTML` rule for `media/` |
| `.dependency-cruiser.cjs` | Module boundary enforcement |
| `src/extension.ts` | Activation entry — browser check, `buildServices`, command registration, config watcher |
| `src/config/config.ts` | **Fully implemented** — loads and normalises `.reprise.yml` v3 via `js-yaml` |
| `src/contracts/enums.ts` | All 13 enumerations from `data-contracts.md` |
| `src/contracts/records.ts` | `IssueRecord` (schema 3) and `DashboardIndex` |
| `src/contracts/provider.ts` | `Provider`, `StageRequest`, `StageResponse`, per-stage output types |
| `src/contracts/execution.ts` | `TestResult`, `RunResult`, `Executor`, `RunRequest`, `RunEvent` |
| `src/contracts/runner-api.ts` | All runner endpoint request/response types |
| `src/contracts/services.ts` | **The central contract** — `Services` container with 14 service interfaces |
| `src/contracts/schemas/` | 8 JSON schemas: `issue-record`, `dashboard-index`, `stage-{intake,dedupe,test,rootcause,fix,review}`, `reprise-config` |
| `src/util/result.ts` | `Result<T,E>` typed error type |
| `src/util/sha256.ts` | `crypto.subtle`-based SHA-256 (web worker safe) |
| `src/util/log.ts` | Lightweight logger |
| `src/fakes/` | 14 in-memory fakes: `FakeConfig`, `FakeAuth`, `FakeGitHub` (3 issues), `FakeWorkspace`, `FakeIssueStore` (Map), `FakeRunnerClient`, `FakeExecutor` (20 trials, 7 FAIL_MATCH), `FakeProvider` (echoes fixture JSON), `FakeViews`, `FakePipeline`, `FakeStats`, `FakeFix`, `FakeVerify`, `FakeSecurity` |
| `src/wiring/buildServices.ts` | Composition root — returns fakes (`useFakes=true`) or real factories |
| `src/auth/` … `src/security/` | 14 module stubs — each throws "Not implemented yet (track Tn)" |
| `test/contracts.test.ts` | 23 unit tests covering `Result`, enums, `FakeSecurity`, `FakeStats`, `FakeConfig`, `FakeGitHub` |

### Runner — `runner/`
| File | Purpose |
|------|---------|
| `reprise-runner.mjs` | Entry point — parses CLI args, calls `startServer` |
| `src/args.mjs` | `--root`, `--port`, `--allow-origin` parsing with help text |
| `src/server.mjs` | `127.0.0.1`-only HTTP server, CORS origin check, `GET /status` (static), 501 for all other routes. Returns a `closeServer` function for graceful shutdown. |
| `package.json` | `"type": "module"`, Node 22+ engine, `node --test` script |
| `test/server.test.mjs` | 5 tests: status 200, root_name, CORS 403, 501 for unimplemented routes — server is started/stopped via `before`/`after` hooks |

### Dashboard — `dashboard/`
| File | Purpose |
|------|---------|
| `index.html` | Placeholder page with "coming in track T5" message |
| `repos.json` | Empty array `[]` — T5 populates |

---

## Frozen files (change via CR only)

These files must not be edited by any track directly. Open a PR titled `CR: …`:

- `extensions/reprise/src/contracts/` — all `.ts` files and `schemas/`
- `extensions/reprise/src/util/` — `result.ts`, `sha256.ts`, `log.ts`
- `extensions/reprise/package.json` — `contributes` block
- `extensions/reprise/src/extension.ts` — owned by Integration only

---

## Track branch points

All five tracks branch from tag `base-v1`:

```bash
git checkout base-v1
git checkout -b track/t1-github    # auth, github, store, views, workspace
git checkout -b track/t2-runner    # runner-client, exec/local, runner/ (T2 extends)
git checkout -b track/t3-pipeline  # pipeline, providers, stats, security
git checkout -b track/t4-fix-verify # fix, verify, exec/ci, templates/ci/
git checkout -b track/t5-dashboard # dashboard/, .github/workflows/ (pages + release)
```

---

## Open items / stop conditions

| Item | Status |
|------|--------|
| G-1 (Code-OSS web build at pinned tag) | **Pending** — needs build machine. Team must pick the tag and run the build before T1 starts. |
| G-15 (IBM Bob at runtime requirement) | **Pending** — team decision required before T3. If required, a runner endpoint for `bob run` must be designed. |
| G-2 fallback (built-in extension mechanism) | Assume pass; fallback `--extensionPath` approach documented in `verification-gates.md`. |
| `contracts/services.ts` cross-track review | **Required** before T1–T5 begin. All five track leads must review the `Services` interface. |
| `demo-apps.md` | Still empty — T2 is blocked without it (runner adapter commands come from there). |
| Provisional decisions | `provisional-decisions.md` must have PD-1..PD-29 confirmed or changed before tracks start. |

---

## Acceptance checklist (from 00-base.md)

| Check | Status |
|-------|--------|
| `npm run typecheck` clean | ✅ |
| `npm test` (23 tests) green | ✅ |
| `node --test` runner (5 tests) green | ✅ |
| `GET /status` answers on `127.0.0.1` | ✅ (verified in tests) |
| All `Reprise:` commands listed in `package.json` | ✅ (23 commands) |
| Unbuilt commands show "Not implemented yet (track Tn)" | ✅ |
| `contracts/services.ts` reviewed by track leads | ⏳ Pending |
| Web build opens in Chrome/Edge with Reprise branding | ⏳ Requires Code-OSS fork build (G-1) |
| Reprise views appear filled with fake data | ⏳ Requires G-1 and T1 views |
