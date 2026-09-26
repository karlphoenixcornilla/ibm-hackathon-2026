// extension.ts — Reprise extension entry point
// Owned by: Integration (after base-v1). DO NOT edit per-track.
// Spec: 00-base.md §B2, 02-specs/browser-runtime.md §Startup check

import * as vscode from 'vscode';
import { buildServices } from './wiring/buildServices';

const NOT_IMPLEMENTED = (track: string) =>
  `Not implemented yet (track ${track})`;

export function activate(context: vscode.ExtensionContext): void {
  // ── Supported-browser check (ADR-12, browser-runtime.md §Startup check) ───
  // In the web build this runs inside the web-worker extension host. The
  // showDirectoryPicker check must be done from the workbench embedder page
  // (recorded in ide-fork.md). The extension performs the check below as a
  // second-layer guard and surfaces a notification if the API is absent.
  if (typeof window !== 'undefined' && !('showDirectoryPicker' in window)) {
    vscode.window.showErrorMessage(
      'Reprise IDE needs a browser that can open folders on your computer. ' +
        'Open this page in Google Chrome or Microsoft Edge on a desktop computer. ' +
        'You can still browse results on the dashboard.'
    );
    return;
  }

  // ── Build the Services container ──────────────────────────────────────────
  const services = buildServices(context);

  // ── Register tree view data providers (T1 owns the real implementations) ──
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('reprise.bugReports', new BugReportsProvider()),
    vscode.window.registerTreeDataProvider('reprise.runs', new RunsProvider())
  );

  // ── Status bar ────────────────────────────────────────────────────────────
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.text = '$(reprise-icon) Reprise: not linked';
  statusBar.command = 'reprise.connectRunner';
  statusBar.show();
  context.subscriptions.push(statusBar);

  // ── Commands ─────────────────────────────────────────────────────────────
  const cmds: Array<[string, () => void]> = [
    ['reprise.signIn', () => { services.auth.signIn(); }],
    ['reprise.signOut', () => { services.auth.signOut(); }],
    ['reprise.linkRepository', () => { vscode.window.showInformationMessage(NOT_IMPLEMENTED('T1')); }],
    ['reprise.connectRunner', () => { vscode.window.showInformationMessage(NOT_IMPLEMENTED('T2')); }],
    ['reprise.disconnectRunner', () => { vscode.window.showInformationMessage(NOT_IMPLEMENTED('T2')); }],
    ['reprise.acknowledgeBugReport', () => { vscode.window.showInformationMessage(NOT_IMPLEMENTED('T3')); }],
    ['reprise.acknowledgeCustom', () => { vscode.window.showInformationMessage(NOT_IMPLEMENTED('T3')); }],
    ['reprise.runMoreTrials', () => { vscode.window.showInformationMessage(NOT_IMPLEMENTED('T3')); }],
    ['reprise.chooseTestFile', () => { vscode.window.showInformationMessage(NOT_IMPLEMENTED('T3')); }],
    ['reprise.runReproTestAgain', () => { vscode.window.showInformationMessage(NOT_IMPLEMENTED('T3')); }],
    ['reprise.acceptDiagnosis', () => { vscode.window.showInformationMessage(NOT_IMPLEMENTED('T3')); }],
    ['reprise.proposeFixes', () => { vscode.window.showInformationMessage(NOT_IMPLEMENTED('T4')); }],
    ['reprise.verifyFix', () => { vscode.window.showInformationMessage(NOT_IMPLEMENTED('T4')); }],
    ['reprise.markReadyForReview', () => { vscode.window.showInformationMessage(NOT_IMPLEMENTED('T4')); }],
    ['reprise.addressReviewComments', () => { vscode.window.showInformationMessage(NOT_IMPLEMENTED('T4')); }],
    ['reprise.setupCiRuns', () => { vscode.window.showInformationMessage(NOT_IMPLEMENTED('T4')); }],
    ['reprise.publishRecord', () => { vscode.window.showInformationMessage(NOT_IMPLEMENTED('T1')); }],
    ['reprise.openDashboard', () => {
      const url = vscode.workspace.getConfiguration('reprise').get<string>('dashboardUrl') ?? '';
      if (url) {
        vscode.env.openExternal(vscode.Uri.parse(url));
      } else {
        vscode.window.showInformationMessage('Set reprise.dashboardUrl to open the dashboard.');
      }
    }],
    ['reprise.selectProvider', () => {
      const active = services.providers.getActive();
      vscode.window.showQuickPick(
        services.providers.list().map((p) => ({ label: p.id, description: p.capabilities.implemented ? 'implemented' : 'not implemented', picked: p.id === active.id })),
        { title: 'Select Reprise provider' }
      ).then((selected) => {
        if (selected) {
          const result = services.providers.setActive(selected.label);
          if (!result.ok) {
            vscode.window.showErrorMessage(result.error);
          }
        }
      });
    }],
    ['reprise.showMachineCapabilities', () => { vscode.window.showInformationMessage(NOT_IMPLEMENTED('T2')); }],
    ['reprise.openLocalRepository', () => { vscode.window.showInformationMessage(NOT_IMPLEMENTED('T1 / G-21 fallback')); }],
    ['reprise.refreshBugReports', () => { services.views.refreshBugReports(); }],
  ];

  for (const [id, handler] of cmds) {
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));
  }

  // ── Config: load on activation, reload on .reprise.yml change ────────────
  services.config.load().then((result) => {
    if (!result.ok) {
      vscode.window.showWarningMessage(`Reprise: ${result.error}`);
    }
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

// ── Placeholder tree view providers (T1 replaces) ────────────────────────────

class BugReportsProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(_element?: vscode.TreeItem): vscode.TreeItem[] {
    return [
      Object.assign(new vscode.TreeItem('Sign in and open a repository to see Bug Reports'), {
        contextValue: 'reprise.placeholder',
      }),
    ];
  }
}

class RunsProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(_element?: vscode.TreeItem): vscode.TreeItem[] {
    return [
      Object.assign(new vscode.TreeItem('No active runs'), {
        contextValue: 'reprise.placeholder',
      }),
    ];
  }
}
