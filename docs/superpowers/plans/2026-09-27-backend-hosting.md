# Backend + Hosting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deployable Fastify server (`server/`). It serves the Review UI and the app API from the spec, runs `@reprise/core` behind the endpoints, and ships to Render's free tier through Docker and CI.

**Architecture:** `buildApp(options)` assembles the routes over five units:
- an in-memory `SessionStore` (holds the GitHub token behind an httpOnly cookie)
- a `RunRegistry` (per-run event buffer, SSE fan-out and the relay's pending map)
- a `RelayExecutor` (core `Executor` that round-trips `RunRequest`s through the browser)
- a read-only GitHub-contents `FileSystem`
- a `CoreFactory` (real `buildCore` or mock `buildFakeCore`)

Mock mode serves the same routes and contract on fakes for the UI team.

**Tech Stack:** Node 22, TypeScript 5.7 (CommonJS, like core), Fastify 5, @fastify/cookie, @fastify/static, js-yaml, Ajv (tests only), node:test, Docker, Render blueprint, GitHub Actions.

Spec: `docs/superpowers/specs/2026-09-27-backend-hosting-design.md`.

**Prerequisite:** core must be built (`cd core && npm ci && npm run build`) because the server imports `@reprise/core` from `core/out`.

---

## File map

| File | Responsibility |
|---|---|
| `server/package.json`, `tsconfig.json`, `eslint.config.mjs` | Package setup, which mirrors `core/` |
| `server/src/api/types.ts` | The typed API contract (types only, no runtime deps) |
| `server/src/api/client.ts` | Typed fetch/EventSource client for the UI |
| `server/openapi.yaml` | The published OpenAPI 3.1 contract |
| `server/src/config.ts` | Env → `ServerConfig` |
| `server/src/session.ts` | `SessionStore` (in memory, idle and absolute TTL) |
| `server/src/runs.ts` | `Run` + `RunRegistry` (events, SSE subscribers, relay pending map) |
| `server/src/relay-executor.ts` | `RelayExecutor implements Executor` |
| `server/src/github-fs.ts` | Read-only `FileSystem` over the GitHub contents API |
| `server/src/handlers.ts` | `ProposeHandler`/`PrHandler` interfaces + default stubs |
| `server/src/mock.ts` | Mock core, scripted pipeline, canned proposal/PR, mock token validator |
| `server/src/core-factory.ts` | `CoreFactory` interface + real factory |
| `server/src/app.ts` | `buildApp(options)`: plugins, hooks, routes |
| `server/src/routes/session.ts`, `issues.ts`, `runs.ts`, `static.ts` | Route groups |
| `server/src/main.ts` | Entrypoint: env → `buildApp` → listen, plus graceful shutdown |
| `server/public/index.html` | Placeholder UI until #33 lands |
| `server/fixtures/record-7.json` | Complete sample `IssueRecord` for mock mode |
| `server/test/*.test.ts` | Tests |
| `Dockerfile`, `.dockerignore`, `render.yaml` | Deploy |
| `.github/workflows/ci.yml` | `server` + `deploy` jobs |
| `server/README.md` | How to run, mock, deploy |

---

### Task 1: Scaffold the `server/` package

**Files:**
- Create: `server/package.json`, `server/tsconfig.json`, `server/eslint.config.mjs`, `server/.gitignore`
- Test: `server/test/smoke.test.ts`

- [ ] **Step 1: Create `server/package.json`**

```json
{
  "name": "@reprise/server",
  "version": "0.1.0",
  "description": "Reprise backend: serves the Review UI and the app API over @reprise/core.",
  "license": "MIT",
  "private": true,
  "main": "./out/src/main.js",
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src test",
    "pretest": "tsc",
    "test": "node --test \"out/test/**/*.test.js\"",
    "start": "node out/src/main.js",
    "dev": "tsc && node out/src/main.js",
    "dev:mock": "tsc && node -e \"process.env.REPRISE_MOCK='1'; require('./out/src/main.js')\""
  },
  "dependencies": {
    "@fastify/cookie": "^11.1.2",
    "@fastify/static": "^8.0.0",
    "@reprise/core": "file:../core",
    "fastify": "^5.2.0",
    "js-yaml": "^4.1.0"
  },
  "devDependencies": {
    "@types/js-yaml": "^4.0.9",
    "@types/node": "^22.0.0",
    "@typescript-eslint/eslint-plugin": "^8.0.0",
    "@typescript-eslint/parser": "^8.0.0",
    "ajv": "^8.17.0",
    "eslint": "^9.0.0",
    "typescript": "^5.7.0"
  }
}
```

(`@fastify/static` 8.x targets Fastify 5 with Node 20+. Run `npm view @fastify/static@8 fastify` if unsure and use whichever major supports `fastify@5`.)

- [ ] **Step 2: Create `server/tsconfig.json`** (same as core's)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "lib": ["ES2022", "DOM"],
    "types": ["node"],
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "rootDir": ".",
    "outDir": "./out",
    "sourceMap": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*", "test/**/*"],
  "exclude": ["node_modules", "out"]
}
```

- [ ] **Step 3: Create `server/eslint.config.mjs`**

Copy `core/eslint.config.mjs` and change `files: ['src/**/*.ts']` to `files: ['src/**/*.ts', 'test/**/*.ts']`. Also change the header comment to `// eslint.config.mjs — ESLint flat config for @reprise/server`.

- [ ] **Step 4: Create `server/.gitignore`**

```
node_modules/
out/
```

- [ ] **Step 5: Write the smoke test `server/test/smoke.test.ts`**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFakeCore } from '@reprise/core';

test('@reprise/core resolves from the server package', () => {
  const core = buildFakeCore();
  assert.equal(typeof core.pipeline.acknowledge, 'function');
});
```

- [ ] **Step 6: Install and run**

Run: `cd core && npm ci && npm run build && cd ../server && npm install && npm test`
Expected: `# pass 1`. `server/package-lock.json` is created.

- [ ] **Step 7: Commit**

```bash
git add server
git commit -m "chore(server): scaffold @reprise/server package"
```

---

### Task 2: API contract types + OpenAPI document

**Files:**
- Create: `server/src/api/types.ts`, `server/openapi.yaml`
- Test: `server/test/openapi.test.ts`

- [ ] **Step 1: Create `server/src/api/types.ts`**

```ts
// api/types.ts — the Reprise app API contract (issue #30).
// Types only: the Review UI (#33) can import or copy this file with no runtime deps.
// The same contract is published as server/openapi.yaml and served at /api/openapi.json.

import type {
  CoreEvent, Diagnosis, GitHubIssue, IssueRecord, RunRequest, RunResult, TrialsPolicy,
} from '@reprise/core';

export type { CoreEvent, Diagnosis, GitHubIssue, IssueRecord, RunRequest, RunResult, TrialsPolicy };

export interface ApiError { error: string }

export interface SessionRequest { token: string }
export interface SessionInfo { login: string }

export interface AcknowledgeRequest { trials?: Partial<TrialsPolicy> }
export interface RunAccepted { runId: string }

export type RunKind = 'acknowledge' | 'propose';
export type RunState = 'running' | 'succeeded' | 'failed';

export interface Proposal {
  /** Where the bug is. */
  locations: Diagnosis['locations'];
  /** Why it happens. */
  root_cause: string;
  fix_direction: string;
  confidence: 'high' | 'medium' | 'low';
  /** The proposed fix as a unified diff. */
  diff: string;
  pr_draft: { title: string; body: string };
}

export interface RunStatus {
  id: string;
  kind: RunKind;
  state: RunState;
  repo: string;
  issue: number;
  started_at: string;
  finished_at: string | null;
  record: IssueRecord | null;
  proposal: Proposal | null;
  error: string | null;
}

/** Events on GET /api/runs/:id/events (each SSE `data:` line is one JSON-encoded event). */
export type RunStreamEvent =
  | { type: 'core'; event: CoreEvent }
  | { type: 'exec.request'; reqId: string; request: RunRequest }
  | { type: 'exec.output'; reqId: string; line: string }
  | { type: 'run.done'; status: RunStatus }
  | { type: 'run.failed'; status: RunStatus };

/** Body of POST /api/runs/:id/exec/:reqId — the browser's answer to an exec.request. */
export type ExecResult =
  | { ok: true; results: RunResult[] }
  | { ok: false; error: string };

export interface PrRequest { diff: string; title: string; body: string; draft: boolean }
export interface PrCreated { number: number; html_url: string }

export interface Health { ok: true; mode: 'real' | 'mock' }
```

- [ ] **Step 2: Create `server/openapi.yaml`**

