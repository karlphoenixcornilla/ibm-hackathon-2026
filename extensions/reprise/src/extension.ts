// extension.ts — Reprise extension entry point
// Owned by: Integration (99-integration.md). Commands delegate to the Services
// container; this file holds only UI glue (pickers, progress, messages).
// Spec: 00-base.md §B2, 02-specs/ide-ux.md, 02-specs/browser-runtime.md §Startup check

import * as vscode from 'vscode';
import { buildServices } from './wiring/buildServices';
import type { Services } from './contracts/services';
import type { IssueRecord } from './contracts/records';
import type { TrialsPolicy } from './contracts/services';
import { setUpCiRuns } from './exec/ci/index';
import { handleSelectProvider } from './providers/index';

const LINKED_REPO_KEY = 'reprise.linkedRepo';

/** Plain-words verdicts (dashboard.md §Display names). */
const DISPLAY: Record<string, string> = {
  LISTED: 'Not acknowledged',
  REPLICATING: 'Replicating',
  STOPPED: 'Stopped by user',
  CONFIRMED: 'Reproduced',
  FLAKY: 'Reproduced sometimes',
  DUPLICATE: 'Duplicate',
  NEEDS_INFO: 'Needs one answer',
  BLOCKED_ENV: 'Test environment missing',
  ERROR: 'Reprise hit an error',
  FIXING: 'Fix in progress',
  FIX_ABANDONED: 'No fix proposed',
  VERIFYING: 'Checking fix',
  FIX_VERIFIED: 'Fix verified',
  FIX_INCOMPLETE: 'Still reproduces',
  REGRESSION_DETECTED: 'Fix breaks other tests',
  RESOLVED: 'Resolved',
};

export function activate(context: vscode.ExtensionContext): void {
  // ── Supported-browser check (ADR-12, browser-runtime.md §Startup check) ───
  // The web-worker extension host has no `window`; the embedder page performs the
  // primary check. This is a second-layer guard for window-based hosts.
  if (typeof window !== 'undefined' && !('showDirectoryPicker' in window)) {
    vscode.window.showErrorMessage(
      'Reprise IDE needs a browser that can open folders on your computer. ' +
        'Open this page in Google Chrome or Microsoft Edge on a desktop computer. ' +
        'You can still browse results on the dashboard.'
    );
    return;
  }

  const services = buildServices(context);
  const ui = new CommandUi(context, services);

  // A GitHub virtual folder ("Open Repository") is not the runner's clone: tests
  // Reprise writes would never reach the machine that runs them.
  if (services.workspace.getRootUri()?.scheme === 'vscode-vfs') {
    void vscode.window.showWarningMessage(
      'Reprise: this folder is a GitHub virtual folder. Bug reports and records work, but reproduction ' +
        'tests run in the Reprise Runner\'s local clone — open that same local folder (File → Open Folder) ' +
        'to acknowledge reports.',
      'Open Folder'
    ).then((pick) => {
      if (pick) void vscode.commands.executeCommand('workbench.action.files.openFolder');
    });
  }

  const commands: Record<string, (...args: unknown[]) => unknown> = {
    'reprise.signIn': () => ui.signIn(),
    'reprise.signOut': () => ui.signOut(),
    'reprise.linkRepository': () => ui.linkRepository(),
    'reprise.connectRunner': () => ui.connectRunner(),
    'reprise.disconnectRunner': () => ui.disconnectRunner(),
    'reprise.acknowledgeBugReport': (arg) => ui.acknowledge(arg),
    'reprise.acknowledgeCustom': (arg) => ui.acknowledgeCustom(arg),
    'reprise.runMoreTrials': (arg) => ui.runMoreTrials(arg),
    'reprise.chooseTestFile': (arg) => ui.chooseTestFile(arg),
    'reprise.runReproTestAgain': (arg) => ui.runReproTestAgain(arg),
    'reprise.acceptDiagnosis': (arg) => ui.acceptDiagnosis(arg),
    'reprise.proposeFixes': (arg) => ui.proposeFixes(arg),
    'reprise.verifyFix': (arg) => ui.verifyFix(arg),
    'reprise.markReadyForReview': (arg) => ui.markReadyForReview(arg),
    'reprise.addressReviewComments': (arg) => ui.addressReviewComments(arg),
    'reprise.setupCiRuns': () => ui.setupCiRuns(),
    'reprise.publishRecord': (arg) => ui.publishRecord(arg),
    'reprise.openDashboard': () => ui.openDashboard(),
    'reprise.selectProvider': () => ui.selectProvider(),
    'reprise.showMachineCapabilities': () => ui.showMachineCapabilities(),
    'reprise.openLocalRepository': () => vscode.commands.executeCommand('workbench.action.files.openFolder'),
    'reprise.refreshBugReports': () => services.views.refreshBugReports(),
    'reprise.openPanel': (arg) => ui.openPanel(arg),
  };

  for (const [id, handler] of Object.entries(commands)) {
    context.subscriptions.push(
      vscode.commands.registerCommand(id, async (...args: unknown[]) => {
        try {
          await handler(...args);
        } catch (err) {
          services.views.showError(`Reprise: ${err instanceof Error ? err.message : String(err)}`);
        }
      })
    );
  }

  // ── Status bar: sign-in, runner and provider state ────────────────────────
  const updateStatus = (): void => ui.updateStatus();
  context.subscriptions.push(
    services.auth.onDidChangeSession((e) => {
      updateStatus();
      if (e.signedIn) void ui.autoLink();
    }),
    services.runnerClient.onDidChangePairing(updateStatus),
    services.providers.onDidChangeProvider(updateStatus)
  );
  updateStatus();

  // ── Config: load on activation, reload on .reprise.yml change ────────────
  services.config.load().then((result) => {
    if (!result.ok) {
      vscode.window.showWarningMessage(`Reprise: ${result.error}`);
    }
    void ui.autoLink();
  });

  const watcher = vscode.workspace.createFileSystemWatcher('**/.reprise.yml');
  context.subscriptions.push(
    watcher,
    watcher.onDidChange(() => { services.config.invalidate(); services.config.load(); }),
    watcher.onDidCreate(() => { services.config.invalidate(); services.config.load(); }),
    watcher.onDidDelete(() => { services.config.invalidate(); })
  );
}

