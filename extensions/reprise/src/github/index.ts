// github/ — repository linking, issues, Git Data API, PRs, workflow dispatch
// Owned by: T1
// Spec: 02-specs/github-connection.md

import type { GitHubService, GitHubIssue, AuthService, ConfigService } from '../contracts/services';
import type { IssueRecord } from '../contracts/records';
import { Result } from '../util/result';
import { parseGitConfigOrigin, extractOwnerRepo } from '../util/git-helpers';

const API = 'https://api.github.com';
const REPRISE_DATA_BRANCH = 'reprise-data';
const MAX_RETRY = 3;

// ── HTTP helper ───────────────────────────────────────────────────────────────

interface GHOptions {
  method?: string;
  body?: unknown;
  token: string;
}

interface GHResponse<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
  rateLimitReset: number | null;
}

async function ghFetch<T>(
  url: string,
  opts: GHOptions
): Promise<GHResponse<T>> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${opts.token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (err) {
    // Network / CORS failure
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, data: null, error: `Network error: ${msg}`, rateLimitReset: null };
  }

  const rateLimitReset = res.headers.has('x-ratelimit-reset')
    ? parseInt(res.headers.get('x-ratelimit-reset')!, 10)
    : null;

  if (res.status === 429 || res.status === 403) {
    const body = await res.text().catch(() => '');
    const resetAt = rateLimitReset ? new Date(rateLimitReset * 1000).toLocaleTimeString() : 'unknown';
    return {
      ok: false,
      status: res.status,
      data: null,
      error: `GitHub rate limit hit (${res.status}). Resets at ${resetAt}. ${body.slice(0, 200)}`,
      rateLimitReset,
    };
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return {
      ok: false,
      status: res.status,
      data: null,
      error: `GitHub API error ${res.status} on ${url}: ${body.slice(0, 300)}`,
      rateLimitReset: null,
    };
  }

  if (res.status === 204) {
    return { ok: true, status: 204, data: null, rateLimitReset, error: null };
  }

  try {
    const data = (await res.json()) as T;
    return { ok: true, status: res.status, data, rateLimitReset, error: null };
  } catch {
    return { ok: false, status: res.status, data: null, error: 'Failed to parse GitHub response as JSON', rateLimitReset: null };
  }
}

// ── WorkspaceReader type (injected to avoid direct vscode dep in unit tests) ──

type WorkspaceFileReader = (path: string) => Promise<string | null>;

// ── Factory ───────────────────────────────────────────────────────────────────

