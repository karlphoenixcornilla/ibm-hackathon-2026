# 00 — Base Plan (serial, must finish before any track starts)

**Goal:** produce a building, runnable, rebranded web IDE with an empty-but-wired Reprise extension, a runner skeleton, frozen contracts, fakes for every module and CI that enforces boundaries. Tag `base-v1`.

**Kit inputs:** `04-build-plan/phase-0-gates-and-setup.md`, `phase-1-fork-and-brand.md`, `01-architecture/architecture.md`, `01-architecture/decisions.md`, `02-specs/ide-fork.md`, `browser-runtime.md`, `ide-ux.md`, `data-contracts.md`, `ai-providers.md`, `test-execution.md`, `local-runner.md`, `reprise-config.md`, `security.md`.

**Owns:** the whole repository until `base-v1`. After that, only `extensions/reprise/src/contracts/`, `extensions/reprise/src/util/`, `extensions/reprise/package.json`, root tooling config, and `.bob/rules/`, and only through change requests.

## Tasks

### B1. Gates and fork (kit phase 0/1)
1. Resolve gates **G-1, G-2, G-3, G-4** at the pinned stable tag of `microsoft/vscode`. Record results in `verification-gates.md` and `02-specs/ide-fork.md`.
2. Fork at that tag into `OWNER/reprise-ide`. Apply **only** the `product.json` fields from G-3 (PD-4: "Reprise IDE" / "Reprise" / `reprise`), removing the gallery and applying the G-4 trademark fixes.
3. Verify gates **G-21** (Open Folder uses File System Access) and **G-26** (git in the web build) in Chrome and Edge. Record the results.
4. Copy the kit to `docs/kit/`.

### B2. Extension skeleton — `extensions/reprise/`
1. Register it as a built-in **web** extension (G-2 steps), with a `browser` entry only.
2. Write the **complete** `package.json` `contributes` from `02-specs/ide-ux.md`: views container, Bug Reports and Runs tree views, every `Reprise:` command, all settings and menus. Commands whose track isn't built yet show "Not implemented yet (track Tn)".
3. Create every module folder from `architecture.md` with an `index.ts` factory:
   `config/ auth/ github/ workspace/ runner-client/ views/ pipeline/ providers/ exec/local/ exec/ci/ fix/ verify/ stats/ store/ security/`
   plus `contracts/`, `util/`, `fakes/`, `wiring/`.
4. `extension.ts`: supported-browser check (`browser-runtime.md`), then `const services = buildServices(context)` from `wiring/`, then register views and commands through the services. This file is owned by integration after `base-v1`.
5. `config/`: load and validate `.reprise.yml` v3 (`02-specs/reprise-config.md`) with a JSON Schema. Base implements this fully, because every track needs it.

### B3. Contracts — `src/contracts/` (freeze these)
Transcribe the specs into code **exactly**, keeping the field names:
- `enums.ts`: every enumeration in `data-contracts.md`.
- `records.ts` + `schemas/issue-record.schema.json`, `dashboard-index.schema.json`: the issue record (schema 3) and the dashboard index.
- `provider.ts`: `Stage`, `StageRequest`, `StageResponse`, `Provider`, and the per-stage output types + `schemas/stage-*.schema.json`.
- `execution.ts`: `TestResult`, `RunResult`, `RunContext`, `Executor { id; available(): Promise<Availability>; run(req, token, onEvent): Promise<RunResult[]> }`, `RunRequest` (mirrors runner `POST /runs`).
- `runner-api.ts`: request and response types for every runner endpoint in `local-runner.md` (shared by T2's server and T2's client).
- `services.ts`: the `Services` container: `config, auth, github, store, workspace, views, runnerClient, executors: { local, ci }, providers, pipeline, stats, fix, verify, security`. Each is an interface with its method signatures written down now. **This is the most important file in the base plan: tracks code against it.**
- `util/`: `result.ts` (typed errors), `sha256.ts` (`crypto.subtle`), `log.ts`.

### B4. Fakes — `src/fakes/`
One in-memory fake per service interface, with deterministic canned data. Examples:
- `FakeGitHub` lists three issues.
- `FakeExecutor` returns scripted `RunResult`s (e.g. 20 trials, 7 `FAIL_MATCH`).
- `FakeProvider` echoes fixture JSON.
- `FakeIssueStore` keeps records in a Map.

`wiring/buildServices` returns the fakes when the setting `reprise.dev.useFakes` is true, and otherwise returns each module's real factory, which returns its fake until its track replaces it.

### B5. Runner skeleton — `runner/`
- `reprise-runner.mjs` entry, `src/server.mjs` binding `127.0.0.1`, `GET /status` returning a static body in the `runner-api` shape, and `--root` parsing. No execution.
- `package.json` with `node --test`.

### B6. Dashboard and workflow placeholders
- `dashboard/index.html` placeholder and `dashboard/repos.json` (`[]`).
- `.github/workflows/ci.yml`: install, typecheck, lint, `dependency-cruiser`, unit tests for the extension and runner, and the Mermaid diagram parse.
- **No** Pages or release workflows; those belong to T5.

### B7. Guardrails
- `.dependency-cruiser.cjs`: `src/<module>/**` may import only `src/contracts/**`, `src/util/**` and itself. Only `src/wiring/**` and `src/fakes/**` may import across modules, and `src/providers/**` may not import `src/exec/**` (the kit's boundary rule).
- ESLint rule: no `innerHTML` in `media/` (security.md webview rule).
- `.bob/rules/reprise.md`: the ownership table, the boundary rules, "never edit files outside your track", and "stop conditions win".
- `CONTRIBUTING.md`: the change-request process.

## Acceptance (all must pass before tagging `base-v1`)
- The web build serves locally. Reprise IDE opens in Chrome and Edge, shows the Reprise branding, and the Reprise views appear filled with **fake** data.
- Every `Reprise:` command is listed. Unbuilt ones show the "Not implemented yet" message.
- `npm run typecheck && npm run lint && npm run depcheck && npm test` are green in CI.
- `node runner/reprise-runner.mjs --root <demo-clone>` answers `GET /status`.
- `contracts/services.ts` has been reviewed by the leads of all five tracks.

## Stop conditions
- G-1 fails (the web build doesn't work at the tag) → the team picks another tag.
- G-2 fails → use the fallback (load the extension via web workbench config) and record it.
- G-15 says Bob must run inside the product → revisit R-5 with the team before T3 starts.
