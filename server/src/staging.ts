// staging.ts — files staged for local runs, per repo#issue, held in backend memory only.
// Nothing here is written to the user's clone: staged files reach the runner as an
// overlay on a worktree (see relay-executor.ts). A server restart drops them.

/**
 * Two layers: `base` holds what core wrote during acknowledge (the generated
 * reproduction test); `fix` holds the latest fix under test and is replaced wholesale
 * by each check, so an earlier fix never leaks into a later one.
 */
export class StagedFiles {
  private readonly base = new Map<string, string>();
  private fix = new Map<string, string>();
  private _version = 0;

  /** Changes whenever the staged content changes (overlays are cached per version). */
  get version(): number { return this._version; }

  write(path: string, content: string): void {
    this.base.set(path, content);
    this._version++;
  }

  setFix(files: Array<{ path: string; content: string }>): void {
    this.fix = new Map(files.map((f) => [f.path, f.content]));
    this._version++;
  }

  get(path: string): string | undefined {
    return this.fix.get(path) ?? this.base.get(path);
  }

  has(path: string): boolean {
    return this.get(path) !== undefined;
  }

  /** Every staged file, the fix layer overriding the base layer. */
  files(): Array<{ path: string; content: string }> {
    const merged = new Map(this.base);
    for (const [path, content] of this.fix) { merged.set(path, content); }
    return [...merged].map(([path, content]) => ({ path, content }));
  }
}

export class StagingStore {
  private readonly byIssue = new Map<string, StagedFiles>();

  /** The staged files for an issue, created empty on first use. */
  for(repo: string, issue: number): StagedFiles {
    const key = `${repo}#${issue}`;
    let staged = this.byIssue.get(key);
    if (!staged) {
      staged = new StagedFiles();
      this.byIssue.set(key, staged);
    }
    return staged;
  }

  /** Start over for an issue (a fresh acknowledge). */
  reset(repo: string, issue: number): StagedFiles {
    const staged = new StagedFiles();
    this.byIssue.set(`${repo}#${issue}`, staged);
    return staged;
  }
}