```yaml
openapi: 3.1.0
info:
  title: Reprise app API
  version: 0.1.0
  description: |
    Backend API for the Reprise Review UI (issue #30).
    Auth: POST /api/session with a GitHub token sets the httpOnly `reprise_sid` cookie.
    Long-running operations return 202 { runId }; follow GET /api/runs/{id}/events (SSE)
    or poll GET /api/runs/{id}. TypeScript types: server/src/api/types.ts.
servers:
  - url: /
components:
  securitySchemes:
    session:
      type: apiKey
      in: cookie
      name: reprise_sid
  parameters:
    owner: { name: owner, in: path, required: true, schema: { type: string, pattern: '^[A-Za-z0-9_.-]+$' } }
    repo: { name: repo, in: path, required: true, schema: { type: string, pattern: '^[A-Za-z0-9_.-]+$' } }
    n: { name: n, in: path, required: true, schema: { type: integer, minimum: 1 } }
    runId: { name: id, in: path, required: true, schema: { type: string } }
  responses:
    Error:
      description: Error
      content: { application/json: { schema: { $ref: '#/components/schemas/ApiError' } } }
  schemas:
    ApiError:
      type: object
      required: [error]
      properties: { error: { type: string } }
    SessionInfo:
      type: object
      required: [login]
      properties: { login: { type: string } }
    Health:
      type: object
      required: [ok, mode]
      properties:
        ok: { const: true }
        mode: { enum: [real, mock] }
    GitHubIssue:
      type: object
      required: [number, title, html_url, state, labels, created_at, updated_at]
      properties:
        number: { type: integer }
        title: { type: string }
        html_url: { type: string }
        state: { enum: [open, closed] }
        labels: { type: array, items: { type: string } }
        created_at: { type: string }
        updated_at: { type: string }
    IssueRecord:
      description: Schema-3 issue record (core/src/contracts/records.ts, schemas/issue-record.schema.json).
      type: object
      required: [schema, repo, issue, title, url, state, replication, fix, events]
      properties:
        schema: { const: 3 }
        repo: { type: string }
        issue: { type: integer }
        title: { type: string }
        url: { type: string }
        state: { type: string }
        replication: { type: object }
        fix: { type: object }
        events: { type: array }
    Location:
      type: object
      required: [file, start_line, end_line, reason]
      properties:
        file: { type: string }
        start_line: { type: integer }
        end_line: { type: integer }
        reason: { type: string }
    Proposal:
      type: object
      required: [locations, root_cause, fix_direction, confidence, diff, pr_draft]
      properties:
        locations: { type: array, items: { $ref: '#/components/schemas/Location' } }
        root_cause: { type: string }
        fix_direction: { type: string }
        confidence: { enum: [high, medium, low] }
        diff: { type: string, description: Unified diff }
        pr_draft:
          type: object
          required: [title, body]
          properties: { title: { type: string }, body: { type: string } }
    RunAccepted:
      type: object
      required: [runId]
      properties: { runId: { type: string } }
    RunStatus:
      type: object
      required: [id, kind, state, repo, issue, started_at, finished_at, record, proposal, error]
      properties:
        id: { type: string }
        kind: { enum: [acknowledge, propose] }
        state: { enum: [running, succeeded, failed] }
        repo: { type: string }
        issue: { type: integer }
        started_at: { type: string }
        finished_at: { type: [string, 'null'] }
        record: { oneOf: [{ $ref: '#/components/schemas/IssueRecord' }, { type: 'null' }] }
        proposal: { oneOf: [{ $ref: '#/components/schemas/Proposal' }, { type: 'null' }] }
        error: { type: [string, 'null'] }
    CoreEvent:
      description: core/src/contracts/services.ts CoreEvent
      type: object
      required: [type]
      properties:
        type: { enum: [record.updated, status, info, error] }
    RunRequest:
      description: core/src/contracts/execution.ts RunRequest — forward verbatim to the runner's POST /runs.
      type: object
      required: [platform, mode, test_path, runs, ref]
    RunStreamEvent:
      oneOf:
        - type: object
          required: [type, event]
          properties: { type: { const: core }, event: { $ref: '#/components/schemas/CoreEvent' } }
        - type: object
          required: [type, reqId, request]
          properties: { type: { const: exec.request }, reqId: { type: string }, request: { $ref: '#/components/schemas/RunRequest' } }
        - type: object
          required: [type, reqId, line]
          properties: { type: { const: exec.output }, reqId: { type: string }, line: { type: string } }
        - type: object
          required: [type, status]
          properties: { type: { enum: [run.done, run.failed] }, status: { $ref: '#/components/schemas/RunStatus' } }
    ExecResult:
      oneOf:
        - type: object
          required: [ok, results]
          properties: { ok: { const: true }, results: { type: array, items: { type: object } } }
        - type: object
          required: [ok, error]
          properties: { ok: { const: false }, error: { type: string } }
    PrRequest:
      type: object
      required: [diff, title, body, draft]
      properties:
        diff: { type: string }
        title: { type: string, minLength: 1 }
        body: { type: string }
        draft: { type: boolean }
    PrCreated:
      type: object
      required: [number, html_url]
      properties: { number: { type: integer }, html_url: { type: string } }
security:
  - session: []
paths:
  /api/health:
    get:
      security: []
      responses:
        '200': { description: OK, content: { application/json: { schema: { $ref: '#/components/schemas/Health' } } } }
  /api/openapi.json:
    get:
      security: []
      responses:
        '200': { description: This document as JSON }
  /api/session:
    post:
      security: []
      requestBody:
        required: true
        content:
          application/json:
            schema: { type: object, required: [token], properties: { token: { type: string, minLength: 1 } } }
      responses:
        '200': { description: Signed in; sets reprise_sid, content: { application/json: { schema: { $ref: '#/components/schemas/SessionInfo' } } } }
        '401': { $ref: '#/components/responses/Error' }
    get:
      responses:
        '200': { description: Current session, content: { application/json: { schema: { $ref: '#/components/schemas/SessionInfo' } } } }
        '401': { $ref: '#/components/responses/Error' }
    delete:
      responses:
        '204': { description: Signed out; token dropped from memory }
  /api/repos/{owner}/{repo}/issues:
    parameters: [{ $ref: '#/components/parameters/owner' }, { $ref: '#/components/parameters/repo' }]
    get:
      responses:
        '200': { description: Open issues with the configured labels, content: { application/json: { schema: { type: array, items: { $ref: '#/components/schemas/GitHubIssue' } } } } }
        '401': { $ref: '#/components/responses/Error' }
        '502': { $ref: '#/components/responses/Error' }
  /api/repos/{owner}/{repo}/issues/{n}/record:
    parameters: [{ $ref: '#/components/parameters/owner' }, { $ref: '#/components/parameters/repo' }, { $ref: '#/components/parameters/n' }]
    get:
      responses:
        '200': { description: Issue record, content: { application/json: { schema: { $ref: '#/components/schemas/IssueRecord' } } } }
        '404': { $ref: '#/components/responses/Error' }
  /api/repos/{owner}/{repo}/issues/{n}/acknowledge:
    parameters: [{ $ref: '#/components/parameters/owner' }, { $ref: '#/components/parameters/repo' }, { $ref: '#/components/parameters/n' }]
    post:
      requestBody:
        content:
          application/json:
            schema: { type: object, properties: { trials: { type: object } } }
      responses:
        '202': { description: Evidence pipeline started, content: { application/json: { schema: { $ref: '#/components/schemas/RunAccepted' } } } }
  /api/repos/{owner}/{repo}/issues/{n}/propose:
    parameters: [{ $ref: '#/components/parameters/owner' }, { $ref: '#/components/parameters/repo' }, { $ref: '#/components/parameters/n' }]
    post:
      responses:
        '202': { description: Agentic proposal started; RunStatus.proposal holds the result, content: { application/json: { schema: { $ref: '#/components/schemas/RunAccepted' } } } }
  /api/repos/{owner}/{repo}/issues/{n}/pr:
    parameters: [{ $ref: '#/components/parameters/owner' }, { $ref: '#/components/parameters/repo' }, { $ref: '#/components/parameters/n' }]
    post:
      requestBody:
        required: true
        content: { application/json: { schema: { $ref: '#/components/schemas/PrRequest' } } }
      responses:
        '201': { description: PR created, content: { application/json: { schema: { $ref: '#/components/schemas/PrCreated' } } } }
        '501': { $ref: '#/components/responses/Error' }
        '502': { $ref: '#/components/responses/Error' }
  /api/runs/{id}:
    parameters: [{ $ref: '#/components/parameters/runId' }]
    get:
      responses:
        '200': { description: Run status, content: { application/json: { schema: { $ref: '#/components/schemas/RunStatus' } } } }
        '404': { $ref: '#/components/responses/Error' }
  /api/runs/{id}/events:
    parameters: [{ $ref: '#/components/parameters/runId' }]
    get:
      description: Server-sent events. Replays buffered events, then streams live ones; closes after run.done/run.failed.
      responses:
        '200': { description: 'text/event-stream; each data line is a RunStreamEvent', content: { text/event-stream: { schema: { $ref: '#/components/schemas/RunStreamEvent' } } } }
        '404': { $ref: '#/components/responses/Error' }
  /api/runs/{id}/exec/{reqId}:
    parameters: [{ $ref: '#/components/parameters/runId' }, { name: reqId, in: path, required: true, schema: { type: string } }]
    post:
      description: The browser posts the local runner's result for an exec.request.
      requestBody:
        required: true
        content: { application/json: { schema: { $ref: '#/components/schemas/ExecResult' } } }
      responses:
        '204': { description: Accepted }
        '404': { $ref: '#/components/responses/Error' }
```

- [ ] **Step 3: Write `server/test/openapi.test.ts`**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadOpenApi, schemaValidator } from './helpers/openapi';

test('openapi.yaml parses and compiles every component schema', () => {
  const doc = loadOpenApi();
  assert.equal(doc.openapi, '3.1.0');
  const names = Object.keys(doc.components.schemas);
  for (const name of names) {
    assert.doesNotThrow(() => schemaValidator(name), `schema ${name} compiles`);
  }
});

test('Proposal schema rejects a missing diff', () => {
  const validate = schemaValidator('Proposal');
  assert.equal(validate({ locations: [], root_cause: 'x', fix_direction: 'y', confidence: 'high', pr_draft: { title: 't', body: 'b' } }), false);
});
```

- [ ] **Step 4: Create the test helper `server/test/helpers/openapi.ts`**

```ts
// Loads server/openapi.yaml and compiles its component schemas with Ajv (JSON Schema 2020-12).
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import Ajv2020 from 'ajv/dist/2020';
import type { ValidateFunction } from 'ajv';

// Tests run from out/test/helpers; the spec lives at the package root.
const SPEC = path.resolve(__dirname, '../../../openapi.yaml');

interface OpenApiDoc { openapi: string; components: { schemas: Record<string, unknown> } }

let doc: OpenApiDoc | null = null;
let ajv: Ajv2020 | null = null;

export function loadOpenApi(): OpenApiDoc {
  doc ??= yaml.load(fs.readFileSync(SPEC, 'utf8')) as OpenApiDoc;
  return doc;
}

export function schemaValidator(name: string): ValidateFunction {
  if (!ajv) {
    ajv = new Ajv2020({ strict: false, allErrors: true });
    ajv.addSchema({ ...loadOpenApi(), $id: 'openapi' } as object);
  }
  const v = ajv.getSchema(`openapi#/components/schemas/${name}`);
  if (!v) { throw new Error(`No schema ${name}`); }
  return v;
}

export function assertMatches(name: string, value: unknown): void {
  const v = schemaValidator(name);
  if (!v(value)) {
    throw new Error(`${name} mismatch: ${JSON.stringify(v.errors)}\nvalue: ${JSON.stringify(value).slice(0, 500)}`);
  }
}
```

- [ ] **Step 5: Run tests**

Run: `cd server && npm test`
Expected: all pass. If Ajv rejects the whole OpenAPI document as a schema, register only the components instead: `ajv.addSchema({ $id: 'openapi', components: loadOpenApi().components })`. The `$ref`s are all `#/components/...`, so they still resolve.

- [ ] **Step 6: Commit**

```bash
git add server/src/api/types.ts server/openapi.yaml server/test
git commit -m "feat(server): publish the app API contract (types + OpenAPI)"
```

---

### Task 3: Session store

**Files:**
- Create: `server/src/session.ts`
- Test: `server/test/session.test.ts`

- [ ] **Step 1: Write the failing test `server/test/session.test.ts`**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionStore } from '../src/session';

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