export function createGitHub(services: {
  auth: AuthService;
  config: ConfigService;
  workspaceReader: WorkspaceFileReader;
}): GitHubService {

  function tok(): string {
    const t = services.auth.getToken();
    if (!t) { throw new Error('Not signed in'); }
    return t;
  }

  // ── detectRepo ────────────────────────────────────────────────────────────

  async function detectRepo(): Promise<Result<string, string>> {
    const readText = async (p: string): Promise<string | null> => {
      const r = await services.workspaceReader(p);
      return r;
    };

    const configText = await readText('.git/config');
    if (!configText) {
      return Result.err(
        'No .git/config found. Open a folder that contains a git repository, ' +
        'or use "Reprise: Link Repository" to enter owner/repo manually.'
      );
    }

    const remoteUrl = parseGitConfigOrigin(configText);
    if (!remoteUrl) {
      return Result.err('No origin remote found in .git/config. Enter owner/repo manually via "Reprise: Link Repository".');
    }

    const ownerRepo = extractOwnerRepo(remoteUrl);
    if (!ownerRepo) {
      return Result.err(`The origin remote (${remoteUrl}) is not a github.com URL. Enter owner/repo manually.`);
    }

    return Result.ok(ownerRepo);
  }

  // ── listIssues ────────────────────────────────────────────────────────────

  async function listIssues(repo: string): Promise<Result<GitHubIssue[], string>> {
    const cfg = services.config.get();
    const labels = cfg?.issues?.labels ?? ['bug'];
    const labelParam = labels.join(',');

    const url = `${API}/repos/${repo}/issues?state=open&labels=${encodeURIComponent(labelParam)}&per_page=100&sort=created&direction=desc`;
    const r = await ghFetch<unknown[]>(url, { token: tok() });
    if (!r.ok) { return Result.err(r.error!); }

    const issues: GitHubIssue[] = (r.data ?? [])
      .filter((i: unknown) => {
        // Exclude pull requests (GitHub returns PRs in issues endpoint)
        return !(i as Record<string, unknown>)['pull_request'];
      })
      .map((i: unknown) => {
        const raw = i as Record<string, unknown>;
        return {
          number: raw['number'] as number,
          title: raw['title'] as string,
          html_url: raw['html_url'] as string,
          state: raw['state'] as 'open' | 'closed',
          labels: ((raw['labels'] as unknown[]) ?? []).map((l: unknown) =>
            typeof l === 'string' ? l : (l as Record<string, unknown>)['name'] as string
          ),
          created_at: raw['created_at'] as string,
          updated_at: raw['updated_at'] as string,
        };
      });

    return Result.ok(issues);
  }

  // ── readRecord ────────────────────────────────────────────────────────────

  async function readRecord(repo: string, issue: number): Promise<Result<IssueRecord | null, string>> {
    // Read issues/<N>.json from the reprise-data branch via Contents API
    const url = `${API}/repos/${repo}/contents/issues/${issue}.json?ref=${REPRISE_DATA_BRANCH}`;
    const r = await ghFetch<Record<string, unknown>>(url, { token: tok() });

    if (!r.ok) {
      // 404 means no record yet — that is not an error
      if (r.status === 404) { return Result.ok(null); }
      return Result.err(r.error!);
    }

    try {
      const content = r.data!['content'] as string;
      const decoded = atob(content.replace(/\n/g, ''));
      const record = JSON.parse(decoded) as IssueRecord;
      // v2 compat: runner_version may be absent on run_context
      return Result.ok(record);
    } catch (err) {
      return Result.err(`Failed to decode/parse issues/${issue}.json: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── writeRecord (Git Data API) ────────────────────────────────────────────

  async function writeRecord(
    repo: string,
    issue: number,
    record: IssueRecord
  ): Promise<Result<void, string>> {
    const path = `issues/${issue}.json`;
    const contentBytes = new TextEncoder().encode(JSON.stringify(record, null, 2));
    const contentB64 = btoa(String.fromCharCode(...contentBytes));

    // 1. Get or create the reprise-data branch
    const headShaResult = await getOrCreateBranch(repo);
    if (!headShaResult.ok) { return headShaResult; }
    let parentSha = headShaResult.value;

    // Retry up to MAX_RETRY times on 422 (concurrent ref update)
    for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
      const commitResult = await commitFile(repo, path, contentB64, parentSha, `chore: update issues/${issue}.json`);
      if (commitResult.ok) { return Result.ok(undefined); }
      if (commitResult.error?.startsWith('REF_CONFLICT:')) {
        // Re-read the current head and retry
        const refR = await ghFetch<{ object: { sha: string } }>(
          `${API}/repos/${repo}/git/refs/heads/${REPRISE_DATA_BRANCH}`,
          { token: tok() }
        );
        if (!refR.ok) { return Result.err(refR.error!); }
        parentSha = refR.data!.object.sha;
        continue;
      }
      return commitResult;
    }
    return Result.err(`Failed to commit after ${MAX_RETRY} retries due to concurrent ref updates.`);
  }

  // ── getOrCreateBranch ─────────────────────────────────────────────────────

  async function getOrCreateBranch(repo: string): Promise<Result<string, string>> {
    const url = `${API}/repos/${repo}/git/refs/heads/${REPRISE_DATA_BRANCH}`;
    const r = await ghFetch<{ object: { sha: string } }>(url, { token: tok() });

    if (r.ok) { return Result.ok(r.data!.object.sha); }
    if (r.status !== 404) { return Result.err(r.error!); }

    // Branch doesn't exist — create it as an orphan commit with an empty tree
    const treeR = await ghFetch<{ sha: string }>(
      `${API}/repos/${repo}/git/trees`,
      { method: 'POST', token: tok(), body: { tree: [] } }
    );
    if (!treeR.ok) { return Result.err(treeR.error!); }

    const commitR = await ghFetch<{ sha: string }>(
      `${API}/repos/${repo}/git/commits`,
      {
        method: 'POST',
        token: tok(),
        body: {
          message: 'chore: initialise reprise-data branch',
          tree: treeR.data!.sha,
          parents: [],
        },
      }
    );
    if (!commitR.ok) { return Result.err(commitR.error!); }

    const createRefR = await ghFetch(
      `${API}/repos/${repo}/git/refs`,
      {
        method: 'POST',
        token: tok(),
        body: { ref: `refs/heads/${REPRISE_DATA_BRANCH}`, sha: commitR.data!.sha },
      }
    );
    if (!createRefR.ok) { return Result.err(createRefR.error!); }

    return Result.ok(commitR.data!.sha);
  }

  // ── commitFile (Git Data API steps 1-4) ───────────────────────────────────

  async function commitFile(
    repo: string,
    path: string,
    contentB64: string,
    parentSha: string,
    message: string
  ): Promise<Result<void, string>> {
    // Step 1: create blob
    const blobR = await ghFetch<{ sha: string }>(
      `${API}/repos/${repo}/git/blobs`,
      { method: 'POST', token: tok(), body: { content: contentB64, encoding: 'base64' } }
    );
    if (!blobR.ok) { return Result.err(blobR.error!); }

    // Step 2: get parent commit tree SHA
    const parentCommitR = await ghFetch<{ tree: { sha: string } }>(
      `${API}/repos/${repo}/git/commits/${parentSha}`,
      { token: tok() }
    );
    if (!parentCommitR.ok) { return Result.err(parentCommitR.error!); }

    // Step 3: create tree
    const treeR = await ghFetch<{ sha: string }>(
      `${API}/repos/${repo}/git/trees`,
      {
        method: 'POST',
        token: tok(),
        body: {
          base_tree: parentCommitR.data!.tree.sha,
          tree: [{ path, mode: '100644', type: 'blob', sha: blobR.data!.sha }],
        },
      }
    );
    if (!treeR.ok) { return Result.err(treeR.error!); }

    // Step 4: create commit
    const commitR = await ghFetch<{ sha: string }>(
      `${API}/repos/${repo}/git/commits`,
      {
        method: 'POST',
        token: tok(),
        body: { message, tree: treeR.data!.sha, parents: [parentSha] },
      }
    );
    if (!commitR.ok) { return Result.err(commitR.error!); }

    // Step 5: update ref (PATCH; no force push)
    const refR = await ghFetch(
      `${API}/repos/${repo}/git/refs/heads/${REPRISE_DATA_BRANCH}`,
      { method: 'PATCH', token: tok(), body: { sha: commitR.data!.sha, force: false } }
    );
    if (!refR.ok) {
      // 422 = someone else moved the ref
      if (refR.status === 422) { return Result.err(`REF_CONFLICT: ${refR.error}`); }
      return Result.err(refR.error!);
    }

    return Result.ok(undefined);
  }

  // ── createOrUpdatePr ──────────────────────────────────────────────────────

  async function createOrUpdatePr(
    repo: string,
    branch: string,
    base: string,
    title: string,
    body: string,
    draft: boolean
  ): Promise<Result<{ number: number; html_url: string }, string>> {
    // Check if a PR already exists for this branch
    const listR = await ghFetch<Array<{ number: number; html_url: string; head: { ref: string } }>>(
      `${API}/repos/${repo}/pulls?state=open&head=${encodeURIComponent(repo.split('/')[0] + ':' + branch)}&base=${encodeURIComponent(base)}`,
      { token: tok() }
    );
    if (!listR.ok) { return Result.err(listR.error!); }

    const existing = (listR.data ?? []).find((pr) => pr.head.ref === branch);
    if (existing) {
      // Update title and body
      const patchR = await ghFetch<{ number: number; html_url: string }>(
        `${API}/repos/${repo}/pulls/${existing.number}`,
        { method: 'PATCH', token: tok(), body: { title, body } }
      );
      if (!patchR.ok) { return Result.err(patchR.error!); }
      return Result.ok({ number: patchR.data!.number, html_url: patchR.data!.html_url });
    }

    // Create new PR
    const createR = await ghFetch<{ number: number; html_url: string }>(
      `${API}/repos/${repo}/pulls`,
      { method: 'POST', token: tok(), body: { title, body, head: branch, base, draft } }
    );
    if (!createR.ok) { return Result.err(createR.error!); }
    return Result.ok({ number: createR.data!.number, html_url: createR.data!.html_url });
  }

  // ── dispatchWorkflow ──────────────────────────────────────────────────────

  async function dispatchWorkflow(
    repo: string,
    inputs: Record<string, string | number>
  ): Promise<Result<{ runId: number }, string>> {
    // Dispatch reprise-run.yml
    const dispatchR = await ghFetch(
      `${API}/repos/${repo}/actions/workflows/reprise-run.yml/dispatches`,
      {
        method: 'POST',
        token: tok(),
        body: { ref: 'main', inputs },
      }
    );
    if (!dispatchR.ok) { return Result.err(dispatchR.error!); }

    // Poll runs list to find the run ID that just started
    await new Promise<void>((r) => setTimeout(r, 3000)); // give GH time to start the run
    const runsR = await ghFetch<{ workflow_runs: Array<{ id: number }> }>(
      `${API}/repos/${repo}/actions/workflows/reprise-run.yml/runs?per_page=1`,
      { token: tok() }
    );
    if (!runsR.ok) { return Result.err(runsR.error!); }
    const runId = runsR.data?.workflow_runs[0]?.id ?? 0;
    return Result.ok({ runId });
  }

  // ── downloadArtifact ──────────────────────────────────────────────────────

  async function downloadArtifact(
    url: string,
    token: string
  ): Promise<Result<Record<string, unknown>, string>> {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
      });
    } catch (err) {
      return Result.err(`Network error downloading artifact: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!res.ok) {
      return Result.err(`Artifact download failed with status ${res.status}`);
    }
    try {
      const data = await res.json() as Record<string, unknown>;
      return Result.ok(data);
    } catch {
      // Binary artifact — return empty record; caller handles raw bytes separately
      return Result.ok({});
    }
  }

  return {
    detectRepo,
    listIssues,
    readRecord,
    writeRecord,
    createOrUpdatePr,
    dispatchWorkflow,
    downloadArtifact,
  };
}

// ── Head SHA helper (re-exported for use by wiring) ──────────────────────────
export { resolveHeadSha } from '../util/git-helpers';
