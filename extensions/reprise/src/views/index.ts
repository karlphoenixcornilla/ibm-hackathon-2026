// views/ — Bug Reports tree, Runs tree, Reprise panel webview, status bar, unsaved-work guard
// Owned by: T1
// Spec: 02-specs/ide-ux.md, 02-specs/security.md §Webview rules

import * as vscode from 'vscode';
import type { ViewsService, Services } from '../contracts/services';
import type { GitHubIssue } from '../contracts/services';
import type { IssueRecord } from '../contracts/records';
import type { State } from '../contracts/enums';

// ── State display names ────────────────────────────────────────────────────────

const STATE_LABEL: Partial<Record<State, string>> = {
  LISTED: 'Listed',
  REPLICATING: 'Replicating…',
  CONFIRMED: 'Confirmed',
  FLAKY: 'Flaky',
  DUPLICATE: 'Duplicate',
  NEEDS_INFO: 'Needs Info',
  BLOCKED_ENV: 'Blocked',
  STOPPED: 'Stopped',
  ERROR: 'Error',
  FIXING: 'Fixing…',
  FIX_ABANDONED: 'Fix abandoned',
  VERIFYING: 'Verifying…',
  FIX_VERIFIED: 'Fix verified',
  FIX_INCOMPLETE: 'Fix incomplete',
  REGRESSION_DETECTED: 'Regression detected',
  RESOLVED: 'Resolved',
};

const ACKNOWLEDGE_STATES = new Set<State>([
  'LISTED', 'NEEDS_INFO', 'BLOCKED_ENV', 'STOPPED', 'ERROR',
]);

// ── Bug Reports tree ──────────────────────────────────────────────────────────

interface BugReportItem {
  issue: GitHubIssue;
  record: IssueRecord | null;
}

class BugReportTreeItem extends vscode.TreeItem {
  constructor(item: BugReportItem) {
    const state: State = item.record?.state ?? 'LISTED';
    const label = `#${item.issue.number} ${item.issue.title}`;
    super(label, vscode.TreeItemCollapsibleState.None);

    this.tooltip = item.issue.html_url;
    this.description = STATE_LABEL[state] ?? state;
    this.contextValue = ACKNOWLEDGE_STATES.has(state)
      ? 'bugReport acknowledgeAllowed'
      : 'bugReport';

    this.command = {
      command: 'reprise.openPanel',
      title: 'Open in Reprise panel',
      arguments: [item.issue],
    };
  }
}

class BugReportsTreeProvider
  implements vscode.TreeDataProvider<BugReportTreeItem | vscode.TreeItem>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private items: BugReportItem[] = [];
  private loading = false;

  constructor(
    private readonly services: Services,
    private readonly context: vscode.ExtensionContext
  ) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
    this.loadIssues();
  }

  private async loadIssues(): Promise<void> {
    if (this.loading) { return; }
    this.loading = true;

    try {
      const repoKey = this.context.workspaceState.get<string>('reprise.linkedRepo');
      if (!repoKey || !this.services.auth.isSignedIn()) {
        this.items = [];
        this._onDidChangeTreeData.fire();
        return;
      }

      const result = await this.services.github.listIssues(repoKey);
      if (!result.ok) {
        this.services.views.showError(`Reprise: ${result.error}`);
        return;
      }

      this.items = result.value.map((issue) => ({
        issue,
        record: this.services.store.getCached(repoKey, issue.number),
      }));
      this._onDidChangeTreeData.fire();
    } catch (err) {
      this.services.views.showError(`Reprise: could not load bug reports: ${(err as Error).message}`);
    } finally {
      this.loading = false;
    }
  }

  getTreeItem(element: BugReportTreeItem | vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(_element?: BugReportTreeItem | vscode.TreeItem): (BugReportTreeItem | vscode.TreeItem)[] {
    const repoKey = this.context.workspaceState.get<string>('reprise.linkedRepo');
    if (!repoKey) {
      return [
        Object.assign(new vscode.TreeItem('Sign in and link a repository to see Bug Reports'), {
          contextValue: 'reprise.placeholder',
        }),
      ];
    }
    if (!this.services.auth.isSignedIn()) {
      return [
        Object.assign(new vscode.TreeItem('Sign in to GitHub to see Bug Reports'), {
          contextValue: 'reprise.placeholder',
          command: { command: 'reprise.signIn', title: 'Sign In to GitHub' },
        }),
      ];
    }
    if (this.items.length === 0) {
      return [
        Object.assign(new vscode.TreeItem('No open bug reports found'), {
          contextValue: 'reprise.placeholder',
        }),
      ];
    }
    return this.items.map((item) => new BugReportTreeItem(item));
  }
}