export function deactivate(): void {
  // nothing to clean up — all disposables are registered on context.subscriptions
}

// ── Command UI ───────────────────────────────────────────────────────────────

class CommandUi {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly s: Services
  ) {}

  // ── Helpers ────────────────────────────────────────────────────────────────

  updateStatus(): void {
    const parts = [
      this.s.auth.isSignedIn() ? 'signed in' : 'not signed in',
      this.s.runnerClient.isPaired() ? 'runner connected' : 'no runner',
      `AI: ${this.s.providers.getActive().id}`,
    ];
    this.s.views.setStatusBar(parts.join(' · '));
  }

  private linkedRepo(): string | null {
    return this.context.workspaceState.get<string>(LINKED_REPO_KEY) ?? null;
  }

  /** Link automatically from .git/config when signed in and nothing is linked yet. */
  async autoLink(): Promise<void> {
    if (!this.linkedRepo()) {
      const d = await this.s.github.detectRepo();
      if (d.ok) await this.context.workspaceState.update(LINKED_REPO_KEY, d.value);
    }
    if (this.linkedRepo() && this.s.auth.isSignedIn()) this.s.views.refreshBugReports();
  }

  private async requireRepo(): Promise<string> {
    const linked = this.linkedRepo();
    if (linked) return linked;
    const repo = await this.linkRepository();
    if (!repo) throw new Error('No repository linked. Run "Reprise: Link Repository".');
    return repo;
  }

  private async requireSignIn(): Promise<void> {
    if (this.s.auth.isSignedIn()) return;
    const r = await this.s.auth.signIn();
    if (!r.ok) throw new Error(r.error);
  }

  /** Issue number from a tree item, a GitHubIssue, a number, or an input box. */
  private async issueFrom(arg: unknown): Promise<number> {
    if (typeof arg === 'number') return arg;
    if (arg && typeof arg === 'object') {
      const o = arg as { number?: unknown; issue?: unknown; label?: unknown };
      if (typeof o.number === 'number') return o.number;
      if (typeof o.issue === 'number') return o.issue;
      if (o.issue && typeof (o.issue as { number?: unknown }).number === 'number') {
        return (o.issue as { number: number }).number;
      }
      const label = typeof o.label === 'string' ? o.label : (o.label as { label?: string } | undefined)?.label;
      const m = label?.match(/^#(\d+)/);
      if (m) return Number(m[1]);
    }
    const input = await vscode.window.showInputBox({
      title: 'Reprise: bug report number',
      prompt: 'GitHub issue number',
      validateInput: (v) => (/^\d+$/.test(v.trim()) ? null : 'Enter a number'),
    });
    if (!input) throw new Error('Cancelled.');
    return Number(input.trim());
  }

  private async loadRecord(repo: string, issue: number): Promise<IssueRecord> {
    const r = await this.s.store.load(repo, issue);
    if (!r.ok) throw new Error(r.error);
    if (!r.value) throw new Error(`#${issue} has no Reprise record yet. Acknowledge it first.`);
    return r.value;
  }

  private progress<T>(title: string, task: (token: vscode.CancellationToken) => Promise<T>): Thenable<T> {
    return vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title, cancellable: true },
      (_p, token) => task(token)
    );
  }

  /**
   * Tests and fixes are written to the opened folder and run by the runner in its
   * local clone, so a GitHub virtual folder would silently run stale files.
   */
  private requireLocalFolder(): void {
    if (this.s.workspace.getRootUri()?.scheme === 'vscode-vfs') {
      throw new Error(
        'This window is a GitHub virtual folder (Open Repository). Open the runner\'s local clone instead ' +
          '(File → Open Folder, or start the IDE with the folder path) so the tests Reprise writes are the ones the runner runs.'
      );
    }
  }

  /** Bob runs through the runner: offer to connect before a provider stage. */
  private async ensureProviderReady(): Promise<void> {
    if (this.s.providers.getActive().id !== 'bob' || this.s.runnerClient.isPaired()) return;
    const pick = await vscode.window.showWarningMessage(
      'IBM Bob runs through the Reprise Runner on your machine. Connect the runner first.',
      'Connect Runner',
      'Use stub responses'
    );
    if (pick === 'Connect Runner') {
      await this.connectRunner();
      if (!this.s.runnerClient.isPaired()) throw new Error('Runner not connected.');
    } else if (pick === 'Use stub responses') {
      const r = this.s.providers.setActive('stub');
      if (!r.ok) throw new Error(r.error);
    } else {
      throw new Error('Cancelled.');
    }
  }

  private summary(record: IssueRecord): string {
    const r = record.replication;
    const label = DISPLAY[record.state] ?? record.state;
    let detail = '';
    if ((record.state === 'CONFIRMED' || record.state === 'FLAKY') && r.repro.trials) {
      detail = ` in ${r.repro.failed} of ${r.repro.trials} runs`;
    } else if (record.state === 'DUPLICATE' && r.duplicate.of) {
      detail = ` of #${r.duplicate.of}`;
    } else if (record.state === 'NEEDS_INFO' || record.state === 'BLOCKED_ENV') {
      detail = r.question ? `: ${r.question}` : '';
    }
    const last = record.fix.iterations[record.fix.iterations.length - 1];
    if (last && ['FIX_VERIFIED', 'FIX_INCOMPLETE', 'REGRESSION_DETECTED'].includes(record.state)) {
      detail = last.verification.repro.claim ? `: ${last.verification.repro.claim}` : '';
    }
    return `#${record.issue} ${label}${detail}${record.stubbed ? ' (stub response)' : ` · ${record.provider}`}`;
  }

  private async finish(record: IssueRecord): Promise<void> {
    this.s.views.refreshBugReports();
    this.s.views.openPanel(record.repo, record.issue);
    const post = vscode.workspace.getConfiguration('reprise').get<boolean>('postResultsToGitHub', false);
    if (post && this.s.github.comment) {
      const r = await this.s.github.comment(record.repo, record.issue, `Reprise: ${this.summary(record)}`);
      if (!r.ok) this.s.views.showError(`Reprise: could not post the result: ${r.error}`);
    }
    void this.s.views.showInfo(this.summary(record));
  }

  // ── Account and repository ───────────────────────────────────────────────

  async signIn(): Promise<void> {
    const r = await this.s.auth.signIn();
    if (!r.ok) throw new Error(r.error);
    await this.autoLink();
    this.updateStatus();
    void this.s.views.showInfo(`Signed in to GitHub${this.linkedRepo() ? `; linked ${this.linkedRepo()}` : ''}.`);
  }

  async signOut(): Promise<void> {
    await this.s.auth.signOut();
    this.s.views.refreshBugReports();
  }

  async linkRepository(): Promise<string | null> {
    const detected = await this.s.github.detectRepo();
    const value = await vscode.window.showInputBox({
      title: 'Reprise: Link Repository',
      prompt: 'GitHub repository (owner/repo) whose bug reports Reprise works on',
      value: detected.ok ? detected.value : this.linkedRepo() ?? '',
      validateInput: (v) => (/^[\w.-]+\/[\w.-]+$/.test(v.trim()) ? null : 'Use the form owner/repo'),
    });
    if (!value) return null;
    const repo = value.trim();
    await this.context.workspaceState.update(LINKED_REPO_KEY, repo);
    if (!this.s.auth.isSignedIn()) await this.requireSignIn();
    this.s.views.refreshBugReports();
    return repo;
  }

  // ── Runner ─────────────────────────────────────────────────────────────────

  async connectRunner(): Promise<void> {
    const code = await vscode.window.showInputBox({
      title: 'Reprise: Connect Runner',
      prompt: 'Start the runner with: node reprise-runner.mjs --root <your clone>. Enter the 6-digit pairing code it prints.',
      placeHolder: '123456',
      ignoreFocusOut: true,
      validateInput: (v) => (/^\d{6}$/.test(v.trim()) ? null : 'The pairing code has 6 digits'),
    });
    if (!code) return;
    const r = await this.s.runnerClient.pair(code.trim());
    if (!r.ok) {
      throw new Error(
        `Pairing failed: ${r.error}. Check the runner is running, the port matches reprise.runnerPort, ` +
          'and this page\'s origin was passed with --allow-origin.'
      );
    }
    if (!this.s.runnerClient.isPaired()) return; // same-repository check refused it
    const p = r.value;
    const platforms = p.platforms.map((c) => `${c.platform}${c.local_possible ? '' : ' (missing prerequisites)'}`).join(', ') || 'none configured';
    const bob = p.ai?.find((a) => a.provider === 'bob');
    const bobText = bob ? (bob.available ? `IBM Bob ${bob.version ?? ''} ready` : `IBM Bob unavailable: ${bob.reason}`) : 'IBM Bob bridge not reported (update the runner)';
    void this.s.views.showInfo(`Runner connected to ${p.root_name} on ${p.host_os}. Platforms: ${platforms}. ${bobText}.`);
    this.updateStatus();
  }

  async disconnectRunner(): Promise<void> {
    await this.s.runnerClient.disconnect();
    this.updateStatus();
  }

  async showMachineCapabilities(): Promise<void> {
    const r = await this.s.runnerClient.getStatus();
    if (!r.ok) throw new Error(r.error);
    if (!r.value) {
      const pick = await vscode.window.showInformationMessage('No runner is connected.', 'Connect Runner');
      if (pick) await this.connectRunner();
      return;
    }
    const st = r.value;
    const lines = [
      `# Reprise Runner ${st.runner_version}`,
      '',
      `- Folder: \`${st.root_name}\``,
      `- Remote: ${st.remote || '(not detected)'}`,
      `- HEAD: \`${st.head || '(not detected)'}\``,
      `- Host OS: ${st.host_os}`,
      `- Busy: ${st.busy ? 'yes' : 'no'}`,
      '',
      '## Platforms',
      '',
      '| Platform | Runs here | Missing |',
      '| --- | --- | --- |',
      ...st.platforms.map((c) => `| ${c.platform} | ${c.local_possible ? 'yes' : 'no'} | ${c.missing.join(', ') || '-'} |`),
      '',
      '## AI',
      '',
      ...(st.ai ?? []).map((a) => `- ${a.provider}: ${a.available ? `available ${a.version ?? ''}` : 'unavailable'}${a.reason ? ` — ${a.reason}` : ''}`),
      `- Active provider in the IDE: ${this.s.providers.getActive().id}`,
    ];
    const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: lines.join('\n') });
    await vscode.window.showTextDocument(doc, { preview: true });
  }

  // ── Replication ─────────────────────────────────────────────────────────────

  async openPanel(arg: unknown): Promise<void> {
    const repo = await this.requireRepo();
    const issue = await this.issueFrom(arg);
    await this.s.store.load(repo, issue); // warm the cache so the panel shows the record
    this.s.views.openPanel(repo, issue);
  }

  async acknowledge(arg: unknown, trials?: Partial<TrialsPolicy>): Promise<void> {
    this.requireLocalFolder();
    await this.requireSignIn();
    const repo = await this.requireRepo();
    const issue = await this.issueFrom(arg);
    if (!this.s.config.get()) {
      const c = await this.s.config.load();
      if (!c.ok) throw new Error(`.reprise.yml: ${c.error}`);
    }
    await this.ensureProviderReady();
    const r = await this.progress(`Reprise: replicating #${issue}`, (token) =>
      this.s.pipeline.acknowledge(repo, issue, trials, token)
    );
    if (!r.ok) throw new Error(r.error);
    await this.finish(r.value);
  }

  async acknowledgeCustom(arg: unknown): Promise<void> {
    const defaults = this.s.config.get()?.defaults.trials;
    const ask = async (title: string, value: number | undefined): Promise<number> => {
      const v = await vscode.window.showInputBox({
        title,
        value: value !== undefined ? String(value) : '',
        validateInput: (x) => (/^\d+$/.test(x.trim()) && Number(x) > 0 ? null : 'Enter a positive number'),
      });
      if (!v) throw new Error('Cancelled.');
      return Number(v.trim());
    };
    const min = await ask('Minimum trials', defaults?.min);
    const max = await ask('Maximum trials', Math.max(min, defaults?.max ?? min));
    await this.acknowledge(arg, { min, max: Math.max(min, max) });
  }

  async runMoreTrials(arg: unknown): Promise<void> {
    const repo = await this.requireRepo();
    const issue = await this.issueFrom(arg);
    const v = await vscode.window.showInputBox({
      title: `Reprise: more trials for #${issue}`,
      value: '10',
      validateInput: (x) => (/^\d+$/.test(x.trim()) && Number(x) > 0 ? null : 'Enter a positive number'),
    });
    if (!v) return;
    const r = await this.progress(`Reprise: ${v} more trials for #${issue}`, (token) =>
      this.s.pipeline.runMoreTrials(repo, issue, Number(v), token)
    );
    if (!r.ok) throw new Error(r.error);
    await this.finish(r.value);
  }

  async runReproTestAgain(arg: unknown): Promise<void> {
    const repo = await this.requireRepo();
    const issue = await this.issueFrom(arg);
    const record = await this.loadRecord(repo, issue);
    const count = Math.max(1, record.replication.repro.trials_policy.min || 5);
    const r = await this.progress(`Reprise: running the reproduction test for #${issue} again`, (token) =>
      this.s.pipeline.runMoreTrials(repo, issue, count, token)
    );
    if (!r.ok) throw new Error(r.error);
    await this.finish(r.value);
  }

  /** R-1 validate mode: the user supplies the test; the provider is not asked for one. */
  async chooseTestFile(arg: unknown): Promise<void> {
    const repo = await this.requireRepo();
    const issue = await this.issueFrom(arg);
    const root = this.s.workspace.getRootUri();
    if (!root) throw new Error('Open the repository folder first.');

    const picked = await vscode.window.showOpenDialog({
      defaultUri: root,
      canSelectMany: false,
      openLabel: 'Use as reproduction test',
    });
    if (!picked?.[0]) return;
    const rel = picked[0].path.startsWith(root.path)
      ? picked[0].path.slice(root.path.length).replace(/^\/+/, '')
      : null;
    if (!rel) throw new Error('Choose a file inside the opened folder.');

    const kind = await vscode.window.showQuickPick(
      [
        { label: 'assertion_message', description: 'A phrase in the failing assertion' },
        { label: 'error_type', description: 'An exception or error type' },
        { label: 'output_regex', description: 'A pattern in the test output' },
        { label: 'timeout', description: 'The test times out' },
      ],
      { title: 'How does the bug show up when this test fails?' }
    );
    if (!kind) return;
    const pattern = await vscode.window.showInputBox({
      title: 'Failure signature (JavaScript regular expression)',
      prompt: 'Specific enough that an unrelated failure would not match',
      validateInput: (v) => {
        try { new RegExp(v); return v.length > 0 && v.length <= 200 ? null : '1 to 200 characters'; } catch { return 'Not a valid regular expression'; }
      },
    });
    if (!pattern) return;

    const existing = await this.s.store.load(repo, issue);
    if (existing.ok && existing.value) {
      const record = existing.value;
      record.replication.repro.test_origin = 'user';
      record.replication.repro.test_file = rel;
      record.replication.repro.signature = { kind: kind.label as IssueRecord['replication']['repro']['signature']['kind'], pattern };
      record.updated_at = new Date().toISOString();
      const saved = await this.s.store.save(record);
      if (!saved.ok) throw new Error(saved.error);
      await this.acknowledge(issue);
    } else {
      // No record yet: acknowledge first so intake runs, then the user's test is used on re-acknowledge.
      throw new Error(`Acknowledge #${issue} once first; then choose your test file.`);
    }
  }

  async acceptDiagnosis(arg: unknown): Promise<void> {
    const repo = await this.requireRepo();
    const issue = await this.issueFrom(arg);
    const record = await this.loadRecord(repo, issue);
    const d = record.replication.diagnosis;
    if (!d.summary) throw new Error(`#${issue} has no diagnosis yet.`);
    const pick = await vscode.window.showInformationMessage(
      d.summary,
      { modal: true, detail: `${d.fix_direction}\n\nConfidence: ${d.confidence}` },
      'Accept',
      'Edit and accept'
    );
    if (!pick) return;
    if (pick === 'Edit and accept') {
      const edited = await vscode.window.showInputBox({ title: 'Diagnosis summary', value: d.summary });
      if (!edited) return;
      d.summary = this.s.security.redact(edited);
      d.edited = true;
    }
    d.accepted_by = 'maintainer';
    record.events.push({ at: new Date().toISOString(), type: 'diagnosis.accepted', detail: d.edited ? 'edited' : '' });
    record.updated_at = new Date().toISOString();
    const saved = await this.s.store.save(record);
    if (!saved.ok) throw new Error(saved.error);
    this.s.views.openPanel(repo, issue);
  }

  // ── Fix and verify ────────────────────────────────────────────────────────

  async proposeFixes(arg: unknown): Promise<void> {
    const repo = await this.requireRepo();
    const issue = await this.issueFrom(arg);
    this.requireLocalFolder();
    await this.ensureProviderReady();

    const proposed = await this.progress(`Reprise: proposing fixes for #${issue}`, (token) =>
      this.s.fix.proposeFixes(repo, issue, token)
    );
    if (!proposed.ok) throw new Error(proposed.error);

    const iteration = proposed.value.fix.iterations[proposed.value.fix.iterations.length - 1];
    const runnable = iteration.candidates.filter((c) => c.status === 'survived');
    if (runnable.length === 0) {
      throw new Error(`No usable candidate: ${iteration.candidates.map((c) => `#${c.k} ${c.status}`).join(', ') || 'none returned'}.`);
    }

    // Quick check each candidate (the user reviews each diff before it runs).
    let latest = proposed.value;
    for (const c of runnable) {
      const q = await this.progress(`Reprise: quick check of candidate ${c.k} for #${issue}`, (token) =>
        this.s.fix.runQuickCheck(repo, issue, c.k, token)
      );
      if (!q.ok) {
        this.s.views.showError(`Candidate ${c.k}: ${q.error}`);
        continue;
      }
      latest = q.value;
    }

    const last = latest.fix.iterations[latest.fix.iterations.length - 1];
    const selected = last.candidates.find((c) => c.status === 'selected');
    const table = last.candidates.map((c) => `#${c.k} ${c.status} (${c.quick_check.repro_failed}/${c.quick_check.repro_runs} still failing)`).join('; ');
    if (!selected) {
      this.s.views.openPanel(repo, issue);
      throw new Error(`No candidate survived the quick check: ${table}.`);
    }

    const applied = await this.progress(`Reprise: opening a PR for candidate ${selected.k}`, (token) =>
      this.s.fix.applySelected(repo, issue, token)
    );
    if (!applied.ok) throw new Error(applied.error);
    const pr = applied.value.fix.iterations[applied.value.fix.iterations.length - 1].pr;
    this.s.views.refreshBugReports();
    const open = await this.s.views.showInfo(`Candidate ${selected.k} pushed. ${table}.`, ...(pr ? ['Open PR', 'Verify now'] : ['Verify now']));
    if (open === 'Open PR' && pr) await vscode.env.openExternal(vscode.Uri.parse(pr));
    if (open === 'Verify now') await this.verifyFix(issue);
  }

  async verifyFix(arg: unknown): Promise<void> {
    const repo = await this.requireRepo();
    const issue = await this.issueFrom(arg);
    const r = await this.progress(`Reprise: verifying the fix for #${issue}`, (token) =>
      this.s.verify.verify(repo, issue, token)
    );
    if (!r.ok) throw new Error(r.error);
    await this.finish(r.value);
  }

  async markReadyForReview(arg: unknown): Promise<void> {
    const repo = await this.requireRepo();
    const issue = await this.issueFrom(arg);
    const record = await this.loadRecord(repo, issue);
    const last = record.fix.iterations[record.fix.iterations.length - 1];
    const prNumber = Number(last?.pr?.match(/\/pull\/(\d+)/)?.[1]);
    if (!last?.pr || !prNumber) throw new Error(`#${issue} has no fix PR yet.`);
    if (record.state !== 'FIX_VERIFIED') {
      const go = await vscode.window.showWarningMessage(
        `The fix for #${issue} is "${DISPLAY[record.state] ?? record.state}", not verified. Mark it ready anyway?`,
        { modal: true },
        'Mark ready'
      );
      if (go !== 'Mark ready') return;
    }
    if (!this.s.github.markPrReady) throw new Error('This GitHub service cannot change PRs.');
    const r = await this.s.github.markPrReady(repo, prNumber);
    if (!r.ok) throw new Error(r.error);
    last.pr_draft = false;
    record.events.push({ at: new Date().toISOString(), type: 'pr.ready', detail: last.pr });
    record.updated_at = new Date().toISOString();
    await this.s.store.save(record);
    void this.s.views.showInfo(`${last.pr} is ready for review.`);
  }

  /** A new fix round; previous rounds' results (and review feedback) go into the provider context. */
  async addressReviewComments(arg: unknown): Promise<void> {
    const issue = await this.issueFrom(arg);
    await this.proposeFixes(issue);
  }

  async setupCiRuns(): Promise<void> {
    await this.requireSignIn();
    const repo = await this.requireRepo();
    const r = await this.progress(`Reprise: adding CI runs to ${repo}`, () => setUpCiRuns(this.s, repo));
    if (!r.ok) throw new Error(r.error);
    const open = await this.s.views.showInfo(`Opened ${r.value.pr}. Merge it to enable CI runs.`, 'Open PR');
    if (open) await vscode.env.openExternal(vscode.Uri.parse(r.value.pr));
  }

  // ── Records and dashboard ───────────────────────────────────────────────────

  async publishRecord(arg: unknown): Promise<void> {
    const repo = await this.requireRepo();
    const issue = await this.issueFrom(arg);
    const record = await this.loadRecord(repo, issue);
    record.updated_at = new Date().toISOString();
    const r = await this.s.store.save(record);
    if (!r.ok) throw new Error(r.error);
    const url = `https://github.com/${repo}/blob/reprise-data/issues/${issue}.json`;
    const open = await this.s.views.showInfo(`Published #${issue} to the reprise-data branch.`, 'Open record');
    if (open) await vscode.env.openExternal(vscode.Uri.parse(url));
  }

  async openDashboard(): Promise<void> {
    const url = vscode.workspace.getConfiguration('reprise').get<string>('dashboardUrl') ?? '';
    if (url) {
      await vscode.env.openExternal(vscode.Uri.parse(url));
    } else {
      void this.s.views.showInfo('Set reprise.dashboardUrl to open the dashboard.');
    }
  }

  async selectProvider(): Promise<void> {
    await handleSelectProvider(this.s.providers, vscode);
    const id = this.s.providers.getActive().id;
    await vscode.workspace.getConfiguration('reprise').update('provider', id, vscode.ConfigurationTarget.Global);
    this.updateStatus();
    if (id === 'bob' && !this.s.runnerClient.isPaired()) {
      const pick = await vscode.window.showInformationMessage('IBM Bob runs through the Reprise Runner.', 'Connect Runner');
      if (pick) await this.connectRunner();
    }
  }
}
