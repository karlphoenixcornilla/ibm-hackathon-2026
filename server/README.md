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
- PR returns #999.
- `REPRISE_MOCK_RELAY=1` makes acknowledge also send one `exec.request`, so you can build the browser half of the runner relay against it.

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
| POST | `/api/repos/:owner/:repo/issues/:n/pr` | `201 { number, html_url }` (501 until #34) |
| GET | `/api/runs/:id` | `RunStatus` (polling) |
| GET | `/api/runs/:id/events` | SSE stream of `RunStreamEvent` |
| POST | `/api/runs/:id/exec/:reqId` | The browser returns local runner results |
| GET | `/api/health`, `/api/openapi.json` | Public |

## How it works

- **Auth.** `POST /api/session` checks the token with GitHub `GET /user` and keeps it in memory only. The browser gets an opaque `httpOnly; SameSite=Strict` cookie. The token is never written to disk, returned or logged. A session ends on sign-out, after 1 h idle or 8 h total, or when the server restarts. State-changing requests must come from an allowed `Origin`.
- **Runs.** Acknowledge and propose return `202 { runId }`. Follow a run with `GET /api/runs/:id/events` (SSE; buffered events replay first) or poll `GET /api/runs/:id`. A run is visible only to the session that started it.
- **Local runner relay.** The hosted server can't reach `127.0.0.1` on your machine, so it goes through the browser:
  1. When core needs a local test run, the server sends `exec.request { reqId, request }` on the run's stream.
  2. The browser forwards `request` to its paired runner (`POST /runs`, as today).
  3. The browser posts `{ ok: true, results }` or `{ ok: false, error }` to `POST /api/runs/:id/exec/:reqId`.

  The local executor counts as available only once a browser subscribes to the run (it waits up to 10 s).
- **Repo files** are read from the GitHub contents API (default branch), read-only.
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
