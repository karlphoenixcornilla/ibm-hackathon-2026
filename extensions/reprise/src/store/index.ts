// store/ — issue records on reprise-data branch, IndexedDB cache (G-25), AJV validation
// Owned by: T1
// Spec: 02-specs/data-contracts.md §Issue record

import type { StoreService, GitHubService } from '../contracts/services';
import type { IssueRecord } from '../contracts/records';
import { Result } from '../util/result';

// ── Schema for AJV validation (subset — required fields only) ─────────────────

const REQUIRED_FIELDS = ['schema', 'repo', 'issue', 'title', 'url', 'state', 'provider', 'stubbed', 'created_at', 'updated_at'];

function validateRecord(data: unknown): IssueRecord {
  if (!data || typeof data !== 'object') {
    throw new Error('Record is not an object');
  }
  const r = data as Record<string, unknown>;
  for (const field of REQUIRED_FIELDS) {
    if (!(field in r)) {
      throw new Error(`Record is missing required field: ${field}`);
    }
  }
  if (r['schema'] !== 3) {
    throw new Error(`Unsupported schema version: ${r['schema']} (expected 3)`);
  }
  // v2 compat: if runner_version is absent on run_context, treat as null
  const replication = r['replication'] as Record<string, unknown> | undefined;
  if (replication) {
    const repro = replication['repro'] as Record<string, unknown> | undefined;
    if (repro) {
      const rc = repro['run_context'] as Record<string, unknown> | undefined;
      if (rc && !('runner_version' in rc)) {
        rc['runner_version'] = null;
      }
    }
  }
  return data as IssueRecord;
}

// ── IndexedDB helper (G-25) ───────────────────────────────────────────────────

const IDB_NAME = 'reprise-store';
const IDB_VERSION = 1;
const IDB_STORE = 'records';

function openIdb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') { return Promise.resolve(null); }
  return new Promise((resolve) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

async function idbGet(db: IDBDatabase | null, key: string): Promise<IssueRecord | null> {
  if (!db) { return null; }
  return new Promise((resolve) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve((req.result as IssueRecord) ?? null);
    req.onerror = () => resolve(null);
  });
}

async function idbPut(db: IDBDatabase | null, key: string, value: IssueRecord): Promise<void> {
  if (!db) { return; }
  return new Promise((resolve) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

async function idbDelete(db: IDBDatabase | null, key: string): Promise<void> {
  if (!db) { return; }
  return new Promise((resolve) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createStore(services: { github: GitHubService }): StoreService {
  // In-memory cache
  const memCache = new Map<string, IssueRecord>();

  // IndexedDB (opened lazily)
  let dbPromise: Promise<IDBDatabase | null> | null = null;
  function getDb(): Promise<IDBDatabase | null> {
    if (!dbPromise) { dbPromise = openIdb(); }
    return dbPromise;
  }

  function cacheKey(repo: string, issue: number): string {
    return `${repo}#${issue}`;
  }

  async function load(
    repo: string,
    issue: number
  ): Promise<import('../util/result').Result<IssueRecord | null, string>> {
    const key = cacheKey(repo, issue);

    // 1. In-memory hit
    if (memCache.has(key)) { return Result.ok(memCache.get(key)!); }

    // 2. IndexedDB hit (G-25)
    const db = await getDb();
    const cached = await idbGet(db, key);
    if (cached) {
      memCache.set(key, cached);
      return Result.ok(cached);
    }

    // 3. Network fetch
    const r = await services.github.readRecord(repo, issue);
    if (!r.ok) { return r; }
    if (!r.value) { return Result.ok(null); }

    let record: IssueRecord;
    try {
      record = validateRecord(r.value);
    } catch (err) {
      return Result.err(`Invalid record for ${repo}#${issue}: ${err instanceof Error ? err.message : String(err)}`);
    }

    memCache.set(key, record);
    await idbPut(db, key, record);
    return Result.ok(record);
  }

  async function save(record: IssueRecord): Promise<import('../util/result').Result<void, string>> {
    const key = cacheKey(record.repo, record.issue);

    // Validate before writing
    try { validateRecord(record); } catch (err) {
      return Result.err(`Cannot save invalid record: ${err instanceof Error ? err.message : String(err)}`);
    }

    const r = await services.github.writeRecord(record.repo, record.issue, record);
    if (!r.ok) { return r; }

    memCache.set(key, record);
    const db = await getDb();
    await idbPut(db, key, record);
    return Result.ok(undefined);
  }

  function getCached(repo: string, issue: number): IssueRecord | null {
    return memCache.get(cacheKey(repo, issue)) ?? null;
  }

  async function invalidate(repo: string, issue: number): Promise<void> {
    const key = cacheKey(repo, issue);
    memCache.delete(key);
    const db = await getDb();
    await idbDelete(db, key);
  }

  return {
    load,
    save,
    getCached,
    // StoreService.invalidate is synchronous in the contract; wrap the async IDB delete
    invalidate(repo: string, issue: number): void { void invalidate(repo, issue); },
  };
}
