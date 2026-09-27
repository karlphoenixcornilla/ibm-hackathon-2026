# Contributing to Reprise

Pivot #29 supersedes the old extension-specific ownership and additive-only contract freeze. Coordinate shared contract changes with other pivot workstreams; preserve record schemas and domain behavior unless explicitly changed by a pivot.

## Running checks locally

```bash
# Core
cd extensions/reprise
npm install
npm run typecheck     # TypeScript
npm run lint          # ESLint
npm run depcheck      # dependency-cruiser boundary check
npm test              # Unit tests

# Runner
cd runner
node --test test/**/*.test.mjs
```

All four checks must pass before a PR is opened.

## Boundary rules

Enforced by `dependency-cruiser` in CI — see [`extensions/reprise/.dependency-cruiser.cjs`](extensions/reprise/.dependency-cruiser.cjs) and [`.bob/rules/reprise.md`](.bob/rules/reprise.md).

## Security rules (non-negotiable)

- UI scripts: `textContent` only — no `innerHTML`, `outerHTML`, `insertAdjacentHTML`
- GitHub token: never sent to the runner, providers, or test processes
- Records and issue text: always passed through `security.redact()` before storage or display
- Approvals: every provided test or fix file must be approved by the host before being written

See [`docs/kit/02-specs/security.md`](docs/kit/02-specs/security.md) for the full threat model.
