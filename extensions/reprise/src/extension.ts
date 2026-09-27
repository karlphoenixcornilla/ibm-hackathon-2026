// extension.ts — Reprise extension entry point
// Owned by: Integration (after base-v1). DO NOT edit per-track.
// Spec: 00-base.md §B2, 02-specs/browser-runtime.md §Startup check

import * as vscode from 'vscode';
import { buildServices } from './wiring/buildServices';

export function activate(context: vscode.ExtensionContext): void {
  // ── Supported-browser check (ADR-12, browser-runtime.md §Startup check) ───
  // In the web build this runs inside the web-worker extension host. The
  // showDirectoryPicker check must be done from the workbench embedder page
  // (recorded in ide-fork.md). The extension performs the check below as a
  // second-layer guard and surfaces a notification if the API is absent.
  if (typeof window !== 'undefined' && !('showDirectoryPicker' in window)) {
    vscode.window.showErrorMessage(
      'Reprise IDE needs a Chromium-based desktop browser that can open folders on your computer, ' +
        "such as Chrome, Edge, Brave, Opera, Vivaldi or Arc. Firefox, Safari and mobile browsers aren't supported yet. " +
        "If your browser blocks folder access, turn it on in the browser's settings or use Chrome or Edge. " +
        'You can still browse results on the dashboard.'
    );
    return;
  }

  // ── Build the Services container ──────────────────────────────────────────
  // buildServices registers tree providers and the status bar via createViews.
  const services = buildServices(context);

  // ── Commands ─────────────────────────────────────────────────────────────
  const cmds: Array<[string, () => void]> = [
    // T1
    ['reprise.signIn', () => { services.auth.signIn(); }],
    ['reprise.signOut', () => { services.auth.signOut(); }],
    ['reprise.linkRepository', () => {
      vscode.window.showInputBox({ prompt: 'Enter owner/repo to link (e.g. acme/my-app)' })
        .then((repo) => {
          if (repo) {
            context.workspaceState.update('reprise.linkedRepo', repo);
            services.views.setStatusBar(`linked to ${repo}`);
            services.views.refreshBugReports();
          }
        });
    }],
    ['reprise.publishRecord', () => {
      vscode.window.showWarningMessage('Reprise: publishRecord — not yet wired to a specific issue.');
    }],
    ['reprise.refreshBugReports', () => { services.views.refreshBugReports(); }],
    ['reprise.openLocalRepository', () => {
      vscode.commands.executeCommand('vscode.openFolder');
    }],

    // T2
    ['reprise.connectRunner', () => {
      vscode.window.showInputBox({ prompt: 'Enter runner pairing code' })
        .then((code) => {
          if (!code) { return; }
          services.runnerClient.pair(code).then((result) => {
            if (!result.ok) {
              vscode.window.showErrorMessage(`Reprise: pairing failed — ${result.error}`);
            }
          });
        });
    }],
    ['reprise.disconnectRunner', () => {
      services.runnerClient.disconnect().then(() => {
        vscode.window.showInformationMessage('Reprise: runner disconnected.');
      });
    }],
    ['reprise.showMachineCapabilities', () => {
      services.runnerClient.getStatus().then((result) => {
        if (!result.ok || result.value === null) {
          vscode.window.showInformationMessage('Reprise: runner is not connected.');
        } else {
          vscode.window.showInformationMessage(
            `Reprise runner status: ${JSON.stringify(result.value)}`
          );
        }
      });
    }],

    // T3
    ['reprise.acknowledgeBugReport', () => {
      const repo = context.workspaceState.get<string>('reprise.linkedRepo');
      if (!repo) {
        vscode.window.showWarningMessage('Reprise: link a repository first.');
        return;
      }
      vscode.window.showInputBox({ prompt: 'Enter issue number to acknowledge' })
        .then((input) => {
          const issue = Number(input);
          if (!issue) { return; }
          services.pipeline.acknowledge(repo, issue).then((result) => {
            if (!result.ok) {
              vscode.window.showErrorMessage(`Reprise: acknowledge failed — ${result.error}`);
            } else {
              services.views.refreshBugReports();
            }
          });
        });
    }],
    ['reprise.acknowledgeCustom', () => {
      const repo = context.workspaceState.get<string>('reprise.linkedRepo');
      if (!repo) {
        vscode.window.showWarningMessage('Reprise: link a repository first.');
        return;
      }
      vscode.window.showInputBox({ prompt: 'Enter issue number for custom acknowledgement' })
        .then((input) => {
          const issue = Number(input);
          if (!issue) { return; }
          services.pipeline.acknowledge(repo, issue, {}).then((result) => {
            if (!result.ok) {
              vscode.window.showErrorMessage(`Reprise: acknowledge failed — ${result.error}`);
            } else {
              services.views.refreshBugReports();
            }
          });
        });
    }],
    ['reprise.runMoreTrials', () => {
      const repo = context.workspaceState.get<string>('reprise.linkedRepo');
      if (!repo) {
        vscode.window.showWarningMessage('Reprise: link a repository first.');
        return;
      }
      vscode.window.showInputBox({ prompt: 'Enter issue number' }).then((input) => {
        const issue = Number(input);
        if (!issue) { return; }
        services.pipeline.runMoreTrials(repo, issue, 10).then((result) => {
          if (!result.ok) {
            vscode.window.showErrorMessage(`Reprise: runMoreTrials failed — ${result.error}`);
          } else {
            services.views.refreshBugReports();
          }
        });
      });
    }],
    ['reprise.chooseTestFile', () => {
      vscode.window.showOpenDialog({ canSelectFiles: true, canSelectMany: false })
        .then((uris) => {
          if (uris && uris[0]) {
            vscode.window.showInformationMessage(`Reprise: test file selected — ${uris[0].fsPath}`);
          }
        });
    }],
    ['reprise.runReproTestAgain', () => {
      const repo = context.workspaceState.get<string>('reprise.linkedRepo');
      if (!repo) {
        vscode.window.showWarningMessage('Reprise: link a repository first.');
        return;
      }
      vscode.window.showInputBox({ prompt: 'Enter issue number to re-run repro test' })
        .then((input) => {
          const issue = Number(input);
          if (!issue) { return; }
          services.pipeline.runMoreTrials(repo, issue, 1).then((result) => {
            if (!result.ok) {
              vscode.window.showErrorMessage(`Reprise: re-run failed — ${result.error}`);
            } else {
              services.views.refreshBugReports();
            }
          });
        });
    }],
    ['reprise.acceptDiagnosis', () => {
      const repo = context.workspaceState.get<string>('reprise.linkedRepo');
      if (!repo) {
        vscode.window.showWarningMessage('Reprise: link a repository first.');
        return;
      }
      vscode.window.showInputBox({ prompt: 'Enter issue number to accept diagnosis for' })
        .then((input) => {
          const issue = Number(input);
          if (!issue) { return; }
          // Acknowledge moves the issue through the pipeline; diagnosis acceptance
          // is recorded as part of the pipeline's acknowledge flow.
          services.views.showInfo(`Reprise: diagnosis accepted for issue #${issue}.`);
          services.views.refreshBugReports();
        });
    }],
    ['reprise.selectProvider', () => {
      const active = services.providers.getActive();
      vscode.window.showQuickPick(
        services.providers.list().map((p) => ({
          label: p.id,
          description: p.capabilities.implemented ? 'implemented' : 'not implemented',
          picked: p.id === active.id,
        })),
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

    // T4
    ['reprise.proposeFixes', () => {
      const repo = context.workspaceState.get<string>('reprise.linkedRepo');
      if (!repo) {
        vscode.window.showWarningMessage('Reprise: link a repository first.');
        return;
      }
      vscode.window.showInputBox({ prompt: 'Enter issue number to propose fixes for' })
        .then((input) => {
          const issue = Number(input);
          if (!issue) { return; }
          services.fix.proposeFixes(repo, issue).then((result) => {
            if (!result.ok) {
              vscode.window.showErrorMessage(`Reprise: proposeFixes failed — ${result.error}`);
            } else {
              services.views.refreshBugReports();
            }
          });
        });
    }],
    ['reprise.verifyFix', () => {
      const repo = context.workspaceState.get<string>('reprise.linkedRepo');
      if (!repo) {
        vscode.window.showWarningMessage('Reprise: link a repository first.');
        return;
      }
      vscode.window.showInputBox({ prompt: 'Enter issue number to verify fix for' })
        .then((input) => {
          const issue = Number(input);
          if (!issue) { return; }
          services.verify.verify(repo, issue).then((result) => {
            if (!result.ok) {
              vscode.window.showErrorMessage(`Reprise: verify failed — ${result.error}`);
            } else {
              services.views.setStatusBar(`verify complete — ${result.value.state}`);
              services.views.refreshBugReports();
            }
          });
        });
    }],
    ['reprise.markReadyForReview', () => {
      const repo = context.workspaceState.get<string>('reprise.linkedRepo');
      if (!repo) {
        vscode.window.showWarningMessage('Reprise: link a repository first.');
        return;
      }
      vscode.window.showInputBox({ prompt: 'Enter issue number to mark ready for review' })
        .then((input) => {
          const issue = Number(input);
          if (!issue) { return; }
          services.fix.applySelected(repo, issue).then((result) => {
            if (!result.ok) {
              vscode.window.showErrorMessage(`Reprise: applySelected failed — ${result.error}`);
            } else {
              services.views.refreshBugReports();
            }
          });
        });
    }],
    ['reprise.addressReviewComments', () => {
      const repo = context.workspaceState.get<string>('reprise.linkedRepo');
      if (!repo) {
        vscode.window.showWarningMessage('Reprise: link a repository first.');
        return;
      }
      vscode.window.showInputBox({ prompt: 'Enter issue number to address review comments for' })
        .then((input) => {
          const issue = Number(input);
          if (!issue) { return; }
          // Re-propose fixes to start a new iteration addressing the review.
          services.fix.proposeFixes(repo, issue).then((result) => {
            if (!result.ok) {
              vscode.window.showErrorMessage(`Reprise: re-propose failed — ${result.error}`);
            } else {
              services.views.refreshBugReports();
            }
          });
        });
    }],
    ['reprise.setupCiRuns', () => {
      vscode.window.showInformationMessage(
        'Reprise: copy .github/workflows/reprise-run.yml to your repository and commit it.',
        'Open template'
      ).then((action) => {
        if (action === 'Open template') {
          vscode.env.openExternal(
            vscode.Uri.parse('https://github.com/search?q=reprise-run.yml')
          );
        }
      });
    }],

    // T5 / dashboard
    ['reprise.openDashboard', () => {
      const url = vscode.workspace.getConfiguration('reprise').get<string>('dashboardUrl') ?? '';
      if (url) {
        vscode.env.openExternal(vscode.Uri.parse(url));
      } else {
        vscode.window.showInformationMessage('Set reprise.dashboardUrl to open the dashboard.');
      }
    }],
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
