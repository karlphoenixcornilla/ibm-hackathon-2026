# Reprise IDE — Parallel Implementation Plan (for IBM Bob)

Source of truth: `docs/reprise-kit-v3/` (the "kit"). This plan re-slices the kit's phases (`04-build-plan/`) into **one base plan** followed by **five parallel tracks** with **disjoint file ownership**, so five Bob sessions (or five people) can work at the same time without merge conflicts.

```
                ┌──────────────────────────────┐
                │ 00-base  (1 session, serial) │  fork + skeleton + contracts + stubs + CI lint
                └──────────────┬───────────────┘
                               │  tag: base-v1   (contracts FROZEN)
   ┌────────────┬──────────────┼──────────────┬──────────────┐
   ▼            ▼              ▼              ▼              ▼
 T1 GitHub   T2 Runner &    T3 Pipeline,   T4 Fix/Verify  T5 Dashboard
 & Views     Local Exec     Stats,         & CI Executor  & Deploy
                            Providers
   └────────────┴──────────────┬──────────────┴──────────────┘
                               ▼
                ┌──────────────────────────────┐
                │ 99-integration (1 session)   │  wire real impls, e2e demo, hardening
                └──────────────────────────────┘
```

| Plan | File | Kit phases covered | Owns (write access) |
| --- | --- | --- | --- |
| Base | `00-base.md` | 0 (build parts), 1, skeleton of all | Everything that exists at `base-v1`; afterwards only `contracts/` via change request |
| T1 | `01-github-and-views.md` | 2 | `src/auth/ src/github/ src/store/ src/views/ src/workspace/ media/` |
| T2 | `02-runner-and-local-exec.md` | 3, 8 | `runner/ src/runner-client/ src/exec/local/` |
| T3 | `03-pipeline-stats-providers.md` | 4 | `src/pipeline/ src/stats/ src/providers/ src/security/` |
| T4 | `04-fix-verify-and-ci.md` | 5, 7 | `src/fix/ src/verify/ src/exec/ci/ templates/ci/` |
| T5 | `05-dashboard-and-deploy.md` | 6, 9 | `dashboard/ .github/workflows/ product.json branding assets` |
| Integration | `99-integration.md` | 10 | `src/extension.ts`, `src/wiring/`, e2e tests |

## Why these tracks don't conflict

1. **Folder ownership.** Every file belongs to exactly one plan. A track never edits a file outside its "Owns" list. Bob must refuse and raise a change request instead (see below).
2. **Frozen contracts.** Base writes every cross-module type into `extensions/reprise/src/contracts/` (TypeScript interfaces + JSON Schemas from `02-specs/data-contracts.md`, `ai-providers.md`, `test-execution.md`, `local-runner.md`). After `base-v1`, contracts only change through a change request merged by the base owner.
3. **Pre-declared contributions.** Base writes the complete `package.json` `contributes` block (every view, command, setting, menu from `02-specs/ide-ux.md`), so no track touches `package.json`. Tracks only add dependencies through a change request, or use none.
4. **Registry wiring, not edits to `extension.ts`.** Base's `extension.ts` builds a `Services` container from `src/wiring/`. Each module exposes `index.ts` exporting a factory (`createGitHub(services)`, `createPipeline(services)`, …). At `base-v1` every factory returns a **fake** from `src/fakes/`. Tracks replace the body of their own `index.ts`; they never touch `extension.ts`.
5. **Fakes to develop against.** Each track codes against the contract interfaces plus the fakes of the *other* tracks, so no track waits for another. For example, T3 runs the whole pipeline against `FakeExecutor` and `FakeIssueStore`.
6. **Enforced boundaries.** `dependency-cruiser` runs in CI. A module may import only `contracts/`, `util/` and its own folder. Cross-module calls go through the `Services` interface. A CI failure means someone crossed a boundary.

## Branch and merge rules

- Base works on `main`, then tags `base-v1`.
- Each track branches from `base-v1` as `track/t1-github`, `track/t2-runner`, and so on.
- A track merges to `main` whenever its acceptance checks pass. Because ownership is disjoint, the merges are conflict-free in any order.
- **Change request (CR):** if a track needs a contract, `package.json` or `util/` change, it opens a PR titled `CR: …` against `main` touching only those files. The base owner merges it, and all tracks rebase. Keep CRs rare and additive: new optional fields, never renames.

## How to run each plan with Bob

1. Put the kit where it can be read: copy `docs/reprise-kit-v3/` to `docs/kit/` in the `reprise-ide` repo (the kit's own prompts refer to `docs/kit/`).
2. Add `.bob/rules/reprise.md` (base creates it) containing the ownership table and boundary rules above, so every Bob mode sees them.
3. Per plan: start in **Plan** mode with "Read `plans/<file>.md` and the kit files it lists. Produce a task list." Then switch to **Code** mode and work task by task. Use **Advanced** mode only when shell or MCP access is needed (building, running the runner, `gh`).
4. After each task, Bob runs that plan's acceptance commands before moving on.
5. Stop conditions in each plan override everything else. When one is hit, Bob stops and reports instead of working around it.

## Prerequisites (team, before base starts)

- Fill in `00-context/demo-apps.md` (T2 is blocked without it).
- Mark each PD as Confirmed or Changed in `00-context/provisional-decisions.md` (the one inside the kit, which has PD-1 to PD-29, not the older copy in `docs/`).
- Resolve gate G-15, which covers the hackathon rules and whether Bob must be used inside the product at runtime.
