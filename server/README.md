# @reprise/server

The deployable Reprise backend (issue #30). It serves the Review UI and the app API, and runs [`@reprise/core`](../core) behind the endpoints.

- **Contract:** [`openapi.yaml`](openapi.yaml) (also served at `/api/openapi.json`) and [`src/api/types.ts`](src/api/types.ts). A typed browser client is in [`src/api/client.ts`](src/api/client.ts).
- **Design:** [`docs/superpowers/specs/2026-09-27-backend-hosting-design.md`](../docs/superpowers/specs/2026-09-27-backend-hosting-design.md)

## Run it

```sh
(cd ../core && npm ci && npm run build)   # the server imports core from core/out
npm ci
npm run dev:mock    # mock server on :8787; no token, repo or runner needed
npm run dev         # real mode: sign in with a GitHub token via POST /api/session
npm test
```

**Mock mode** is the mock server for the Review UI. It runs the same routes and contract as production, over fake services:

- Any non-empty token signs you in as `mock-user`.
- Acknowledge plays a scripted pipeline over about 3 s, then stores a sample record.
- Propose returns a canned proposal with a diff.
- Check (apply and test a fix locally) returns a canned `FIX_VERIFIED` result.
- PR returns #999.
- `REPRISE_MOCK_RELAY=1` makes runs connect through a real paired runner: each run relays `GET /status` (no same-repo check in mock mode), and acknowledge also sends one `exec.request`. Use it to exercise `RunnerBridge` against a runner on your machine.

If a UI dev server on another port proxies `/api` here, add its origin to `EXTRA_ORIGINS`, e.g. `EXTRA_ORIGINS=http://localhost:5173`.

## API at a glance

| Method | Path | Result |
|---|---|---|
| POST | `/api/session` `{ token }` | `{ login }` and the `reprise_sid` cookie |
| GET / DELETE | `/api/session` | Who am I / sign out |
| GET | `/api/repos/:owner/:repo/issues` | Open issues with the `.reprise.yml` labels (default `bug`) |
| GET | `/api/repos/:owner/:repo/issues/:n/record` | `IssueRecord` or 404 |
| POST | `/api/repos/:owner/:repo/issues/:n/acknowledge` | `202 { runId }`, runs the evidence pipeline |
| POST | `/api/repos/:owner/:repo/issues/:n/propose` | `202 { runId }`, runs the agent; the result is `RunStatus.proposal` |
| POST | `/api/repos/:owner/:repo/issues/:n/check` `{ diff }` | `202 { runId }`, applies the fix on your runner and tests it there; the result is `RunStatus.check` |
| POST | `/api/repos/:owner/:repo/issues/:n/pr` | `201 { number, html_url }` (501 until #34) |
| GET | `/api/runs/:id` | `RunStatus` (polling) |
| GET | `/api/runs/:id/events` | SSE stream of `RunStreamEvent` |
| POST | `/api/runs/:id/exec/:reqId` | The browser answers a relay request |
| GET | `/api/health`, `/api/openapi.json` | Public |

## How it works

- **Auth.** `POST /api/session` checks the token with GitHub `GET /user` and keeps it in memory only. The browser gets an opaque `httpOnly; SameSite=Strict` cookie. The token is never written to disk, returned or logged. A session ends on sign-out, after 1 h idle or 8 h total, or when the server restarts. State-changing requests must come from an allowed `Origin`.
- **Runs.** Acknowledge, propose and check return `202 { runId }`. Follow a run with `GET /api/runs/:id/events` (SSE; buffered events replay first) or poll `GET /api/runs/:id`. A run is visible only to the session that started it.
- **Local runner relay.** The hosted server can't reach `127.0.0.1` on your machine, so it goes through the page ([`RunnerBridge`](src/api/runner-bridge.ts)). On the run's stream the server sends two kinds of request:
  - `exec.request { reqId, request }`: a test run. The browser does `POST /runs` on its runner, follows the runner's events, then posts `{ ok: true, results }`.
  - `runner.request { reqId, call }`: one runner call. The browser allows only `GET /status`, `GET /file`, `POST /approve` and `POST /overlays`, and posts `{ ok: true, status, body }`.

  Either answer can instead be `{ ok: false, error }` when the runner is unreachable, and each goes to `POST /api/runs/:id/exec/:reqId`. **The browser handles relay requests one at a time, in order.** That is what gets `/approve` to the runner before `/runs`. A run waits up to 10 s for the page to attach.
- **Your clone stays untouched.** For acknowledge and check, the server first checks, via `GET /status`, that the runner serves this repository, and takes its HEAD. Core then reads files from the clone (`GET /file` at that HEAD). Anything core writes, such as the generated reproduction test, is **staged in server memory**, never written to the clone. When a test runs, the staged files are approved, sent as one overlay on HEAD, and the runner runs the test on a **worktree**. Staged files are kept per issue until the next acknowledge. A restart loses them, and check then asks the user to acknowledge again.
- **Check** (`/check`): applies the unified diff to the files at HEAD, rejecting edits to the reproduction test, `edit_scope.never`, or paths outside `edit_scope.fix`. It runs the reproduction test `fix.quick_runs` times with the fix, then, if `test.all` is configured, the suite once without and once with it. The result is a `LocalCheck` with verdict `FIX_VERIFIED`, `FIX_INCOMPLETE` or `REGRESSION_DETECTED`.
- **Other repo reads** (the issue list, records) use the GitHub API with the session token.
- **Agent / PR.** `ProposeHandler` and `PrHandler` in [`src/handlers.ts`](src/handlers.ts) are the seams for #32 and #34. Until then, propose returns the record's diagnosis with an empty diff, and PR returns 501.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8787` (`10000` in Docker) | Listen port |
| `PUBLIC_ORIGIN` | `RENDER_EXTERNAL_URL`, else `http://localhost:$PORT` | Allowed `Origin` for POST/DELETE. `https` enables Secure cookies |
| `EXTRA_ORIGINS` | — | Comma-separated extra allowed origins |
| `REPRISE_MOCK` | — | `1` for mock mode |
| `REPRISE_MOCK_RELAY` | — | `1` to send one relay request during mock acknowledge |
| `RELAY_TIMEOUT_MS` | `600000` | How long core waits for the browser to return runner results |
| `WEB_DIR` | `../web/dist` if built, else `public/` | Static UI directory |
| `AGENT_API_KEY` | — | LLM key for the agent (#32). Server-side only |

## Deploy (Render, free plan)

1. In Render, choose **New → Blueprint** and pick this repository. Render reads [`render.yaml`](../render.yaml) and asks for `AGENT_API_KEY`, which can stay empty until #32.
2. Open the service's **Settings → Deploy Hook**, copy the URL, and add it to GitHub as the Actions secret `RENDER_DEPLOY_HOOK`.
3. Every push to `main` that passes CI now deploys. The app runs at `https://<service>.onrender.com`. The free tier sleeps when idle: the first request after a sleep takes about 30 s and signs everyone out.
4. Start the runner with `--allow-origin https://<service>.onrender.com` so the browser can reach it.

## Using the runner bridge in the UI

```ts
import { RepriseApi } from './api/client';
import { RunnerBridge } from './api/runner-bridge';

const api = new RepriseApi();
const bridge = new RunnerBridge();          // probes 127.0.0.1:47410–47419
await bridge.pair(code);                    // the 6-digit code from the runner's terminal
if (!bridge.sameRepo(owner, repo)) { /* block: the runner serves another clone */ }

const { runId } = await api.check(owner, repo, n, diff);
const status = await bridge.attach(api, runId, { onOutput: (line) => log(line) });
render(status?.check);                      // verdict, repro runs, regression
```

Pairing states and error copy: [`docs/superpowers/specs/2026-09-27-pairing-ux.md`](../docs/superpowers/specs/2026-09-27-pairing-ux.md).