test('create → get returns the session with the token', () => {
  const c = clock();
  const store = new SessionStore({ idleMs: 1000, absoluteMs: 5000, now: c.now });
  const s = store.create('tok', 'octocat');
  assert.match(s.id, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(store.get(s.id)?.token, 'tok');
  assert.equal(store.get(s.id)?.login, 'octocat');
});

test('idle expiry, and get() refreshes lastSeen', () => {
  const c = clock();
  const store = new SessionStore({ idleMs: 1000, absoluteMs: 60_000, now: c.now });
  const s = store.create('tok', 'u');
  c.advance(900); assert.ok(store.get(s.id));
  c.advance(900); assert.ok(store.get(s.id), 'refreshed by the previous get');
  c.advance(1001); assert.equal(store.get(s.id), undefined);
});

test('absolute expiry even when active', () => {
  const c = clock();
  const store = new SessionStore({ idleMs: 1000, absoluteMs: 2500, now: c.now });
  const s = store.create('tok', 'u');
  for (let i = 0; i < 3; i++) { c.advance(800); store.get(s.id); }
  assert.equal(store.get(s.id), undefined);
});

test('delete and sweep drop sessions', () => {
  const c = clock();
  const store = new SessionStore({ idleMs: 1000, absoluteMs: 5000, now: c.now });
  const a = store.create('a', 'u');
  store.create('b', 'u');
  store.delete(a.id);
  assert.equal(store.size, 1);
  c.advance(2000);
  store.sweep();
  assert.equal(store.size, 0);
});

test('unknown or empty ids return undefined', () => {
  const store = new SessionStore({ idleMs: 1000, absoluteMs: 5000 });
  assert.equal(store.get(undefined), undefined);
  assert.equal(store.get('nope'), undefined);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && npm test`
Expected: tsc error `Cannot find module '../src/session'`.

- [ ] **Step 3: Implement `server/src/session.ts`**

```ts
// session.ts — GitHub token sessions held in memory only (never written to disk or logged).
// The client holds just an opaque random id in an httpOnly cookie.

import { randomBytes } from 'node:crypto';

export const SESSION_COOKIE = 'reprise_sid';

export interface Session {
  id: string;
  token: string;
  login: string;
  createdAt: number;
  lastSeen: number;
}

export interface SessionStoreOptions {
  /** Drop a session this long after its last use. */
  idleMs: number;
  /** Drop a session this long after creation, however active. */
  absoluteMs: number;
  now?: () => number;
}

export class SessionStore {
  private readonly sessions = new Map<string, Session>();
  private readonly now: () => number;

  constructor(private readonly opts: SessionStoreOptions) {
    this.now = opts.now ?? Date.now;
  }

  create(token: string, login: string): Session {
    const t = this.now();
    const session: Session = { id: randomBytes(32).toString('base64url'), token, login, createdAt: t, lastSeen: t };
    this.sessions.set(session.id, session);
    return session;
  }

  /** Return a live session and refresh its idle timer, or undefined. */
  get(id: string | undefined): Session | undefined {
    if (!id) { return undefined; }
    const s = this.sessions.get(id);
    if (!s) { return undefined; }
    if (this.expired(s)) {
      this.sessions.delete(id);
      return undefined;
    }
    s.lastSeen = this.now();
    return s;
  }

  delete(id: string): void {
    this.sessions.delete(id);
  }

  sweep(): void {
    for (const [id, s] of this.sessions) {
      if (this.expired(s)) { this.sessions.delete(id); }
    }
  }

  get size(): number { return this.sessions.size; }

  private expired(s: Session): boolean {
    const t = this.now();
    return t - s.lastSeen > this.opts.idleMs || t - s.createdAt > this.opts.absoluteMs;
  }
}
```

- [ ] **Step 4: Run tests**

Run: `cd server && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/session.ts server/test/session.test.ts
git commit -m "feat(server): in-memory session store with idle/absolute expiry"
```

---

### Task 4: Run registry

**Files:**
- Create: `server/src/runs.ts`
- Test: `server/test/runs.test.ts`

- [ ] **Step 1: Write the failing test `server/test/runs.test.ts`**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RunRegistry } from '../src/runs';
import type { RunStreamEvent } from '../src/api/types';
import type { RunRequest, RunResult } from '@reprise/core';

const REQ: RunRequest = { platform: 'windows', mode: 'single', test_path: 't.test.js', runs: 1, ref: null };
const RESULT = { exit_code: 1 } as RunResult;

test('runs are scoped to the creating session', () => {
  const reg = new RunRegistry();
  const run = reg.create('s1', 'acknowledge', 'o/r', 7);
  assert.equal(reg.get(run.id, 's1'), run);
  assert.equal(reg.get(run.id, 's2'), undefined);
});

test('subscribe replays buffered events then streams live ones', () => {
  const reg = new RunRegistry();
  const run = reg.create('s', 'acknowledge', 'o/r', 7);
  run.emit({ type: 'core', event: { type: 'status', text: 'one' } });
  const seen: RunStreamEvent[] = [];
  const off = run.subscribe((e) => seen.push(e));
  run.emit({ type: 'core', event: { type: 'status', text: 'two' } });
  off();
  run.emit({ type: 'core', event: { type: 'status', text: 'three' } });
  assert.deepEqual(seen.map((e) => e.type === 'core' && e.event.type === 'status' ? e.event.text : '?'), ['one', 'two']);
  assert.equal(run.subscriberCount, 0);
});

test('succeed/fail set status and emit a terminal event once', () => {
  const reg = new RunRegistry();
  const run = reg.create('s', 'propose', 'o/r', 7);
  const seen: RunStreamEvent[] = [];
  run.subscribe((e) => seen.push(e));
  run.fail('boom');
  run.succeed({});
  const st = run.status();
  assert.equal(st.state, 'failed');
  assert.equal(st.error, 'boom');
  assert.ok(st.finished_at);
  assert.deepEqual(seen.map((e) => e.type), ['run.failed']);
});

test('requestExec emits exec.request and resolves on settleExec', async () => {
  const reg = new RunRegistry();
  const run = reg.create('s', 'acknowledge', 'o/r', 7);
  let reqId = '';
  run.subscribe((e) => { if (e.type === 'exec.request') { reqId = e.reqId; } });
  const p = run.requestExec(REQ, 1000);
  assert.ok(reqId);
  assert.equal(run.settleExec(reqId, { ok: true, results: [RESULT] }), true);
  assert.deepEqual(await p, [RESULT]);
  assert.equal(run.settleExec(reqId, { ok: true, results: [] }), false, 'second settle is rejected');
});

test('requestExec rejects on an error result, on timeout, and on cancel', async () => {
  const reg = new RunRegistry();
  const run = reg.create('s', 'acknowledge', 'o/r', 7);
  const ids: string[] = [];
  run.subscribe((e) => { if (e.type === 'exec.request') { ids.push(e.reqId); } });

  const a = run.requestExec(REQ, 1000);
  run.settleExec(ids[0]!, { ok: false, error: 'runner down' });
  await assert.rejects(a, /runner down/);

  await assert.rejects(run.requestExec(REQ, 10), /timed out/);

  const c = run.requestExec(REQ, 1000);
  run.cancel();
  await assert.rejects(c, /cancelled/);
});

test('sweep drops finished runs older than the retention window', () => {
  let t = 0;
  const reg = new RunRegistry({ retainMs: 1000, now: () => t });
  const done = reg.create('s', 'propose', 'o/r', 1);
  const live = reg.create('s', 'propose', 'o/r', 2);
  done.succeed({});
  t = 2000;
  reg.sweep();
  assert.equal(reg.get(done.id, 's'), undefined);
  assert.equal(reg.get(live.id, 's'), live);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && npm test`
Expected: tsc error `Cannot find module '../src/runs'`.

- [ ] **Step 3: Implement `server/src/runs.ts`**

```ts
// runs.ts — long-running operations (acknowledge / propose) and their event streams.
// A Run buffers every RunStreamEvent so a late SSE subscriber sees the full history,
// and holds the relay's pending exec requests (see relay-executor.ts).

import { randomUUID } from 'node:crypto';
import { CancellationTokenSource } from '@reprise/core';
import type { CancellationToken, IssueRecord, RunRequest, RunResult } from '@reprise/core';
import type { ExecResult, Proposal, RunKind, RunState, RunStatus, RunStreamEvent } from './api/types';

type Listener = (e: RunStreamEvent) => void;

interface PendingExec {
  resolve(results: RunResult[]): void;
  reject(err: Error): void;
}

export class Run {
  readonly id = randomUUID();
  private state: RunState = 'running';
  private readonly startedAt: string;
  private finishedAt: string | null = null;
  private finishedAtMs: number | null = null;
  private record: IssueRecord | null = null;
  private proposal: Proposal | null = null;
  private error: string | null = null;
  private readonly buffer: RunStreamEvent[] = [];
  private readonly listeners = new Set<Listener>();
  private readonly pending = new Map<string, PendingExec>();
  private readonly cts = new CancellationTokenSource();

  constructor(
    readonly sessionId: string,
    readonly kind: RunKind,
    readonly repo: string,
    readonly issue: number,
    private readonly now: () => number,
  ) {
    this.startedAt = new Date(now()).toISOString();
  }

  /** Cancelled when the run is cancelled; pass to core calls. */
  get token(): CancellationToken { return this.cts.token; }
  get subscriberCount(): number { return this.listeners.size; }
  get finished(): boolean { return this.state !== 'running'; }
  get finishedAtMs_(): number | null { return this.finishedAtMs; }

  emit(event: RunStreamEvent): void {
    this.buffer.push(event);
    for (const l of this.listeners) { l(event); }
  }

  /** Replay buffered events, then receive live ones. Returns an unsubscribe function. */
  subscribe(listener: Listener): () => void {
    for (const e of this.buffer) { listener(e); }
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  succeed(result: { record?: IssueRecord | null; proposal?: Proposal | null }): void {
    if (this.finished) { return; }
    this.record = result.record ?? this.record;
    this.proposal = result.proposal ?? this.proposal;
    this.finish('succeeded');
  }

  fail(error: string): void {
    if (this.finished) { return; }
    this.error = error;
    this.finish('failed');
  }

  cancel(): void {
    this.cts.cancel();
    for (const [id, p] of this.pending) {
      this.pending.delete(id);
      p.reject(new Error('Run cancelled.'));
    }
  }

  /** Ask the browser to execute a RunRequest on the local runner; resolve with its results. */
  requestExec(request: RunRequest, timeoutMs: number, token?: CancellationToken): Promise<RunResult[]> {
    const reqId = randomUUID();
    return new Promise<RunResult[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(reqId);
        reject(new Error(`Local runner request timed out after ${Math.round(timeoutMs / 1000)}s.`));
      }, timeoutMs);
      timer.unref();
      const cancelSub = token?.onCancellationRequested(() => {
        if (this.pending.delete(reqId)) {
          clearTimeout(timer);
          reject(new Error('Run cancelled.'));
        }
      });
      const done = () => { clearTimeout(timer); cancelSub?.dispose(); };
      this.pending.set(reqId, {
        resolve: (r) => { done(); resolve(r); },
        reject: (e) => { done(); reject(e); },
      });
      this.emit({ type: 'exec.request', reqId, request });
    });
  }

  /** Deliver the browser's answer. False if reqId is unknown or already settled. */
  settleExec(reqId: string, result: ExecResult): boolean {
    const p = this.pending.get(reqId);
    if (!p) { return false; }
    this.pending.delete(reqId);
    if (result.ok) { p.resolve(result.results); } else { p.reject(new Error(result.error)); }
    return true;
  }

  status(): RunStatus {
    return {
      id: this.id,
      kind: this.kind,
      state: this.state,
      repo: this.repo,
      issue: this.issue,
      started_at: this.startedAt,
      finished_at: this.finishedAt,
      record: this.record,
      proposal: this.proposal,
      error: this.error,
    };
  }

  private finish(state: RunState): void {
    this.state = state;
    this.finishedAtMs = this.now();
    this.finishedAt = new Date(this.finishedAtMs).toISOString();
    this.cancel();
    const status = this.status();
    this.emit(state === 'succeeded' ? { type: 'run.done', status } : { type: 'run.failed', status });
  }
}

export interface RunRegistryOptions {
  /** Keep finished runs this long so clients can still read the result. Default 1 h. */
  retainMs?: number;
  now?: () => number;
}

export class RunRegistry {
  private readonly runs = new Map<string, Run>();
  private readonly retainMs: number;
  private readonly now: () => number;

  constructor(opts: RunRegistryOptions = {}) {
    this.retainMs = opts.retainMs ?? 60 * 60 * 1000;
    this.now = opts.now ?? Date.now;
  }

  create(sessionId: string, kind: RunKind, repo: string, issue: number): Run {
    const run = new Run(sessionId, kind, repo, issue, this.now);
    this.runs.set(run.id, run);
    return run;
  }

  /** A run is visible only to the session that started it. */
  get(id: string, sessionId: string): Run | undefined {
    const run = this.runs.get(id);
    return run && run.sessionId === sessionId ? run : undefined;
  }

  sweep(): void {
    const t = this.now();
    for (const [id, run] of this.runs) {
      const at = run.finishedAtMs_;
      if (at !== null && t - at > this.retainMs) { this.runs.delete(id); }
    }
  }
}
```

Note: `finish()` calls `cancel()`, which rejects any relay request still pending when the run ends. Rename the awkward `finishedAtMs_` getter if you like, but keep it public for `RunRegistry.sweep()`.

- [ ] **Step 4: Run tests**

Run: `cd server && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/runs.ts server/test/runs.test.ts
git commit -m "feat(server): run registry with buffered events and relay requests"
```

---

### Task 5: RelayExecutor

**Files:**
- Create: `server/src/relay-executor.ts`
- Test: `server/test/relay-executor.test.ts`

- [ ] **Step 1: Write the failing test `server/test/relay-executor.test.ts`**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neverCancelled } from '@reprise/core';
import type { RunEvent, RunRequest, RunResult } from '@reprise/core';
import { RunRegistry } from '../src/runs';
import { RelayExecutor } from '../src/relay-executor';

const REQ: RunRequest = { platform: 'windows', mode: 'single', test_path: 't.test.js', runs: 2, ref: null };

test('unavailable until a browser is subscribed to the run', async () => {
  const run = new RunRegistry().create('s', 'acknowledge', 'o/r', 1);
  const relay = new RelayExecutor(run, 1000);
  assert.equal(relay.id, 'local');
  assert.equal((await relay.available()).available, false);
  run.subscribe(() => undefined);
  assert.deepEqual(await relay.available(), { available: true });
});

test('run() round-trips through the browser and replays results as events', async () => {
  const run = new RunRegistry().create('s', 'acknowledge', 'o/r', 1);
  const results = [{ exit_code: 1 }, { exit_code: 0 }] as RunResult[];
  run.subscribe((e) => {
    if (e.type === 'exec.request') {
      assert.deepEqual(e.request, REQ);
      queueMicrotask(() => run.settleExec(e.reqId, { ok: true, results }));
    }
  });
  const events: RunEvent[] = [];
  const out = await new RelayExecutor(run, 1000).run(REQ, neverCancelled, (ev) => events.push(ev));
  assert.deepEqual(out, results);
  assert.deepEqual(events.map((e) => e.type), ['result', 'result', 'done']);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && npm test`
Expected: tsc error `Cannot find module '../src/relay-executor'`.

- [ ] **Step 3: Implement `server/src/relay-executor.ts`**

```ts
// relay-executor.ts — the backend's "local" executor.
// A hosted backend cannot reach the user's runner on 127.0.0.1, so each RunRequest is sent
// to the browser as an `exec.request` SSE event; the browser forwards it to its paired
// runner and POSTs the results back to /api/runs/:id/exec/:reqId.

import type { Availability, CancellationToken, Executor, RunEvent, RunRequest, RunResult } from '@reprise/core';
import type { Run } from './runs';

export class RelayExecutor implements Executor {
  readonly id = 'local' as const;

  constructor(private readonly run: Run, private readonly timeoutMs: number) {}

  async available(): Promise<Availability> {
    return this.run.subscriberCount > 0
      ? { available: true }
      : { available: false, reason: 'Open the Review UI to connect your local runner.' };
  }

  async run(req: RunRequest, token: CancellationToken, onEvent: (event: RunEvent) => void): Promise<RunResult[]> {
    const results = await this.run.requestExec(req, this.timeoutMs, token);
    for (const result of results) { onEvent({ type: 'result', result }); }
    onEvent({ type: 'done' });
    return results;
  }
}
```

The field `run` and the method `run` clash in TypeScript. Name the field `target` instead: `constructor(private readonly target: Run, ...)`, and use `this.target` in both methods.

- [ ] **Step 4: Run tests**

Run: `cd server && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/relay-executor.ts server/test/relay-executor.test.ts
git commit -m "feat(server): RelayExecutor routes local runs through the browser"
```

---

### Task 6: Read-only GitHub FileSystem

**Files:**
- Create: `server/src/github-fs.ts`
- Test: `server/test/github-fs.test.ts`

- [ ] **Step 1: Write the failing test `server/test/github-fs.test.ts`**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGitHubFileSystem } from '../src/github-fs';

test('readFile fetches raw contents with the token', async () => {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const fs = createGitHubFileSystem({
    repo: 'o/r',
    token: 'tok',
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), headers: init?.headers as Record<string, string> });
      return new Response('version: 3\n', { status: 200 });
    },
  });
  assert.equal(fs.getRoot(), 'github:o/r');
  const text = new TextDecoder().decode(await fs.readFile('.reprise.yml'));
  assert.equal(text, 'version: 3\n');
  assert.equal(calls[0]!.url, 'https://api.github.com/repos/o/r/contents/.reprise.yml');
  assert.equal(calls[0]!.headers['Authorization'], 'Bearer tok');
  assert.equal(calls[0]!.headers['Accept'], 'application/vnd.github.raw+json');
});

test('path segments are encoded; 404 throws', async () => {
  let seen = '';
  const fs = createGitHubFileSystem({
    repo: 'o/r', token: 't',
    fetchImpl: async (url) => { seen = String(url); return new Response('nope', { status: 404 }); },
  });
  await assert.rejects(fs.readFile('src/a b.ts'), /404/);
  assert.equal(seen, 'https://api.github.com/repos/o/r/contents/src/a%20b.ts');
});

test('writeFile is refused', async () => {
  const fs = createGitHubFileSystem({ repo: 'o/r', token: 't', fetchImpl: async () => new Response('') });
  await assert.rejects(fs.writeFile('x', new Uint8Array()), /read-only/i);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && npm test`
Expected: tsc error `Cannot find module '../src/github-fs'`.

- [ ] **Step 3: Implement `server/src/github-fs.ts`**

```ts
// github-fs.ts — a read-only FileSystem over the GitHub contents API (default branch).
// Lets hosted core read .reprise.yml and source files without a checkout.
// Writes go to the user's machine through the runner (#31), never from here.

import type { FileSystem } from '@reprise/core';

export interface GitHubFileSystemOptions {
  repo: string;
  token: string;
  fetchImpl?: typeof fetch;
}

export function createGitHubFileSystem(opts: GitHubFileSystemOptions): FileSystem {
  const doFetch = opts.fetchImpl ?? fetch;
  return {
    getRoot: () => `github:${opts.repo}`,
    async readFile(path: string): Promise<Uint8Array> {
      const encoded = path.split('/').map(encodeURIComponent).join('/');
      const res = await doFetch(`https://api.github.com/repos/${opts.repo}/contents/${encoded}`, {
        headers: {
          Authorization: `Bearer ${opts.token}`,
          Accept: 'application/vnd.github.raw+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });
      if (!res.ok) { throw new Error(`GitHub contents ${res.status} for ${path}`); }
      return new Uint8Array(await res.arrayBuffer());
    },
    async writeFile(): Promise<void> {
      throw new Error('Read-only: the hosted backend does not write repository files (local writes go through the runner).');
    },
  };
}
```

- [ ] **Step 4: Run tests**

Run: `cd server && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/github-fs.ts server/test/github-fs.test.ts
git commit -m "feat(server): read-only FileSystem over the GitHub contents API"
```

---

### Task 7: Handlers, mock core and core factory

**Files:**
- Create: `server/src/handlers.ts`, `server/src/mock.ts`, `server/src/core-factory.ts`, `server/fixtures/record-7.json`
- Test: `server/test/core-factory.test.ts`

- [ ] **Step 1: Create `server/fixtures/record-7.json`**

This is a complete schema-3 record. The mock pipeline copies it and rewrites `repo`/`issue`/`title`/`url`.

```json
{
  "schema": 3,
  "repo": "demo-owner/demo-app",
  "issue": 7,
  "title": "Login crashes on Android 14 with biometric enabled",
  "url": "https://github.com/demo-owner/demo-app/issues/7",
  "state": "CONFIRMED",
  "provider": "stub",
  "stubbed": true,
  "created_at": "2026-09-26T09:00:00Z",
  "updated_at": "2026-09-26T09:03:00Z",
  "replication": {
    "verdict": "CONFIRMED",
    "acknowledged_by": "mock-user",
    "started_at": "2026-09-26T09:00:00Z",
    "finished_at": "2026-09-26T09:03:00Z",
    "duration_ms": 180000,
    "fingerprint": {
      "platform": "android",
      "component": "auth",
      "functions": ["LoginActivity.onBiometricResult"],
      "symptom": "App closes after the biometric prompt",
      "trigger": "Sign in with biometrics enabled on Android 14",
      "expected": "User is signed in",
      "actual": "NullPointerException, app exits",
      "error_signature": "java.lang.NullPointerException at LoginActivity.onBiometricResult"
    },
    "duplicate": { "of": null, "score": null, "fields": {}, "reason": "", "behaviour_check": null },
    "question": "",
    "repro": {
      "test_origin": "generated",
      "test_file": "app/src/androidTest/LoginBiometricTest.kt",
      "test_sha256": "0000000000000000000000000000000000000000000000000000000000000000",
      "branch": "reprise/7-repro",
      "signature": { "kind": "exception", "pattern": "NullPointerException" },
      "attempts": 1,
      "run_context": {
        "platform": "android",
        "executor": "local",
        "method": "repo_command",
        "host_os": "linux",
        "device": "Pixel 7 emulator (API 34)",
        "ci_run_url": null,
        "runner_version": "mock"
      },
      "trials": 10,
      "failed": 10,
      "invalid": 0,
      "sequence": "FFFFFFFFFF",
      "trials_policy": { "min": 10, "max": 20, "limit": 100, "max_minutes": null, "source": "config", "stopped_by": "all_failed_at_min" },
      "rate": 1,
      "wilson_low": 0.7225,
      "wilson_high": 1
    },
    "diagnosis": {
      "summary": "onBiometricResult dereferences the cached session before it is restored on a cold start, so the callback throws when Android 14 delivers the result first.",
      "locations": [
        { "file": "app/src/main/java/LoginActivity.kt", "start_line": 42, "end_line": 48, "reason": "session is null when the biometric callback fires before onResume" }
      ],
      "fix_direction": "Guard the callback until the session is restored, or restore the session before showing the prompt.",
      "confidence": "high",
      "accepted_by": "",
      "edited": false
    }
  },
  "fix": { "iterations": [] },
  "resolution_note": "",
  "usage": { "provider": "stub", "calls": 3, "by_stage": { "intake": 1, "test": 1, "rootcause": 1 } },
  "events": [
    { "at": "2026-09-26T09:00:00Z", "type": "acknowledged", "detail": "mock-user" },
    { "at": "2026-09-26T09:03:00Z", "type": "verdict", "detail": "CONFIRMED 10/10" }
  ]
}
```

Before committing, check the enum values against `core/src/contracts/enums.ts` (`TestOrigin`, `SignatureKind`, `State`, `Verdict`, `Platform`). If one differs, use the enum's spelling. The compile-time check in Step 5's test (`const r: IssueRecord = fixture`) catches this.

- [ ] **Step 2: Create `server/src/handlers.ts`**

```ts
// handlers.ts — seams for the agentic proposal (#32) and PR creation (#34).
// Routes call these; the defaults are stubs until those issues provide real implementations.

import type { CoreServices } from '@reprise/core';
import type { PrCreated, PrRequest, Proposal } from './api/types';

export interface HandlerContext {
  core: CoreServices;
  repo: string;
  issue: number;
  token: string;
}

export interface ProposeHandler {
  propose(ctx: HandlerContext): Promise<Proposal>;
}

export interface PrHandler {
  createPr(ctx: HandlerContext, input: PrRequest): Promise<PrCreated>;
}

/** Thrown by a handler that is not wired yet; routes map it to 501. */
export class NotImplementedError extends Error {}

/** Until #32: build a proposal from the record's diagnosis, with no diff. */
export const diagnosisProposeHandler: ProposeHandler = {
  async propose({ core, repo, issue }) {
    const loaded = await core.store.load(repo, issue);
    if (!loaded.ok) { throw new Error(loaded.error); }
    if (!loaded.value) { throw new Error(`No record for ${repo}#${issue}: acknowledge the issue first.`); }
    const d = loaded.value.replication.diagnosis;
    return {
      locations: d.locations,
      root_cause: d.summary,
      fix_direction: d.fix_direction,
      confidence: d.confidence,
      diff: '',
      pr_draft: { title: `Fix #${issue}: ${loaded.value.title}`, body: `Fixes #${issue}.\n\n${d.summary}` },
    };
  },
};

/** Until #34: PR creation is not available. */
export const notImplementedPrHandler: PrHandler = {
  async createPr() {
    throw new NotImplementedError('PR creation is not implemented yet (#34).');
  },
};
```

- [ ] **Step 3: Create `server/src/mock.ts`**

```ts
// mock.ts — mock mode (REPRISE_MOCK=1): the real routes and contract over fake services,
// so the Review UI (#33) can be built with no token, repository or runner.

import { buildFakeCore, createNotifier, FakeGitHub, Result } from '@reprise/core';
import type { CoreServices, IssueRecord, PipelineService } from '@reprise/core';
import fixture from '../fixtures/record-7.json';
import type { Proposal } from './api/types';
import type { PrHandler, ProposeHandler } from './handlers';

export const MOCK_LOGIN = 'mock-user';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function mockRecord(repo: string, issue: number, title: string): IssueRecord {
  const r = structuredClone(fixture) as unknown as IssueRecord;
  const now = new Date().toISOString();
  return { ...r, repo, issue, title, url: `https://github.com/${repo}/issues/${issue}`, updated_at: now };
}

/** FakeGitHub that remembers records written by the mock pipeline. */
class MockGitHub extends FakeGitHub {
  constructor(private readonly records: Map<string, IssueRecord>) { super(); }
  override async readRecord(repo: string, issue: number) {
    return Result.ok(this.records.get(`${repo}#${issue}`) ?? null);
  }
  override async writeRecord(repo: string, issue: number, record: IssueRecord) {
    this.records.set(`${repo}#${issue}`, record);
    return Result.ok(undefined);
  }
}

export interface MockOptions {
  /** Delay between scripted pipeline steps. Default 800 ms; tests use 0. */
  stepMs?: number;
  /** Also send one exec.request through the relay during acknowledge (REPRISE_MOCK_RELAY=1). */
  relay?: boolean;
}

/** Shared state for one mock app instance. */
export class MockWorld {
  readonly records = new Map<string, IssueRecord>();
  constructor(readonly opts: MockOptions = {}) {}

  buildCore(): CoreServices {
    const github = new MockGitHub(this.records);
    const core = buildFakeCore({ github, notifier: createNotifier() });
    core.store = {
      load: (repo, issue) => github.readRecord(repo, issue),
      save: (record) => github.writeRecord(record.repo, record.issue, record),
      getCached: (repo, issue) => this.records.get(`${repo}#${issue}`) ?? null,
      invalidate: () => undefined,
    };
    core.pipeline = this.scriptedPipeline(core, github);
    return core;
  }

  private scriptedPipeline(core: CoreServices, github: MockGitHub): PipelineService {
    const stepMs = this.opts.stepMs ?? 800;
    const relay = this.opts.relay ?? false;
    const acknowledge: PipelineService['acknowledge'] = async (repo, issue) => {
      const issues = await github.listIssues(repo);
      const title = (issues.ok ? issues.value.find((i) => i.number === issue)?.title : undefined) ?? `Issue #${issue}`;
      const steps = ['Intake: reading the report', 'Writing a reproduction test', 'Running trials', 'Diagnosing root cause'];
      for (const text of steps) {
        core.notifier.emit({ type: 'status', text });
        await sleep(stepMs);
      }
      if (relay) {
        await core.executors.local.run(
          { platform: 'android', mode: 'single', test_path: 'app/src/androidTest/LoginBiometricTest.kt', runs: 1, ref: null },
          { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => undefined }) },
          () => undefined,
        );
      }
      const record = mockRecord(repo, issue, title);
      await github.writeRecord(repo, issue, record);
      core.notifier.emit({ type: 'record.updated', repo, issue, state: record.state });
      return Result.ok(record);
    };
    return {
      acknowledge,
      runMoreTrials: async (repo, issue) => acknowledge(repo, issue),
    };
  }
}

