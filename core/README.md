# @reprise/core

The Reprise engine as a plain TypeScript library with no VS Code dependency. It covers the replication pipeline (intake → dedupe → test → trials → Wilson verdict → diagnosis), stats, security, providers, fix, verify, store, the GitHub client and the runner client.

It was extracted from `extensions/reprise` in #28. It runs in Node ≥ 20. Hosts such as the backend (#30), a CLI or tests supply the I/O through a few small interfaces.

## Quick start

```ts
import { buildCore, createMemoryTokenStore, fromAbortSignal } from '@reprise/core';

const core = buildCore({
  fileSystem,                                   // FileSystem: the linked repo (runner-backed or a clone, #31)
  tokenStore: createMemoryTokenStore(ghToken),  // per-request token, never written to disk
  approvals: { approveFix: async () => userClickedCreatePr },
  providers: { providers: [agentProvider], active: 'claude' },  // #32
});

core.notifier.onEvent((e) => sse.send(e));      // relay progress to the Review UI

await core.config.load();                       // reads .reprise.yml from fileSystem
const result = await core.pipeline.acknowledge(repo, issue, undefined, fromAbortSignal(req.signal));
```

To work with no repository, runner or token, use `buildFakeCore()`, which makes every service a fake. You can also pass `overrides` to `buildCore` to swap in individual fakes, e.g. `{ executors, github, store }`. `test/core.test.ts` shows a full pipeline run built this way.

## Host interfaces (`src/contracts/host.ts`)

| Interface      | Replaces (in the extension)                 | Notes |
|----------------|---------------------------------------------|-------|
| `FileSystem`   | `vscode.workspace.fs`                       | `getRoot()`, `readFile`, `writeFile`. Paths are relative to the repo root. Throw on error. |
| `TokenStore`   | `ExtensionContext.secrets`                  | If `get()` is synchronous, a pre-seeded token is visible right away. |
| `AuthProvider` | `vscode.authentication` + token prompt      | Optional. Used only by `auth.signIn()`. |
| `ConfigSource` | reading `.reprise.yml` + file watcher       | Optional. Defaults to `.reprise.yml` in `fileSystem`. `onDidChange` invalidates the cache. |
| `ApprovalService` | the "Apply / Reject" message box         | Defaults to **deny**. Core never applies a fix without it. |

## Contract changes vs. `extensions/reprise/src/contracts`

- `vscode.Event` and `vscode.CancellationToken` are now `Event` and `CancellationToken` from `contracts/events.ts`, with the same shapes. To build a token, use `fromAbortSignal(signal)` or `new CancellationTokenSource()`. When no token is needed, use `neverCancelled`.
- `ConfigService.getUri()` is now `getPath()`, and `WorkspaceService.getRootUri()` is now `getRoot()`. Both return `string | null`.
- `ViewsService` has been removed. `Services.views` is replaced by:
  - `notifier: NotifierService`, which emits `CoreEvent` values: `record.updated`, `status`, `info` and `error`.
  - `approvals: ApprovalService`.
- `createRunnerClient(svc, { startPort })` takes the start port as an option. It no longer reads it from editor settings.
- `createProviders(svc, { providers, active })` registers real providers. An injected provider replaces the placeholder that has the same id.

## Scripts

```sh
npm ci
npm run typecheck   # tsc --noEmit
npm run lint
npm run depcheck    # module boundary rules (.dependency-cruiser.cjs)
npm test            # builds to out/ and runs node --test
npm run build       # emits out/src (main: out/src/index.js)
```
