# Reprise

Bug replication, diagnosis, fix and verification services for mobile and desktop apps.

Pivot #29 removes the Code-OSS shell, editor extension activation and GitHub Pages deployment. Work from #12, #14 and #22 is obsolete. The application core does not require an IDE or a particular hosting platform.

## Development

Node.js 22 or later is required.

```sh
cd extensions/reprise
npm ci
npm run typecheck
npm run lint
npm run depcheck
npm test
npm run compile
```

The existing `extensions/reprise` directory is retained to limit path churn for other pivot workstreams; it now contains a host-independent TypeScript package, not an editor extension.

Import `buildServices` from the compiled package. Supply `auth`, `workspace` and `views` adapters and optionally `runnerPort`. The host owns credential storage, repository access, user interaction and approval enforcement. Workspace methods use repository-relative paths; resource identifiers are strings. Cancellation and event contracts live in `src/contracts/runtime.ts`. No fake services are selected implicitly; `buildFakeServices()` is an explicit test/demo helper.

The core retains GitHub operations, records, configuration loading, pipeline stages, statistics, providers, local/CI execution, fixes and verification. Host adapters must enforce approved writes and edit scope. This pivot does not introduce a new UI, authentication mechanism or application server; those are integration responsibilities of the new architecture.

## Runner

```sh
node runner/reprise-runner.mjs --root /path/to/clone --allow-origin http://localhost:8080
node --test runner/test/*.test.mjs
node runner/build.mjs
```

Pass each trusted client origin explicitly. The runner binds loopback and trusts no origins by default; pairing and token checks remain required.

## Dashboard

The dashboard retains report browsing and sample fixtures. Its data loaders can be supplied by the embedding application, including authenticated API loaders. See [dashboard/README.md](dashboard/README.md).

```sh
node --test dashboard/test/*.test.mjs
```

CI checks the core, runner and dashboard without building an editor or deploying to Pages. Deployment belongs to the new architecture and is intentionally unspecified here.

## Architecture documentation

[Current architecture](docs/kit/01-architecture/architecture.md) describes the host boundary. Other files in `docs/kit` and `docs/implementation` preserve historical specifications: editor, Chromium-only, static-hosting and Pages instructions are superseded by pivot #29 and must not be used as current requirements.
