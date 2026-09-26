# Contributing to Reprise IDE

## Change request (CR) process

Some files are **frozen** after `base-v1` and can only change through a change request:

- `extensions/reprise/src/contracts/` — all TypeScript interfaces and JSON schemas
- `extensions/reprise/src/util/` — shared utilities
- `extensions/reprise/package.json` — contributes block and dependency list
- `extensions/reprise/src/extension.ts` — owned by Integration only

### Opening a CR

1. Branch from `main`: `git checkout -b cr/<short-description>`
2. Make only the minimal additive change needed (new optional fields only — no renames, no deletions).
3. Open a PR titled `CR: <description>` against `main`.
4. Tag all affected track owners as reviewers.
5. The base owner merges after all tracks acknowledge.
6. All open track branches rebase onto the updated `main`.

### What qualifies as a CR

- Adding a new optional field to a service interface
- Adding a new optional field to a record type or schema
- Adding a new `devDependency` to the extension's `package.json`
- Adding a new command stub to `package.json` `contributes`

### What does NOT qualify (raise a design discussion instead)

- Renaming or removing a field
- Changing the type of an existing field
- Adding required fields without a default

## Track ownership

Each track owns a disjoint set of folders. See `.bob/rules/reprise.md` for the full ownership table.

**Never edit a file outside your track's ownership list.** If you need to, open a CR or raise it with the track that owns it.

## Commit messages

```
feat(t1): implement GitHub token sign-in
fix(t3): handle missing stub for dedupe stage
CR: add optional runner_logs field to RunResult
chore: update dependency-cruiser to 16.1
```

## Running checks locally

```bash
# Extension
cd extensions/reprise
npm install
npm run typecheck     # TypeScript
npm run lint          # ESLint (includes no-innerHTML rule for media/)
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

- Webview scripts: `textContent` only — no `innerHTML`, `outerHTML`, `insertAdjacentHTML`
- GitHub token: never sent to the runner, providers, or test processes
- Records and issue text: always passed through `security.redact()` before storage or display
- Approvals: every provided test or fix file must be approved via the diff view before being written

See [`docs/kit/02-specs/security.md`](docs/kit/02-specs/security.md) for the full threat model.