export const MOCK_DIFF = `--- a/app/src/main/java/LoginActivity.kt
+++ b/app/src/main/java/LoginActivity.kt
@@ -42,7 +42,10 @@ class LoginActivity : AppCompatActivity() {
     override fun onBiometricResult(result: BiometricResult) {
-        val user = session.user
+        val user = session?.user ?: run {
+            pendingResult = result
+            return
+        }
         signIn(user, result.cryptoObject)
     }
`;

export const mockProposeHandler: ProposeHandler = {
  async propose({ core, repo, issue }) {
    const loaded = await core.store.load(repo, issue);
    const rec = loaded.ok && loaded.value ? loaded.value : mockRecord(repo, issue, `Issue #${issue}`);
    const d = rec.replication.diagnosis;
    const proposal: Proposal = {
      locations: d.locations,
      root_cause: d.summary,
      fix_direction: d.fix_direction,
      confidence: d.confidence,
      diff: MOCK_DIFF,
      pr_draft: {
        title: `Fix #${issue}: guard biometric callback until session is restored`,
        body: `Fixes #${issue}.\n\n**Root cause:** ${d.summary}\n\n**Evidence:** reproduced 10/10 (Wilson 95% CI 0.72–1.00).`,
      },
    };
    return proposal;
  },
};