// ── Runs tree ─────────────────────────────────────────────────────────────────

interface RunItem {
  label: string;
  detail: string;
  issueNumber: number;
}

class RunsTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private runs: RunItem[] = [];

  refresh(): void { this._onDidChangeTreeData.fire(); }

  addRun(run: RunItem): void {
    this.runs.unshift(run);
    this._onDidChangeTreeData.fire();
  }

  removeRun(issueNumber: number): void {
    this.runs = this.runs.filter((r) => r.issueNumber !== issueNumber);
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem { return element; }

  getChildren(_element?: vscode.TreeItem): vscode.TreeItem[] {
    if (this.runs.length === 0) {
      return [
        Object.assign(new vscode.TreeItem('No active runs'), {
          contextValue: 'reprise.placeholder',
        }),
      ];
    }
    return this.runs.map((r) => {
      const item = new vscode.TreeItem(r.label, vscode.TreeItemCollapsibleState.None);
      item.description = r.detail;
      item.contextValue = 'run';
      return item;
    });
  }
}

// ── Reprise panel webview ─────────────────────────────────────────────────────

const PANEL_VIEW_TYPE = 'reprise.panel';

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function buildPanelHtml(
  webview: vscode.Webview,
  repo: string,
  issue: number,
  record: IssueRecord | null,
  styleUri: vscode.Uri
): string {
  const nonce = getNonce();
  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource} data:`,
    `style-src ${webview.cspSource}`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');

  const repl = record?.replication;
  const fp = repl?.fingerprint;

  // All text is set via textContent — no innerHTML (T8 / XSS guard)
  const fingerprintSection = fp
    ? `
      <section class="section">
        <h2 class="section-title" id="fp-title">Fingerprint</h2>
        <dl class="dl">
          <dt>Component</dt><dd id="fp-component"></dd>
          <dt>Symptom</dt><dd id="fp-symptom"></dd>
          <dt>Expected</dt><dd id="fp-expected"></dd>
          <dt>Actual</dt><dd id="fp-actual"></dd>
          <dt>Error signature</dt><dd id="fp-sig"></dd>
        </dl>
      </section>`
    : '';

  const verdictSection = repl
    ? `<section class="section">
        <h2 class="section-title">Replication</h2>
        <div class="badge" id="verdict-badge"></div>
        <dl class="dl">
          <dt>Trials</dt><dd id="rep-trials"></dd>
          <dt>Failure rate</dt><dd id="rep-rate"></dd>
          <dt>Wilson CI</dt><dd id="rep-ci"></dd>
          <dt>Platform</dt><dd id="rep-platform"></dd>
        </dl>
      </section>`
    : '';

  const diagSection = repl?.diagnosis
    ? `<section class="section">
        <h2 class="section-title">Diagnosis</h2>
        <p id="diag-summary"></p>
        <p class="muted" id="diag-confidence"></p>
      </section>`
    : '';

  const script = `
    (function() {
      const record = ${JSON.stringify(record)};
      if (!record) { return; }

      function setText(id, value) {
        const el = document.getElementById(id);
        if (el) { el.textContent = String(value ?? ''); }
      }

      const fp = record.replication && record.replication.fingerprint;
      if (fp) {
        setText('fp-component', fp.component);
        setText('fp-symptom', fp.symptom);
        setText('fp-expected', fp.expected);
        setText('fp-actual', fp.actual);
        setText('fp-sig', fp.error_signature);
      }

      const repl = record.replication;
      if (repl) {
        setText('verdict-badge', repl.verdict || 'PENDING');
        if (repl.repro) {
          setText('rep-trials', repl.repro.trials);
          setText('rep-rate', repl.repro.rate != null ? (repl.repro.rate * 100).toFixed(1) + '%' : '—');
          setText('rep-ci',
            repl.repro.wilson_low != null
              ? '[' + (repl.repro.wilson_low * 100).toFixed(1) + '%, ' + (repl.repro.wilson_high * 100).toFixed(1) + '%]'
              : '—'
          );
          setText('rep-platform', repl.repro.run_context && repl.repro.run_context.platform);
        }
      }

      if (repl && repl.diagnosis) {
        setText('diag-summary', repl.diagnosis.summary);
        setText('diag-confidence', 'Confidence: ' + repl.diagnosis.confidence);
      }
    })();
  `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${webview.asWebviewUri(styleUri)}">
  <title>Reprise — #${issue}</title>
</head>
<body>
  <header class="panel-header">
    <h1 class="panel-title" id="issue-title"></h1>
    <span class="muted" id="issue-repo"></span>
  </header>
  ${fingerprintSection}
  ${verdictSection}
  ${diagSection}
  <script nonce="${nonce}">
    document.getElementById('issue-title').textContent = ${JSON.stringify(`#${issue}`)};
    document.getElementById('issue-repo').textContent = ${JSON.stringify(repo)};
    ${script}
  </script>
