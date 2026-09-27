# Backend + hosting — design (issue #30)

Part of the pivot epic #27. This replaces static GitHub Pages with a deployable server. The server serves the Review UI, exposes the app API and runs `@reprise/core` (#28).

## Decisions

| Question | Decision | Why |
|---|---|---|
| Host | **Render free web service**, Docker, defined in `render.yaml` | It is the only option that is free with no card (R-13, `docs/kit/06-deployment/cost-ledger.md`), runs a long-lived process and keeps env-var secrets. It sleeps after 15 min idle (about 30 s cold start), which also clears in-memory sessions. That is acceptable for the demo. |
| Framework | **Fastify** (Node 22, TypeScript, CommonJS like core) | Typed, has built-in `inject()` for tests, and serves SSE easily. |
| Server config | `AGENT_API_KEY` (secret, for #32) and `PUBLIC_ORIGIN`, set as Render env vars. Session ids are random and live only in memory, so no signing secret is needed. | The agent key lives only on the server. |
| GitHub token | **In-memory session.** `POST /api/session` validates the token and keeps it in a RAM map. The client gets an `httpOnly; Secure; SameSite=Strict` cookie. | Long runs need the token after the request that started them. EventSource sends the cookie automatically. Page JS never sees the token again. It is never written to disk or logs. |
| Runner reachability | **Browser relay.** The browser talks to `127.0.0.1:47410–47419` directly. The backend's local executor sends each run to the browser over SSE and waits for the result. | A hosted backend cannot reach the user's localhost. Pairing and the runner's Origin allow-list stay as they are. |
| Repo files on the backend | **Read-only `FileSystem` over the GitHub contents API**, at the default branch | `.reprise.yml` and source files are available without a checkout. Local writes belong to #31. |
| UI | Serve `web/dist` if it exists (#33), otherwise a placeholder. SPA fallback applies outside `/api`. | #33 owns the UI. |

## Layout

```
server/
  package.json          depends on @reprise/core via file:../core
  openapi.yaml          the published contract (also served at /api/openapi.json)
  src/
    api/types.ts        request/response + SSE event types (typed client contract for #33)
    api/client.ts       typed fetch client over api/types.ts for the UI (#33)
    app.ts              buildApp(options) → Fastify instance (no listen)
    main.ts             reads env, calls buildApp, listens on $PORT
    config.ts           env parsing
    session.ts          in-memory session store + cookie helpers
    runs.ts             run registry: status, event bus, relay pending map
    relay-executor.ts   Executor that round-trips RunRequests through the browser
    github-fs.ts        read-only FileSystem over GitHub contents API
    core-factory.ts     builds a per-run/per-request core (real or mock)
    mock.ts             mock-mode core + canned proposal/record
    handlers.ts         ProposeHandler / PrHandler interfaces + stub implementations
    routes/*.ts         session, issues, runs, static
  test/*.test.ts
Dockerfile              multi-stage: core → server → runtime
render.yaml             Render blueprint (free plan, docker, health check)
```

## API contract

Long-running operations return **`202 { runId }`**. Progress arrives on `GET /api/runs/:id/events` (SSE). The final state is also available from `GET /api/runs/:id` for polling. Every error body is `{ error: string }`.

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/session` | `{ token }` | `200 { login }` + cookie; `401` if GitHub rejects the token |
| GET | `/api/session` | — | `200 { login }` or `401` |
| DELETE | `/api/session` | — | `204`; the token is dropped from memory |
| GET | `/api/repos/:owner/:repo/issues` | — | `200 GitHubIssue[]` (open, labelled per `.reprise.yml`, default `bug`) |
| GET | `/api/repos/:owner/:repo/issues/:n/record` | — | `200 IssueRecord` or `404` |
| POST | `/api/repos/:owner/:repo/issues/:n/acknowledge` | `{ trials?: Partial<TrialsPolicy> }` | `202 { runId }` |
| POST | `/api/repos/:owner/:repo/issues/:n/propose` | — | `202 { runId }`; the result is a `Proposal` |
| POST | `/api/repos/:owner/:repo/issues/:n/pr` | `{ diff, title, body, draft }` | `201 { number, html_url }` |
| GET | `/api/runs/:id` | — | `200 RunStatus` |
| GET | `/api/runs/:id/events` | — | `text/event-stream` of `RunStreamEvent` |
| POST | `/api/runs/:id/exec/:reqId` | `ExecResult` | `204`; `404` if unknown or already settled |
| GET | `/api/health` | — | `200 { ok: true, mode }` (no auth; Render health check) |
| GET | `/api/openapi.json` | — | the spec (no auth) |

Everything under `/api` except `health`, `openapi.json` and `POST /api/session` requires a session (`401` otherwise). A run is visible only to the session that started it (`404` otherwise).

### Types (`server/src/api/types.ts`)

```ts
type RunKind = 'acknowledge' | 'propose';
type RunState = 'running' | 'succeeded' | 'failed';

interface RunStatus {
  id: string; kind: RunKind; state: RunState;
  repo: string; issue: number; started_at: string; finished_at: string | null;
  record: IssueRecord | null;      // acknowledge result
  proposal: Proposal | null;       // propose result
  error: string | null;
}

interface Proposal {
  locations: Diagnosis['locations'];   // where
  root_cause: string;                  // why
  fix_direction: string;
  confidence: 'high' | 'medium' | 'low';
  diff: string;                        // unified diff
  pr_draft: { title: string; body: string };
}

type RunStreamEvent =
  | { type: 'core'; event: CoreEvent }                         // record.updated / status / info / error
  | { type: 'exec.request'; reqId: string; request: RunRequest }
  | { type: 'exec.output'; reqId: string; line: string }       // reserved; not sent in #30
  | { type: 'run.done'; status: RunStatus }
  | { type: 'run.failed'; status: RunStatus };

type ExecResult = { ok: true; results: RunResult[] } | { ok: false; error: string };
```

`IssueRecord`, `Diagnosis`, `GitHubIssue`, `TrialsPolicy`, `CoreEvent`, `RunRequest` and `RunResult` are the existing core contracts. `records.ts` is not changed.

When a client connects, the SSE stream first replays the run's buffered events, then sends live ones. Once the run is finished, the stream sends the final `run.done`/`run.failed` and closes.

## Sessions

- `Map<sessionId, { token, login, createdAt, lastSeen }>`. The id is 32 random bytes in base64url.
- The cookie is `reprise_sid`, set with `httpOnly; SameSite=Strict; Path=/api`, and `Secure` except in local dev over http.
- A session expires after 1 h idle or 8 h absolute. Expired sessions are swept every minute.
- Requests that change state (`POST`/`DELETE`) must carry an `Origin` equal to `PUBLIC_ORIGIN`, or no `Origin` at all (same-origin fetches that omit it). Anything else gets `403`.
- The token never appears in a response body, a log line or an error message. The logger's serializers drop `cookie` and `authorization` headers.

## Core wiring

Each run gets its own core, `buildCore({ fileSystem: githubFs(repo, token), tokenStore: createMemoryTokenStore(token), approvals: denyAll, overrides: { executors: { local: relay, ci } } })`. The run subscribes to `core.notifier.onEvent` and forwards each event as `{ type: 'core' }`. Read-only routes (`issues`, `record`) build a short-lived core the same way. A later issue can move `github` onto a cached per-session instance if rate limits bite.

**RelayExecutor** (`id: 'local'`)
- `available()` is `{ available: true }` when the run has at least one SSE subscriber. Otherwise it returns `{ available: false, reason: 'Open the Review UI to connect your local runner.' }`.
- `run(req)` makes a `reqId`, emits `exec.request` and waits for `POST /api/runs/:id/exec/:reqId`. A result replays through `onEvent` as `result` events followed by `done`, and resolves with `results`. An error rejects. The executor gives up after `RELAY_TIMEOUT_MS` (default 10 min) or on cancellation.

**Propose / PR handlers** (`handlers.ts`) are injected into `buildApp`:
```ts
interface ProposeHandler { propose(ctx: { core, repo, issue, token }): Promise<Proposal> }
interface PrHandler { createPr(ctx: { core, repo, issue, token }, input: PrInput): Promise<{ number; html_url }> }
```
The defaults are stubs. `propose` returns a proposal built from the record's `replication.diagnosis` plus an empty diff, or fails if there is no record. `createPr` returns `501` until #34 provides a real handler. #32 and #34 plug in real implementations without touching the routes.

## Mock mode (the UI team's mock server)

`REPRISE_MOCK=1 npm run dev` (or `npm run dev:mock`) uses `buildFakeCore()` with a scripted pipeline. `acknowledge` emits a few `status`/`record.updated` events over about 3 s, then finishes with the sample record from `dashboard/data/sample/desktop-app/issues/7.json`, copied into `server/fixtures/`. `propose` returns a canned `Proposal` with a real-looking diff. `pr` returns `{ number: 999, html_url }`. Sessions accept any non-empty token as login `mock-user`. The routes, types and OpenAPI document are the same ones production serves.

## Deployment & CI

- **Dockerfile:** stage 1 runs `npm ci && npm run build` in `core/`. Stage 2 does the same in `server/`, with `web/dist` copied in if present. The runtime stage is `node:22-slim` with production deps, runs as a non-root user, and runs `node out/src/main.js`.
- **render.yaml:** one `web` service with `plan: free`, `runtime: docker`, `healthCheckPath: /api/health` and `autoDeploy: false`. Env vars: `PUBLIC_ORIGIN`, plus `AGENT_API_KEY` with `sync: false`.
- **CI (`ci.yml`):** a new `server` job runs typecheck, lint and test, then builds the Docker image. A `deploy` job runs on pushes to `main`, needs `core` and `server`, and POSTs `secrets.RENDER_DEPLOY_HOOK`. It is skipped with a notice if the secret is unset.

## Testing

`node:test` + `app.inject()`:
- session: login, whoami, logout, idle expiry, bad token → 401, cookie flags, token absent from responses and logs, Origin check.
- issues / record: against a stub GitHub (real mode with `fetch` mocked) and in mock mode.
- runs: acknowledge in mock mode reaches `succeeded` with a record; the SSE stream replays then closes; another session's run → 404.
- relay: `exec.request` is emitted, the POST back resolves `run()`, timeout rejects, a second POST → 404.
- contract: every mock-mode response validates against `openapi.yaml`, using a small validator over the spec's JSON Schemas (Ajv).

## Out of scope

The real agent (#32), PR creation logic (#34), the browser half of the relay and runner pairing UI (#31/#33), removing `pages.yml`/the IDE (#29), persisting runs across restarts.

## Definition of done (from #30)

- The app is reachable at a public Render URL, and `GET /api/repos/:owner/:repo/issues` returns real issues after `POST /api/session` with a token.
- `openapi.yaml` and `api/types.ts` are published, and the UI team can run `npm run dev:mock`.
- Decisions are recorded on issue #30.