export const mockPrHandler: PrHandler = {
  async createPr({ repo }) {
    return { number: 999, html_url: `https://github.com/${repo}/pull/999` };
  },
};

export async function mockValidateToken(token: string): Promise<string | null> {
  return token.trim() ? MOCK_LOGIN : null;
}
```

For `import fixture from '../fixtures/record-7.json'` to compile, `resolveJsonModule` must be on (it is, from Task 1). The `rootDir: "."` setting then puts the JSON at `out/fixtures/record-7.json`.

- [ ] **Step 4: Create `server/src/core-factory.ts`**

```ts
// core-factory.ts — builds a core container per request/run.
// Real mode: buildCore over the GitHub contents FileSystem with the session's token held in
// memory. When a Run is given, core events are forwarded to it and the local executor is
// replaced by the browser relay.

import { buildCore, createMemoryTokenStore, createNotifier } from '@reprise/core';
import type { CoreServices } from '@reprise/core';
import { createGitHubFileSystem } from './github-fs';
import { RelayExecutor } from './relay-executor';
import type { Run } from './runs';
import type { MockWorld } from './mock';

export interface CoreRequest {
  token: string;
  repo: string;
  run?: Run;
}

export type CoreFactory = (req: CoreRequest) => CoreServices;

function attachRun(core: CoreServices, run: Run, relayTimeoutMs: number): CoreServices {
  core.notifier.onEvent((event) => run.emit({ type: 'core', event }));
  core.executors.local = new RelayExecutor(run, relayTimeoutMs);
  return core;
}

export function realCoreFactory(relayTimeoutMs: number): CoreFactory {
  return ({ token, repo, run }) => {
    const core = buildCore({
      fileSystem: createGitHubFileSystem({ repo, token }),
      tokenStore: createMemoryTokenStore(token),
      notifier: createNotifier(),
    });
    return run ? attachRun(core, run, relayTimeoutMs) : core;
  };
}

export function mockCoreFactory(world: MockWorld, relayTimeoutMs: number): CoreFactory {
  return ({ run }) => {
    const core = world.buildCore();
    return run ? attachRun(core, run, relayTimeoutMs) : core;
  };
}
```

- [ ] **Step 5: Write the test `server/test/core-factory.test.ts`**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { IssueRecord } from '@reprise/core';
import fixture from '../fixtures/record-7.json';
import { MockWorld } from '../src/mock';
import { mockCoreFactory, realCoreFactory } from '../src/core-factory';
import { RunRegistry } from '../src/runs';
import type { RunStreamEvent } from '../src/api/types';

// Compile-time check that the fixture is a valid IssueRecord.
const _typed: IssueRecord = fixture as IssueRecord;
void _typed;

test('real factory wires the token and swaps in the relay when given a run', () => {
  const run = new RunRegistry().create('s', 'acknowledge', 'o/r', 1);
  const core = realCoreFactory(1000)({ token: 'tok', repo: 'o/r', run });
  assert.equal(core.auth.getToken(), 'tok');
  assert.equal(core.executors.local.constructor.name, 'RelayExecutor');
  const seen: RunStreamEvent[] = [];
  run.subscribe((e) => seen.push(e));
  core.notifier.emit({ type: 'info', message: 'hi' });
  assert.deepEqual(seen, [{ type: 'core', event: { type: 'info', message: 'hi' } }]);
});

test('mock acknowledge emits progress and stores a record', async () => {
  const world = new MockWorld({ stepMs: 0 });
  const run = new RunRegistry().create('s', 'acknowledge', 'demo-owner/demo-app', 7);
  const core = mockCoreFactory(world, 1000)({ token: 'x', repo: 'demo-owner/demo-app', run });
  const seen: RunStreamEvent[] = [];
  run.subscribe((e) => seen.push(e));
  const r = await core.pipeline.acknowledge('demo-owner/demo-app', 7);
  assert.ok(r.ok);
  assert.equal(r.value.issue, 7);
  assert.ok(seen.some((e) => e.type === 'core' && e.event.type === 'record.updated'));
  const again = await mockCoreFactory(world, 1000)({ token: 'x', repo: 'demo-owner/demo-app' }).store.load('demo-owner/demo-app', 7);
  assert.ok(again.ok && again.value, 'record visible to later requests');
});
```

In the test, `r.value` only type-checks after narrowing. Write `if (!r.ok) { assert.fail(r.error); }` before using `r.value`.

- [ ] **Step 6: Run tests**

Run: `cd server && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/handlers.ts server/src/mock.ts server/src/core-factory.ts server/fixtures server/test/core-factory.test.ts
git commit -m "feat(server): core factory (real + mock), handler seams for #32/#34"
```

---

### Task 8: App skeleton — config, health, OpenAPI, static, auth + Origin hooks

**Files:**
- Create: `server/src/config.ts`, `server/src/app.ts`, `server/src/routes/static.ts`, `server/public/index.html`
- Test: `server/test/app.test.ts`, `server/test/helpers/app.ts`

- [ ] **Step 1: Create `server/src/config.ts`**

```ts
// config.ts — server configuration from environment variables.

import * as path from 'node:path';
import * as fs from 'node:fs';

export interface ServerConfig {
  port: number;
  host: string;
  mode: 'real' | 'mock';
  /** Origins allowed to make state-changing requests (the deployed site, plus dev servers). */
  allowedOrigins: string[];
  /** Whether to mark the session cookie Secure (true when served over https). */
  secureCookies: boolean;
  /** Directory with the built Review UI. */
  webDir: string;
  relayTimeoutMs: number;
  mockRelay: boolean;
}

const PACKAGE_ROOT = path.resolve(__dirname, '../..');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const port = Number(env['PORT'] ?? 8787);
  const publicOrigin =
    env['PUBLIC_ORIGIN'] ??
    env['RENDER_EXTERNAL_URL'] ??
    (env['RENDER_EXTERNAL_HOSTNAME'] ? `https://${env['RENDER_EXTERNAL_HOSTNAME']}` : `http://localhost:${port}`);
  const extra = (env['EXTRA_ORIGINS'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const builtUi = path.resolve(PACKAGE_ROOT, '../web/dist');
  return {
    port,
    host: env['HOST'] ?? '0.0.0.0',
    mode: env['REPRISE_MOCK'] === '1' ? 'mock' : 'real',
    allowedOrigins: [publicOrigin.replace(/\/$/, ''), ...extra],
    secureCookies: publicOrigin.startsWith('https://'),
    webDir: env['WEB_DIR'] ?? (fs.existsSync(builtUi) ? builtUi : path.join(PACKAGE_ROOT, 'public')),
    relayTimeoutMs: Number(env['RELAY_TIMEOUT_MS'] ?? 10 * 60 * 1000),
    mockRelay: env['REPRISE_MOCK_RELAY'] === '1',
  };
}

export { PACKAGE_ROOT };
```

- [ ] **Step 2: Create `server/public/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Reprise</title>
  <style>
    body { font: 16px/1.5 system-ui, sans-serif; max-width: 40rem; margin: 4rem auto; padding: 0 1rem; color: #1f2328; background: #fff; }
    @media (prefers-color-scheme: dark) { body { color: #e6edf3; background: #0d1117; } a { color: #58a6ff; } }
    code { font-size: 0.9em; }
  </style>
</head>
<body>
  <h1>Reprise</h1>
  <p>The backend is running. The Review UI (#33) will be served here once it is built into <code>web/dist</code>.</p>
  <p>API contract: <a href="/api/openapi.json">/api/openapi.json</a> · Health: <a href="/api/health">/api/health</a></p>
</body>
</html>
```

- [ ] **Step 3: Create `server/src/routes/static.ts`**

```ts
// routes/static.ts — serve the Review UI with an SPA fallback; unknown /api paths get JSON 404s.

import type { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';

export async function staticRoutes(app: FastifyInstance, opts: { webDir: string }): Promise<void> {
  await app.register(fastifyStatic, { root: opts.webDir, wildcard: false });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/') || req.method !== 'GET') {
      return reply.code(404).send({ error: 'Not found' });
    }
    return reply.type('text/html').sendFile('index.html');
  });
}
```

With `wildcard: false`, @fastify/static registers a route per file at startup. Assets added to `webDir` later need a restart, which is fine for a built UI.

- [ ] **Step 4: Create `server/src/app.ts`** (routes from later tasks are added here as they land)

```ts
// app.ts — assemble the Fastify app. No listen(); main.ts does that, tests use inject().

import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import { SESSION_COOKIE, SessionStore } from './session';
import type { Session } from './session';
import { RunRegistry } from './runs';
import type { CoreFactory } from './core-factory';
import type { PrHandler, ProposeHandler } from './handlers';
import { PACKAGE_ROOT } from './config';
import type { ServerConfig } from './config';
import { staticRoutes } from './routes/static';

declare module 'fastify' {
  interface FastifyRequest {
    session: Session | null;
  }
}

export interface AppOptions {
  config: ServerConfig;
  coreFactory: CoreFactory;
  /** Resolve a GitHub token to its login, or null if GitHub rejects it. */
  validateToken(token: string): Promise<string | null>;
  propose: ProposeHandler;
  pr: PrHandler;
  sessions?: SessionStore;
  runs?: RunRegistry;
  /** Fastify logger option (true, false, or pino options with a stream). */
  logger?: boolean | object;
}

export interface AppContext extends AppOptions {
  sessions: SessionStore;
  runs: RunRegistry;
}

const PUBLIC_API = new Set(['/api/health', '/api/openapi.json', '/api/session']);
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const ctx: AppContext = {
    ...options,
    sessions: options.sessions ?? new SessionStore({ idleMs: 60 * 60 * 1000, absoluteMs: 8 * 60 * 60 * 1000 }),
    runs: options.runs ?? new RunRegistry(),
  };

  const app = Fastify({
    logger: options.logger ?? {
      redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
    },
    trustProxy: true,
  });

  await app.register(fastifyCookie);
  app.decorateRequest('session', null);

  // CSRF defence in depth (on top of SameSite=Strict): unsafe methods need a known Origin or none.
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/') || !UNSAFE.has(req.method)) { return; }
    const origin = req.headers.origin;
    if (origin && !ctx.config.allowedOrigins.includes(origin)) {
      return reply.code(403).send({ error: 'Origin not allowed' });
    }
  });

  // Session: attach it when present; require it outside the public endpoints.
  app.addHook('preHandler', async (req, reply) => {
    req.session = ctx.sessions.get(req.cookies[SESSION_COOKIE]) ?? null;
    const route = req.routeOptions.url ?? '';
    if (!route.startsWith('/api/') || PUBLIC_API.has(route)) { return; }
    if (!req.session) { return reply.code(401).send({ error: 'Not signed in' }); }
  });

  const spec = yaml.load(fs.readFileSync(path.join(PACKAGE_ROOT, 'openapi.yaml'), 'utf8'));
  app.get('/api/health', async () => ({ ok: true, mode: ctx.config.mode }));
  app.get('/api/openapi.json', async () => spec);

  await app.register(staticRoutes, { webDir: ctx.config.webDir });

  const sweeper = setInterval(() => { ctx.sessions.sweep(); ctx.runs.sweep(); }, 60_000);
  sweeper.unref();
  app.addHook('onClose', async () => clearInterval(sweeper));

  return app;
}
```

- [ ] **Step 5: Create the test helper `server/test/helpers/app.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app';
import type { AppOptions } from '../../src/app';
import { loadConfig } from '../../src/config';
import { MockWorld, mockPrHandler, mockProposeHandler, mockValidateToken } from '../../src/mock';
import { mockCoreFactory } from '../../src/core-factory';

export const ORIGIN = 'http://localhost:8787';

export async function mockApp(overrides: Partial<AppOptions> = {}): Promise<FastifyInstance> {
  const config = { ...loadConfig({ REPRISE_MOCK: '1' }), relayTimeoutMs: 1000 };
  const world = new MockWorld({ stepMs: 0 });
  return buildApp({
    config,
    coreFactory: mockCoreFactory(world, config.relayTimeoutMs),
    validateToken: mockValidateToken,
    propose: mockProposeHandler,
    pr: mockPrHandler,
    logger: false,
    ...overrides,
  });
}