</body>
</html>`;
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createViews(
  services: Services,
  context: vscode.ExtensionContext
): ViewsService {
  // Status bar
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.text = 'Reprise: not linked';
  statusBar.command = 'reprise.connectRunner';
  statusBar.show();
  context.subscriptions.push(statusBar);

  // Tree providers
  const bugReportsProvider = new BugReportsTreeProvider(services, context);
  const runsProvider = new RunsTreeProvider();

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('reprise.bugReports', bugReportsProvider),
    vscode.window.registerTreeDataProvider('reprise.runs', runsProvider),
    // Load issues once the token is restored at startup or entered by the user
    services.auth.onDidChangeSession(() => bugReportsProvider.refresh())
  );

  // Listen to executor events for the Runs tree (FakeExecutor now)
  // (real subscription wired when T2/T3 are implemented)

  // Unsaved-work guard — window.onbeforeunload equivalent in vscode.env
  // The browser's beforeunload is handled by the embedding page; the extension
  // registers a close listener to warn while runs are active.
  let activeRunCount = 0;
  const beforeCloseListener = vscode.window.tabGroups.onDidChangeTabs(() => {
    if (activeRunCount > 0) {
      services.views.showInfo(
        'Reprise has active runs. Closing this window may lose run results.',
        'OK'
      );
    }
  });
  context.subscriptions.push(beforeCloseListener);

  // Panel map: one panel per issue
  const panels = new Map<string, vscode.WebviewPanel>();

  // Media path for webview CSS
  const styleUri = vscode.Uri.joinPath(context.extensionUri, 'media', 'panel.css');

  // ── ViewsService API ────────────────────────────────────────────────────────

  function refreshBugReports(): void {
    bugReportsProvider.refresh();
  }

  function refreshRuns(): void {
    runsProvider.refresh();
  }

  function openPanel(repo: string, issue: number): void {
    const key = `${repo}#${issue}`;
    const existing = panels.get(key);
    if (existing) {
      existing.reveal();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      PANEL_VIEW_TYPE,
      `Reprise #${issue}`,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
        retainContextWhenHidden: true,
      }
    );

    const record = services.store.getCached(repo, issue);
    panel.webview.html = buildPanelHtml(panel.webview, repo, issue, record, styleUri);

    panel.onDidDispose(() => { panels.delete(key); }, null, context.subscriptions);
    panels.set(key, panel);
  }

  function setStatusBar(text: string): void {
    statusBar.text = `Reprise: ${text}`;
  }

  function showInfo(message: string, ...actions: string[]): Thenable<string | undefined> {
    return vscode.window.showInformationMessage(message, ...actions);
  }

  function showError(message: string): void {
    vscode.window.showErrorMessage(message);
  }

  // Auto-refresh bug reports every 5 minutes
  const autoRefreshInterval = setInterval(() => {
    bugReportsProvider.refresh();
  }, 5 * 60 * 1000);
  context.subscriptions.push({ dispose: () => clearInterval(autoRefreshInterval) });

  // Track active run count changes
  function onRunStarted(issueNumber: number, label: string): void {
    activeRunCount++;
    runsProvider.addRun({ label, detail: 'running', issueNumber });
  }
  function onRunFinished(issueNumber: number): void {
    activeRunCount = Math.max(0, activeRunCount - 1);
    runsProvider.removeRun(issueNumber);
  }

  // Expose run tracking methods on the returned service (not in the contract,
  // but accessible to wiring via type assertion when needed)
  const viewsService: ViewsService & {
    onRunStarted: typeof onRunStarted;
    onRunFinished: typeof onRunFinished;
  } = {
    refreshBugReports,
    refreshRuns,
    openPanel,
    setStatusBar,
    showInfo,
    showError,
    onRunStarted,
    onRunFinished,
  };

  return viewsService;
}
