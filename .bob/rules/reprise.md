# Reprise IDE — Bob Rules

These rules apply to every Bob session working on this repository. They are automatically loaded as workspace rules.

## Ownership table

Every file in this repository belongs to exactly one plan. Never edit a file outside your plan's ownership list — open a change request (CR) instead.

| Plan | Owns (write access) |
|------|---------------------|
| Base | Everything at `base-v1`; afterwards only `extensions/reprise/src/contracts/`, `extensions/reprise/src/util/`, `extensions/reprise/package.json`, root tooling config, `.bob/rules/` — via CR only |
| T1 | `extensions/reprise/src/auth/`, `extensions/reprise/src/github/`, `extensions/reprise/src/store/`, `extensions/reprise/src/views/`, `extensions/reprise/src/workspace/`, `extensions/reprise/media/` |
| T2 | `runner/`, `extensions/reprise/src/runner-client/`, `extensions/reprise/src/exec/local/` |
| T3 | `extensions/reprise/src/pipeline/`, `extensions/reprise/src/stats/`, `extensions/reprise/src/providers/`, `extensions/reprise/src/security/` |
| T4 | `extensions/reprise/src/fix/`, `extensions/reprise/src/verify/`, `extensions/reprise/src/exec/ci/`, `templates/ci/` |
| T5 | `dashboard/`, `.github/workflows/` (Pages and release only), `product.json`, branding assets |
| Integration | `extensions/reprise/src/extension.ts`, `extensions/reprise/src/wiring/`, e2e tests |

## Boundary rules (enforced by dependency-cruiser in CI)

1. `src/<module>/**` may import only `src/contracts/**`, `src/util/**`, and its own folder.
2. Cross-module calls go through the `Services` interface — never direct imports.
3. Only `src/wiring/**` and `src/fakes/**` may import across modules.
4. `src/providers/**` must never import `src/exec/**` (providers reason, executors run).
5. `media/**` scripts must never use `innerHTML`, `outerHTML`, or `insertAdjacentHTML` (XSS guard, T8).

## Frozen contracts

`extensions/reprise/src/contracts/` is **frozen** after `base-v1`. Do not edit any file there without a CR.

A CR must:
- Be titled `CR: <short description>`
- Touch only `contracts/`, `util/`, or `package.json`
- Add only new optional fields — never rename or remove existing ones
- Be merged by the base owner before any track rebases onto it

## Frozen package.json

`extensions/reprise/package.json`'s `contributes` block is complete. Tracks must never add commands, views, or settings there — those were pre-declared in base. Adding a new `dependency` requires a CR.

## Never edit `extension.ts`

`extensions/reprise/src/extension.ts` is owned by Integration. Tracks replace only the body of their own module's `index.ts` factory. They never touch `extension.ts`.

## Stop conditions — always override everything else

- G-1 fails (web build doesn't build at the pinned tag) → stop, report, pick another tag with the team.
- G-2 fails (no built-in web extension mechanism) → use the `--extensionPath` fallback and record it.
- G-15 says Bob must run inside the product at runtime → stop T3, raise with the team before it starts.
- A track discovers a required contract change → open a CR, do not proceed until it is merged.

## Change request (CR) checklist

Before opening a CR:
- [ ] I cannot accomplish my task without changing a frozen file
- [ ] The change is additive (new optional field) — no renames, no deletions
- [ ] I have listed every track that will be affected
- [ ] I have updated the relevant schema if the CR touches a data type

## Commit convention

```
feat(base): <summary>          # new feature in base scope
feat(t1): <summary>            # T1 work
fix(contracts): CR: <summary>  # contract change request
chore: <summary>               # tooling, docs
```

## Branch rules

- Base: `feature/base-skeleton` → merge to `main`, tag `base-v1`
- Tracks: `track/t1-github`, `track/t2-runner`, `track/t3-pipeline`, `track/t4-fix-verify`, `track/t5-dashboard`
- Integration: `track/integration`
- CRs: `cr/<description>` branched from `main`