/** Sign in and return the cookie header value to send on later requests. */
export async function signIn(app: FastifyInstance, token = 'tok'): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/session', payload: { token } });
  if (res.statusCode !== 200) { throw new Error(`sign-in failed: ${res.statusCode} ${res.body}`); }
  const c = res.cookies.find((x) => x.name === 'reprise_sid');
  if (!c) { throw new Error('no session cookie'); }
  return `reprise_sid=${c.value}`;
}
```

- [ ] **Step 6: Write `server/test/app.test.ts`**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockApp } from './helpers/app';
import { assertMatches } from './helpers/openapi';

test('GET /api/health is public', async () => {
  const app = await mockApp();
  const res = await app.inject({ method: 'GET', url: '/api/health' });
  assert.equal(res.statusCode, 200);
  assertMatches('Health', res.json());
  assert.deepEqual(res.json(), { ok: true, mode: 'mock' });
});

test('GET /api/openapi.json serves the spec', async () => {
  const app = await mockApp();
  const res = await app.inject({ method: 'GET', url: '/api/openapi.json' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().openapi, '3.1.0');
});

test('unknown /api path → JSON 404; other paths → UI index', async () => {
  const app = await mockApp();
  const api = await app.inject({ method: 'GET', url: '/api/nope' });
  assert.equal(api.statusCode, 404);
  assertMatches('ApiError', api.json());
  const ui = await app.inject({ method: 'GET', url: '/issues/7' });
  assert.equal(ui.statusCode, 200);
  assert.match(ui.body, /<title>Reprise<\/title>/);
});

test('cross-origin POST is rejected', async () => {
  const app = await mockApp();
  const res = await app.inject({
    method: 'POST', url: '/api/session', payload: { token: 't' }, headers: { origin: 'https://evil.example' },
  });
  assert.equal(res.statusCode, 403);
});
```

In the 404 case, `/api/nope` has no route, so `req.routeOptions.url` is undefined and the auth hook lets it fall through to the not-found handler. That is intended: unknown paths return 404, not 401.

- [ ] **Step 7: Run tests**

Run: `cd server && npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/src/config.ts server/src/app.ts server/src/routes/static.ts server/public server/test
git commit -m "feat(server): app skeleton with health, OpenAPI, UI serving, auth + Origin hooks"
```

---

### Task 9: Session routes

**Files:**
- Create: `server/src/routes/session.ts`
- Modify: `server/src/app.ts` (register the routes)
- Test: `server/test/session-routes.test.ts`

- [ ] **Step 1: Write the failing test `server/test/session-routes.test.ts`**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { mockApp, signIn } from './helpers/app';
import { assertMatches } from './helpers/openapi';

test('sign in → whoami → sign out', async () => {
  const app = await mockApp();
  const login = await app.inject({ method: 'POST', url: '/api/session', payload: { token: 'ghp_secret123' } });
  assert.equal(login.statusCode, 200);
  assertMatches('SessionInfo', login.json());
  assert.ok(!login.body.includes('ghp_secret123'), 'token never echoed');
  const cookie = login.cookies.find((c) => c.name === 'reprise_sid')!;
  assert.equal(cookie.httpOnly, true);
  assert.equal(cookie.sameSite, 'Strict');
  assert.equal(cookie.path, '/api');

  const headers = { cookie: `reprise_sid=${cookie.value}` };
  const me = await app.inject({ method: 'GET', url: '/api/session', headers });
  assert.deepEqual(me.json(), { login: 'mock-user' });

  const out = await app.inject({ method: 'DELETE', url: '/api/session', headers });
  assert.equal(out.statusCode, 204);
  const after = await app.inject({ method: 'GET', url: '/api/session', headers });
  assert.equal(after.statusCode, 401);
});

test('rejected token → 401; missing token → 400', async () => {
  const app = await mockApp({ validateToken: async () => null });
  const bad = await app.inject({ method: 'POST', url: '/api/session', payload: { token: 'x' } });
  assert.equal(bad.statusCode, 401);
  assertMatches('ApiError', bad.json());
  const missing = await app.inject({ method: 'POST', url: '/api/session', payload: {} });
  assert.equal(missing.statusCode, 400);
});

test('protected endpoints require a session', async () => {
  const app = await mockApp();
  const res = await app.inject({ method: 'GET', url: '/api/repos/o/r/issues' });
  assert.equal(res.statusCode, 401);
});

test('the token never reaches the logs', async () => {
  let logs = '';
  const stream = new Writable({ write(chunk, _enc, cb) { logs += chunk.toString(); cb(); } });
  const app = await mockApp({ logger: { level: 'trace', stream } });
  const cookie = await signIn(app, 'ghp_supersecret');
  await app.inject({ method: 'GET', url: '/api/session', headers: { cookie } });
  assert.ok(logs.length > 0, 'something was logged');
  assert.ok(!logs.includes('ghp_supersecret'));
  assert.ok(!logs.includes(cookie.split('=')[1]!), 'session id not logged');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && npm test`
Expected: FAIL. `POST /api/session` returns 404.

- [ ] **Step 3: Implement `server/src/routes/session.ts`**

```ts
// routes/session.ts — exchange a GitHub token for an in-memory session (httpOnly cookie).

import type { FastifyInstance } from 'fastify';
import { SESSION_COOKIE } from '../session';
import type { AppContext } from '../app';
import type { SessionRequest } from '../api/types';

export async function sessionRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const cookieOpts = {
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: ctx.config.secureCookies,
    path: '/api',
  };

  app.post<{ Body: SessionRequest }>('/api/session', {
    schema: {
      body: {
        type: 'object',
        required: ['token'],
        properties: { token: { type: 'string', minLength: 1 } },
      },
    },
  }, async (req, reply) => {
    const login = await ctx.validateToken(req.body.token);
    if (!login) { return reply.code(401).send({ error: 'GitHub rejected the token.' }); }
    if (req.session) { ctx.sessions.delete(req.session.id); }
    const session = ctx.sessions.create(req.body.token, login);
    reply.setCookie(SESSION_COOKIE, session.id, cookieOpts);
    return { login };
  });

  app.get('/api/session', async (req) => ({ login: req.session!.login }));

  app.delete('/api/session', async (req, reply) => {
    ctx.sessions.delete(req.session!.id);
    reply.clearCookie(SESSION_COOKIE, cookieOpts);
    return reply.code(204).send();
  });
}
```

`GET`/`DELETE /api/session` are *not* in the public set. In the auth hook, `PUBLIC_API` checks only the route URL, not the method, so `/api/session` is public for all methods. Change the check in `app.ts` so only `POST /api/session` is public:

```ts
// in app.ts, replace the PUBLIC_API set and the check with:
const PUBLIC_API = new Set(['GET /api/health', 'GET /api/openapi.json', 'POST /api/session']);
// …inside the preHandler hook:
    if (!route.startsWith('/api/') || PUBLIC_API.has(`${req.method} ${route}`)) { return; }
```

- [ ] **Step 4: Add a default `validateToken` for real mode in `server/src/routes/session.ts`**

```ts
/** Real-mode validator: GET /user with the token; return the login, or null on non-200. */
export async function validateWithGitHub(token: string): Promise<string | null> {
  const res = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
  });
  if (!res.ok) { return null; }
  const body = (await res.json()) as { login?: string };
  return body.login ?? null;
}
```

- [ ] **Step 5: Register in `server/src/app.ts`**

Add `import { sessionRoutes } from './routes/session';`. Then add this line right before `await app.register(staticRoutes, ...)`:

```ts
  await sessionRoutes(app, ctx);
```

(The routes are registered directly on `app`, not through `app.register`, so they share the root hooks and decorators.)

- [ ] **Step 6: Run tests**

Run: `cd server && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/session.ts server/src/app.ts server/test/session-routes.test.ts
git commit -m "feat(server): session endpoints (token held in memory, httpOnly cookie)"
```

---

### Task 10: Issue routes (issues, record, acknowledge, propose, pr)

**Files:**
- Create: `server/src/routes/issues.ts`
- Modify: `server/src/app.ts`
- Test: `server/test/issues-routes.test.ts`

- [ ] **Step 1: Write the failing test `server/test/issues-routes.test.ts`**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockApp, signIn } from './helpers/app';
import { assertMatches } from './helpers/openapi';
import type { RunStatus } from '../src/api/types';
import type { FastifyInstance } from 'fastify';

const BASE = '/api/repos/demo-owner/demo-app/issues';

async function waitForRun(app: FastifyInstance, cookie: string, runId: string): Promise<RunStatus> {
  for (let i = 0; i < 100; i++) {
    const res = await app.inject({ method: 'GET', url: `/api/runs/${runId}`, headers: { cookie } });
    const st = res.json() as RunStatus;
    if (st.state !== 'running') { return st; }
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('run did not finish');
}

test('lists issues', async () => {
  const app = await mockApp();
  const cookie = await signIn(app);
  const res = await app.inject({ method: 'GET', url: BASE, headers: { cookie } });
  assert.equal(res.statusCode, 200);
  const issues = res.json() as unknown[];
  assert.ok(issues.length > 0);
  for (const i of issues) { assertMatches('GitHubIssue', i); }
});

test('bad params → 400', async () => {
  const app = await mockApp();
  const cookie = await signIn(app);
  const res = await app.inject({ method: 'GET', url: '/api/repos/o/r/issues/abc/record', headers: { cookie } });
  assert.equal(res.statusCode, 400);
});

test('record 404 → acknowledge → record 200', async () => {
  const app = await mockApp();
  const cookie = await signIn(app);
  const before = await app.inject({ method: 'GET', url: `${BASE}/7/record`, headers: { cookie } });
  assert.equal(before.statusCode, 404);

  const ack = await app.inject({ method: 'POST', url: `${BASE}/7/acknowledge`, headers: { cookie }, payload: {} });
  assert.equal(ack.statusCode, 202);
  assertMatches('RunAccepted', ack.json());
  const st = await waitForRun(app, cookie, ack.json().runId);
  assertMatches('RunStatus', st);
  assert.equal(st.state, 'succeeded');
  assert.equal(st.record?.issue, 7);

  const after = await app.inject({ method: 'GET', url: `${BASE}/7/record`, headers: { cookie } });
  assert.equal(after.statusCode, 200);
  assertMatches('IssueRecord', after.json());
});

test('propose returns a Proposal', async () => {
  const app = await mockApp();
  const cookie = await signIn(app);
  const res = await app.inject({ method: 'POST', url: `${BASE}/7/propose`, headers: { cookie } });
  assert.equal(res.statusCode, 202);
  const st = await waitForRun(app, cookie, res.json().runId);
  assert.equal(st.state, 'succeeded');
  assertMatches('Proposal', st.proposal);
  assert.match(st.proposal!.diff, /^--- a\//);
});

test('pr creates via the handler; 501 when not implemented', async () => {
  const payload = { diff: 'x', title: 'Fix', body: 'b', draft: true };
  const app = await mockApp();
  const cookie = await signIn(app);
  const ok = await app.inject({ method: 'POST', url: `${BASE}/7/pr`, headers: { cookie }, payload });
  assert.equal(ok.statusCode, 201);
  assertMatches('PrCreated', ok.json());

  const { notImplementedPrHandler } = await import('../src/handlers');
  const app2 = await mockApp({ pr: notImplementedPrHandler });
  const cookie2 = await signIn(app2);
  const ni = await app2.inject({ method: 'POST', url: `${BASE}/7/pr`, headers: { cookie: cookie2 }, payload });
  assert.equal(ni.statusCode, 501);

  const bad = await app.inject({ method: 'POST', url: `${BASE}/7/pr`, headers: { cookie }, payload: { title: '' } });
  assert.equal(bad.statusCode, 400);
});

test('a run is invisible to another session', async () => {
  const app = await mockApp();
  const a = await signIn(app, 'a');
  const b = await signIn(app, 'b');
  const ack = await app.inject({ method: 'POST', url: `${BASE}/7/acknowledge`, headers: { cookie: a }, payload: {} });
  const res = await app.inject({ method: 'GET', url: `/api/runs/${ack.json().runId}`, headers: { cookie: b } });
  assert.equal(res.statusCode, 404);
});
```

(`/api/runs/:id` is added in Task 11. Until then these tests fail on the run polling. Run the full suite after Task 11.)

- [ ] **Step 2: Implement `server/src/routes/issues.ts`**

