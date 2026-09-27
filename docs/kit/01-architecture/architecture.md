# Current architecture — pivot #29

Reprise is a host-independent application core, a local test runner, and a dashboard UI. No component requires a VS Code extension host or GitHub Pages deployment.

The core remains in `extensions/reprise` to preserve import paths for parallel pivot workstreams. `src/index.ts` exports `buildServices`, host contracts and lifecycle primitives. Hosts supply authentication, workspace access and UI callbacks. The composition root wires configuration, GitHub, record storage, runner client, executors, providers, pipeline, statistics, security, fix and verification services. `buildFakeServices` is available explicitly for tests and demos.

Workspace adapters use relative file paths and string resource identifiers. They own filesystem confinement and approval enforcement. Authentication adapters own credential acquisition and storage. Views adapters own user interaction. Existing record schemas and pipeline semantics remain unchanged.

Pivot #31 adds a runner-backed workspace and `importLocalRepository()` / `runLocalOverlay()` integration. Local repository selection, file access, approved writes, and temporary worktree execution remain behind the runner contract. See [local repository integration](../../local-repository.md).

The dashboard accepts index and record loaders from its host. Bundled JSON records are sample preview data, not a required publication/deployment mechanism. The runner requires explicit allowed origins and retains loopback binding, pairing and session authentication.

No replacement server, editor, credential store or deployment platform is prescribed by this pivot. Subsequent workstreams integrate the host services and data sources.

The former IDE shell, extension commands/webviews, Code-OSS build, and Pages workflow are removed. Previous work in #12, #14 and #22 is obsolete. Other design-kit and implementation documents are historical where they prescribe that architecture.
