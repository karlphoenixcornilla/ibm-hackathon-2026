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

/**
 * The request's session. Only call it in routes behind the auth hook (app.ts), which has
 * already answered 401 when there is none.
 */
export function requireSession(req: { session: Session | null }): Session {
  if (!req.session) { throw new Error('No session: route is missing the auth hook.'); }
  return req.session;
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