```ts
// routes/issues.ts — repository issues and the issue-scoped operations.

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppContext } from '../app';
import type { AcknowledgeRequest, PrRequest } from '../api/types';
import { NotImplementedError } from '../handlers';
import type { Run } from '../runs';

interface RepoParams { owner: string; repo: string }
interface IssueParams extends RepoParams { n: number }

const NAME = { type: 'string', pattern: '^[A-Za-z0-9_.-]+$' };
const repoParams = { type: 'object', required: ['owner', 'repo'], properties: { owner: NAME, repo: NAME } };
const issueParams = {
  type: 'object',
  required: ['owner', 'repo', 'n'],
  properties: { owner: NAME, repo: NAME, n: { type: 'integer', minimum: 1 } },
};

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function issueRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  function coreFor(req: FastifyRequest, repo: string, run?: Run) {
    return ctx.coreFactory({ token: req.session!.token, repo, run });
  }

  /** Start a run in the background; the client follows it via /api/runs/:id. */
  function start(req: FastifyRequest, kind: Run['kind'], repo: string, issue: number, work: (run: Run) => Promise<void>) {
    const run = ctx.runs.create(req.session!.id, kind, repo, issue);
    work(run).catch((err) => run.fail(message(err)));
    return { runId: run.id };
  }

  app.get<{ Params: RepoParams }>('/api/repos/:owner/:repo/issues', { schema: { params: repoParams } }, async (req, reply) => {
    const repo = `${req.params.owner}/${req.params.repo}`;
    const core = coreFor(req, repo);
    await core.config.load(); // labels from .reprise.yml; defaults to ['bug'] when absent
    const res = await core.github.listIssues(repo);
    if (!res.ok) { return reply.code(502).send({ error: res.error }); }
    return res.value;
  });

  app.get<{ Params: IssueParams }>('/api/repos/:owner/:repo/issues/:n/record', { schema: { params: issueParams } }, async (req, reply) => {
    const repo = `${req.params.owner}/${req.params.repo}`;
    const res = await coreFor(req, repo).store.load(repo, req.params.n);
    if (!res.ok) { return reply.code(502).send({ error: res.error }); }
    if (!res.value) { return reply.code(404).send({ error: `No record for ${repo}#${req.params.n}` }); }
    return res.value;
  });

  app.post<{ Params: IssueParams; Body: AcknowledgeRequest | undefined }>('/api/repos/:owner/:repo/issues/:n/acknowledge', {
    schema: { params: issueParams, body: { type: ['object', 'null'], properties: { trials: { type: 'object' } } } },
  }, async (req, reply) => {
    const repo = `${req.params.owner}/${req.params.repo}`;
    const issue = req.params.n;
    return reply.code(202).send(start(req, 'acknowledge', repo, issue, async (run) => {
      const core = coreFor(req, repo, run);
      await core.config.load();
      const res = await core.pipeline.acknowledge(repo, issue, req.body?.trials, run.token);
      if (res.ok) { run.succeed({ record: res.value }); } else { run.fail(res.error); }
    }));
  });

  app.post<{ Params: IssueParams }>('/api/repos/:owner/:repo/issues/:n/propose', { schema: { params: issueParams } }, async (req, reply) => {
    const repo = `${req.params.owner}/${req.params.repo}`;
    const issue = req.params.n;
    const token = req.session!.token;
    return reply.code(202).send(start(req, 'propose', repo, issue, async (run) => {
      const core = coreFor(req, repo, run);
      await core.config.load();
      run.succeed({ proposal: await ctx.propose.propose({ core, repo, issue, token }) });
    }));
  });

  app.post<{ Params: IssueParams; Body: PrRequest }>('/api/repos/:owner/:repo/issues/:n/pr', {
    schema: {
      params: issueParams,
      body: {
        type: 'object',
        required: ['diff', 'title', 'body', 'draft'],
        properties: {
          diff: { type: 'string' }, title: { type: 'string', minLength: 1 }, body: { type: 'string' }, draft: { type: 'boolean' },
        },
      },
    },
  }, async (req, reply) => {
    const repo = `${req.params.owner}/${req.params.repo}`;
    const issue = req.params.n;
    try {
      const core = coreFor(req, repo);
      await core.config.load();
      const created = await ctx.pr.createPr({ core, repo, issue, token: req.session!.token }, req.body);
      return reply.code(201).send(created);
    } catch (err) {
      if (err instanceof NotImplementedError) { return reply.code(501).send({ error: err.message }); }
      return reply.code(502).send({ error: message(err) });
    }
  });
}
```

- [ ] **Step 3: Register in `server/src/app.ts`**

Add `import { issueRoutes } from './routes/issues';` and `await issueRoutes(app, ctx);` after `sessionRoutes`.

- [ ] **Step 4: Commit** (the tests pass after Task 11)

```bash
git add server/src/routes/issues.ts server/src/app.ts server/test/issues-routes.test.ts
git commit -m "feat(server): issue endpoints (list, record, acknowledge, propose, pr)"
```

---

### Task 11: Run routes (status, SSE, relay result)

**Files:**
- Create: `server/src/routes/runs.ts`
- Modify: `server/src/app.ts`
- Test: `server/test/runs-routes.test.ts`

- [ ] **Step 1: Write the failing test `server/test/runs-routes.test.ts`**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockApp, signIn } from './helpers/app';
import { assertMatches } from './helpers/openapi';
import { RunRegistry } from '../src/runs';
import type { RunStreamEvent } from '../src/api/types';

function parseSse(body: string): RunStreamEvent[] {
  return body.split('\n\n').filter((b) => b.startsWith('data: ')).map((b) => JSON.parse(b.slice(6)) as RunStreamEvent);
}

test('SSE replays a finished run and closes', async () => {
  const app = await mockApp();
  const cookie = await signIn(app);
  const ack = await app.inject({ method: 'POST', url: '/api/repos/o/r/issues/7/acknowledge', headers: { cookie }, payload: {} });
  const runId = ack.json().runId as string;
  for (let i = 0; i < 100; i++) {
    const st = await app.inject({ method: 'GET', url: `/api/runs/${runId}`, headers: { cookie } });
    if (st.json().state !== 'running') { break; }
    await new Promise((r) => setTimeout(r, 10));
  }
  const res = await app.inject({ method: 'GET', url: `/api/runs/${runId}/events`, headers: { cookie } });
  assert.equal(res.statusCode, 200);
  assert.match(String(res.headers['content-type']), /text\/event-stream/);
  const events = parseSse(res.body);
  for (const e of events) { assertMatches('RunStreamEvent', e); }
  assert.equal(events.at(-1)!.type, 'run.done');
  assert.ok(events.some((e) => e.type === 'core' && e.event.type === 'status'));
});

test('relay round trip over real HTTP: exec.request → POST result → run finishes', async () => {
  const runs = new RunRegistry();
  const app = await mockApp({ runs });
  const { MockWorld } = await import('../src/mock');
  const { mockCoreFactory } = await import('../src/core-factory');
  // Rebuild with relay-enabled mock world.
  await app.close();
  const relayApp = await mockApp({ runs, coreFactory: mockCoreFactory(new MockWorld({ stepMs: 0, relay: true }), 5000) });
  const address = await relayApp.listen({ port: 0, host: '127.0.0.1' });
  try {
    const login = await fetch(`${address}/api/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 't' }) });
    const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
    const ack = await fetch(`${address}/api/repos/o/r/issues/7/acknowledge`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{}' });
    const { runId } = await ack.json() as { runId: string };

    const stream = await fetch(`${address}/api/runs/${runId}/events`, { headers: { cookie } });
    const reader = stream.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    const seen: string[] = [];
    for (;;) {
      const { value, done } = await reader.read();
      if (done) { break; }
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, idx); buf = buf.slice(idx + 2);
        if (!block.startsWith('data: ')) { continue; }
        const e = JSON.parse(block.slice(6)) as RunStreamEvent;
        seen.push(e.type);
        if (e.type === 'exec.request') {
          const post = await fetch(`${address}/api/runs/${runId}/exec/${e.reqId}`, {
            method: 'POST', headers: { cookie, 'content-type': 'application/json' },
            body: JSON.stringify({ ok: true, results: [] }),
          });
          assert.equal(post.status, 204);
          const again = await fetch(`${address}/api/runs/${runId}/exec/${e.reqId}`, {
            method: 'POST', headers: { cookie, 'content-type': 'application/json' },
            body: JSON.stringify({ ok: true, results: [] }),
          });
          assert.equal(again.status, 404, 'already settled');
        }
      }
    }
    assert.ok(seen.includes('exec.request'));
    assert.equal(seen.at(-1), 'run.done');
  } finally {
    await relayApp.close();
  }
});

test('unknown run → 404', async () => {
  const app = await mockApp();
  const cookie = await signIn(app);
  const res = await app.inject({ method: 'GET', url: '/api/runs/nope', headers: { cookie } });
  assert.equal(res.statusCode, 404);
  const ev = await app.inject({ method: 'GET', url: '/api/runs/nope/events', headers: { cookie } });
  assert.equal(ev.statusCode, 404);
});
```

Simplify the relay test's setup when you implement it: create `relayApp` directly and drop the throwaway first `mockApp`.

- [ ] **Step 2: Implement `server/src/routes/runs.ts`**

```ts
// routes/runs.ts — run status, the SSE event stream, and the relay's result endpoint.

import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app';
import type { ExecResult } from '../api/types';

interface RunParams { id: string }
interface ExecParams extends RunParams { reqId: string }

const HEARTBEAT_MS = 15_000;

export async function runRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get<{ Params: RunParams }>('/api/runs/:id', async (req, reply) => {
    const run = ctx.runs.get(req.params.id, req.session!.id);
    if (!run) { return reply.code(404).send({ error: 'Run not found' }); }
    return run.status();
  });

  app.get<{ Params: RunParams }>('/api/runs/:id/events', async (req, reply) => {
    const run = ctx.runs.get(req.params.id, req.session!.id);
    if (!run) { return reply.code(404).send({ error: 'Run not found' }); }

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    let closed = false;
    const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
    heartbeat.unref();
    const close = () => {
      if (closed) { return; }
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      res.end();
    };
    const unsubscribe = run.subscribe((event) => {
      if (closed) { return; }
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      if (event.type === 'run.done' || event.type === 'run.failed') { queueMicrotask(close); }
    });
    req.raw.on('close', close);
  });

  app.post<{ Params: ExecParams; Body: ExecResult }>('/api/runs/:id/exec/:reqId', {
    schema: {
      body: {
        oneOf: [
          { type: 'object', required: ['ok', 'results'], properties: { ok: { const: true }, results: { type: 'array', items: { type: 'object' } } } },
          { type: 'object', required: ['ok', 'error'], properties: { ok: { const: false }, error: { type: 'string' } } },
        ],
      },
    },
  }, async (req, reply) => {
    const run = ctx.runs.get(req.params.id, req.session!.id);
    if (!run || !run.settleExec(req.params.reqId, req.body)) {
      return reply.code(404).send({ error: 'No pending request with that id' });
    }
    return reply.code(204).send();
  });
}
```

`subscribe` replays synchronously, so `unsubscribe` isn't assigned yet while the replay runs. That's why a terminal event only schedules `close` with `queueMicrotask`, which runs after `subscribe` returns. Keep that ordering.

- [ ] **Step 3: Register in `server/src/app.ts`**

Add `import { runRoutes } from './routes/runs';` and `await runRoutes(app, ctx);` after `issueRoutes`.

- [ ] **Step 4: Run all tests**

Run: `cd server && npm test`
Expected: PASS, including Task 10's tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/runs.ts server/src/app.ts server/test/runs-routes.test.ts
git commit -m "feat(server): run status, SSE stream and relay result endpoint"
```

---

### Task 12: Entrypoint + typed client

**Files:**
- Create: `server/src/main.ts`, `server/src/api/client.ts`
- Test: `server/test/client.test.ts`

- [ ] **Step 1: Create `server/src/main.ts`**

```ts
// main.ts — process entrypoint: env → app → listen. Real mode by default; REPRISE_MOCK=1 for mock.

import { buildApp } from './app';
import { loadConfig } from './config';
import { mockCoreFactory, realCoreFactory } from './core-factory';
import { diagnosisProposeHandler, notImplementedPrHandler } from './handlers';
import { MockWorld, mockPrHandler, mockProposeHandler, mockValidateToken } from './mock';
import { validateWithGitHub } from './routes/session';

async function main(): Promise<void> {
  const config = loadConfig();
  const mock = config.mode === 'mock';
  const app = await buildApp({
    config,
    coreFactory: mock
      ? mockCoreFactory(new MockWorld({ relay: config.mockRelay }), config.relayTimeoutMs)
      : realCoreFactory(config.relayTimeoutMs),
    validateToken: mock ? mockValidateToken : validateWithGitHub,
    propose: mock ? mockProposeHandler : diagnosisProposeHandler,
    pr: mock ? mockPrHandler : notImplementedPrHandler,
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => { void app.close().then(() => process.exit(0)); });
  }

  await app.listen({ port: config.port, host: config.host });
  app.log.info({ mode: config.mode, webDir: config.webDir, allowedOrigins: config.allowedOrigins }, 'reprise server ready');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Create `server/src/api/client.ts`**

```ts
// api/client.ts — a typed browser client for the Reprise app API (for the Review UI, #33).
// No Node dependencies: uses fetch + EventSource with same-origin cookies.

import type {
  AcknowledgeRequest, ExecResult, GitHubIssue, IssueRecord, PrCreated, PrRequest,
  RunAccepted, RunStatus, RunStreamEvent, SessionInfo,
} from './types';

export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export class RepriseApi {
  constructor(private readonly base = '', private readonly fetchImpl: typeof fetch = (...a) => fetch(...a)) {}

  signIn(token: string) { return this.call<SessionInfo>('POST', '/api/session', { token }); }
  whoAmI() { return this.call<SessionInfo>('GET', '/api/session'); }
  signOut() { return this.call<void>('DELETE', '/api/session'); }

  listIssues(owner: string, repo: string) {
    return this.call<GitHubIssue[]>('GET', `/api/repos/${owner}/${repo}/issues`);
  }
  getRecord(owner: string, repo: string, n: number) {
    return this.call<IssueRecord>('GET', `/api/repos/${owner}/${repo}/issues/${n}/record`);
  }
  acknowledge(owner: string, repo: string, n: number, body: AcknowledgeRequest = {}) {
    return this.call<RunAccepted>('POST', `/api/repos/${owner}/${repo}/issues/${n}/acknowledge`, body);
  }
  propose(owner: string, repo: string, n: number) {
    return this.call<RunAccepted>('POST', `/api/repos/${owner}/${repo}/issues/${n}/propose`);
  }
  createPr(owner: string, repo: string, n: number, body: PrRequest) {
    return this.call<PrCreated>('POST', `/api/repos/${owner}/${repo}/issues/${n}/pr`, body);
  }
  getRun(id: string) { return this.call<RunStatus>('GET', `/api/runs/${id}`); }
  sendExecResult(runId: string, reqId: string, result: ExecResult) {
    return this.call<void>('POST', `/api/runs/${runId}/exec/${reqId}`, result);
  }

  /** Follow a run's events. Returns a function that stops listening. */
  followRun(id: string, onEvent: (e: RunStreamEvent) => void): () => void {
    const es = new EventSource(`${this.base}/api/runs/${id}/events`);
    es.onmessage = (m) => {
      const e = JSON.parse(m.data as string) as RunStreamEvent;
      onEvent(e);
      if (e.type === 'run.done' || e.type === 'run.failed') { es.close(); }
    };
    return () => es.close();
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.base}${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 204) { return undefined as T; }
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) { throw new ApiError(res.status, data.error ?? res.statusText); }
    return data as T;
  }
}
```

- [ ] **Step 3: Write `server/test/client.test.ts`** (drives the client against the mock app over real HTTP)

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockApp } from './helpers/app';
import { RepriseApi, ApiError } from '../src/api/client';

test('typed client talks to the mock server', async () => {
  const app = await mockApp();
  const base = await app.listen({ port: 0, host: '127.0.0.1' });
  let cookie = '';
  const cookieFetch: typeof fetch = async (input, init) => {
    const res = await fetch(input, { ...init, headers: { ...(init?.headers as Record<string, string>), ...(cookie ? { cookie } : {}) } });
    const set = res.headers.get('set-cookie');
    if (set) { cookie = set.split(';')[0]!; }
    return res;
  };
  try {
    const api = new RepriseApi(base, cookieFetch);
    await assert.rejects(api.whoAmI(), (e: unknown) => e instanceof ApiError && e.status === 401);
    assert.deepEqual(await api.signIn('t'), { login: 'mock-user' });
    const issues = await api.listIssues('demo-owner', 'demo-app');
    assert.ok(issues.length > 0);
    const { runId } = await api.propose('demo-owner', 'demo-app', 7);
    assert.ok(runId);
  } finally {
    await app.close();
  }
});
```

(Node's `fetch` has no cookie jar, hence the `cookieFetch` wrapper. In the browser, `credentials: 'same-origin'` handles cookies.)

- [ ] **Step 4: Run tests, then smoke-run both modes**

Run: `cd server && npm test`
Expected: PASS.

Run: `cd server && REPRISE_MOCK=1 PORT=8799 node out/src/main.js` in the background, then `curl -s localhost:8799/api/health`.
Expected: `{"ok":true,"mode":"mock"}`. Stop the server.

- [ ] **Step 5: Commit**

```bash
git add server/src/main.ts server/src/api/client.ts server/test/client.test.ts
git commit -m "feat(server): entrypoint and typed API client"
```

---

### Task 13: Docker + Render blueprint

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `render.yaml`

- [ ] **Step 1: Create `.dockerignore`**

```
**/node_modules
**/out
.git
ide
extensions
dashboard
docs
runner
templates
```

- [ ] **Step 2: Create `Dockerfile`**

```dockerfile
# Reprise backend (issue #30): builds @reprise/core, then the server, into a slim runtime image.
# The Review UI (#33) will add a web build stage and copy its dist into /app/web/dist.

FROM node:22-slim AS build
WORKDIR /app

COPY core/package.json core/package-lock.json core/
RUN cd core && npm ci
COPY core/ core/
RUN cd core && npm run build && npm prune --omit=dev

COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci
COPY server/ server/
RUN cd server && npm run build && npm prune --omit=dev

FROM node:22-slim
ENV NODE_ENV=production PORT=10000
WORKDIR /app
COPY --from=build /app/core/package.json core/package.json
COPY --from=build /app/core/out core/out
COPY --from=build /app/core/node_modules core/node_modules
COPY --from=build /app/server/package.json server/package.json
COPY --from=build /app/server/openapi.yaml server/openapi.yaml
COPY --from=build /app/server/public server/public
COPY --from=build /app/server/out server/out
COPY --from=build /app/server/node_modules server/node_modules
USER node
WORKDIR /app/server
EXPOSE 10000
CMD ["node", "out/src/main.js"]
```

- [ ] **Step 3: Create `render.yaml`**

```yaml
# Render Blueprint for the Reprise backend (issue #30). Free plan; zero cost (R-13).
# Deploys are triggered by CI (.github/workflows/ci.yml → RENDER_DEPLOY_HOOK) after tests pass.
services:
  - type: web
    name: reprise
    runtime: docker
    plan: free
    dockerfilePath: ./Dockerfile
    dockerContext: .
    healthCheckPath: /api/health
    autoDeployTrigger: "off"
    envVars:
      # PUBLIC_ORIGIN defaults to Render's RENDER_EXTERNAL_URL; set it only for a custom domain.
      - key: AGENT_API_KEY
        sync: false
```

- [ ] **Step 4: Build and run the image locally**

Run: `docker build -t reprise-server . && docker run --rm -d -p 8798:10000 -e REPRISE_MOCK=1 --name reprise-smoke reprise-server`
Then: `curl -s localhost:8798/api/health && curl -s -o /dev/null -w "%{http_code}\n" localhost:8798/`
Expected: `{"ok":true,"mode":"mock"}` then `200`. Then `docker stop reprise-smoke`.

If the `@reprise/core` symlink under `server/node_modules` doesn't resolve at runtime (`Cannot find module '@reprise/core'`), check it with `docker run --rm reprise-server ls -l node_modules/@reprise`. It should point to `../../core`, which exists at `/app/core`.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile .dockerignore render.yaml
git commit -m "build(server): Dockerfile and Render blueprint (free plan)"
```

---

### Task 14: CI jobs

**Files:**
- Modify: `.github/workflows/ci.yml` (append the `server` and `deploy` jobs)

- [ ] **Step 1: Append to `.github/workflows/ci.yml` under `jobs:`**

```yaml
  server:
    name: Server — typecheck, lint, test, docker build
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "npm"
          cache-dependency-path: |
            core/package-lock.json
            server/package-lock.json

      - name: Build core
        run: npm ci && npm run build
        working-directory: core

      - name: Install dependencies
        run: npm ci
        working-directory: server

      - name: TypeScript typecheck
        run: npm run typecheck
        working-directory: server

      - name: ESLint
        run: npm run lint
        working-directory: server

      - name: Unit tests
        run: npm test
        working-directory: server

      - name: Docker build
        run: docker build -t reprise-server .

  deploy:
    name: Deploy to Render
    needs: [core, server]
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest

    steps:
      - name: Trigger Render deploy hook
        env:
          HOOK: ${{ secrets.RENDER_DEPLOY_HOOK }}
        run: |
          if [ -z "$HOOK" ]; then
            echo "::notice::RENDER_DEPLOY_HOOK is not set; skipping deploy"
            exit 0
          fi
          curl -fsS -X POST "$HOOK" > /dev/null
          echo "Render deploy triggered"
```

- [ ] **Step 2: Validate the YAML**

Run: `node -e "require('js-yaml').load(require('fs').readFileSync('.github/workflows/ci.yml','utf8')); console.log('ok')"`, from `server/` so that `js-yaml` resolves, with the path set to `../.github/workflows/ci.yml`.
Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci(server): test + docker build job and Render deploy on main"
```

---

### Task 15: README + final verification

**Files:**
- Create: `server/README.md`

- [ ] **Step 1: Create `server/README.md`**

```markdown
# @reprise/server

The deployable Reprise backend (issue #30). It serves the Review UI and the app API, and runs `@reprise/core` behind the endpoints.

- **Contract:** [`openapi.yaml`](openapi.yaml) (also at `/api/openapi.json`) and [`src/api/types.ts`](src/api/types.ts). A typed browser client is in [`src/api/client.ts`](src/api/client.ts).
- **Design:** [`docs/superpowers/specs/2026-09-27-backend-hosting-design.md`](../docs/superpowers/specs/2026-09-27-backend-hosting-design.md)

## Run it

```sh
(cd ../core && npm ci && npm run build)   # the server imports core from core/out
npm ci
npm run dev:mock    # mock server on :8787, no token/repo/runner needed
npm run dev         # real mode: sign in with a GitHub token via POST /api/session
npm test
```

In mock mode any non-empty token signs you in as `mock-user`. Acknowledge plays a scripted pipeline and then stores a sample record. Propose returns a canned proposal with a diff, and PR returns #999. Set `REPRISE_MOCK_RELAY=1` to make acknowledge also send one `exec.request`, which lets you build the browser half of the runner relay.

If a UI dev server on another port proxies `/api` to this server, add its origin to `EXTRA_ORIGINS`, e.g. `EXTRA_ORIGINS=http://localhost:5173`.

## How it works

- **Auth:** `POST /api/session { token }` checks the token with GitHub `GET /user` and keeps it in memory. The client gets an opaque `httpOnly; SameSite=Strict` cookie. The token is never written to disk, returned or logged. Sessions end on sign-out, after 1 h idle or 8 h total, or on a restart.
- **Runs:** acknowledge and propose return `202 { runId }`. Follow them with `GET /api/runs/:id/events` (SSE) or poll `GET /api/runs/:id`.
- **Local runner relay:** the hosted server can't reach `127.0.0.1` on your machine. When core needs a local test run, the server sends `exec.request { reqId, request }` on the run's SSE stream. The browser forwards `request` to its paired runner (`POST /runs`, as before) and posts `{ ok: true, results }` or `{ ok: false, error }` to `POST /api/runs/:id/exec/:reqId`. The local executor reports itself unavailable unless a browser is subscribed to the run.
- **Repo files:** read-only from the GitHub contents API (default branch).
- **Agent / PR:** `ProposeHandler` and `PrHandler` in `src/handlers.ts` are the seams for #32 and #34.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8787` (`10000` in Docker) | Listen port |
| `PUBLIC_ORIGIN` | `RENDER_EXTERNAL_URL`, else `http://localhost:$PORT` | Allowed Origin for POST/DELETE; `https` enables Secure cookies |
| `EXTRA_ORIGINS` | — | Comma-separated extra allowed origins |
| `REPRISE_MOCK` | — | `1` for mock mode |
| `REPRISE_MOCK_RELAY` | — | `1` to exercise the relay in mock acknowledge |
| `RELAY_TIMEOUT_MS` | `600000` | How long core waits for the browser to return runner results |
| `WEB_DIR` | `../web/dist` if built, else `public/` | Static UI directory |
| `AGENT_API_KEY` | — | LLM key for the agent (#32). Server-side only |

## Deploy (Render, free plan)

1. In Render, go to **New → Blueprint** and pick this repository. It reads `render.yaml`, and you'll be asked for `AGENT_API_KEY` (can stay empty until #32).
2. In the service's settings, go to **Deploy Hook** and copy the URL. Add it as the GitHub Actions secret `RENDER_DEPLOY_HOOK`.
3. Every push to `main` that passes CI triggers a deploy. The app is at `https://<service>.onrender.com`. The free tier sleeps when idle, so the first request takes about 30 s and signs everyone out.
4. Start the runner with `--allow-origin https://<service>.onrender.com` so the browser can reach it.
```

- [ ] **Step 2: Full verification**

Run: `cd server && npm run typecheck && npm run lint && npm test`
Expected: all three succeed; tests `# fail 0`.

Run: `cd core && npm test`
Expected: still passes (unchanged).

Run the Docker build again (Task 13 Step 4).

- [ ] **Step 3: Commit**

```bash
git add server/README.md
git commit -m "docs(server): README for running, mocking and deploying the backend"
```
