# IDE UX Spec

The Reprise web extension adds one activity-bar container, **Reprise**, with two views, one editor-area panel and a status bar item. Apply the dashboard design tokens and the team motion rules (`dashboard.md`, "Motion") to every webview. Browser-specific behaviour is in `browser-runtime.md`.

## First run

The Reprise container shows a checklist until each step is done, in this order (a real sequence, so it is numbered):

1. **Open your repository folder** — runs Open Folder (`browser-runtime.md`). Done when a folder with `.reprise.yml` is open.
2. **Sign in to GitHub** — token prompt (PD-23). Done when the token works.
3. **Link the repository** — from `.git/config`, with confirmation.
4. **Connect the Reprise Runner** (optional; needed for runs on this machine) — shows the command to start the runner for this folder, with a copy button, and a field for the pairing code (`local-runner.md`).

Steps 1 to 3 are required for the Bug Reports view. Step 4 can be skipped when only CI runs are used.

## Views

### Bug Reports (tree view)

- Requires the first-run steps 1 to 3; otherwise shows the checklist.
- Lists open issues with the configured labels (PD-5), newest first. Each row: `#N title`, a state badge from the record (display names in `dashboard.md`), and the platform once known.
- Inline actions per row: **Acknowledge** (states LISTED, NEEDS_INFO, BLOCKED_ENV, STOPPED, ERROR), **Open in Reprise panel**, **Open on GitHub**.
- Refresh button; auto-refresh every 5 minutes while visible and the tab is in the foreground.

### Runs (tree view)

Active and recent runs: platform, executor ("this machine" with the runner's host OS, or "CI"), progress `k of n`, elapsed time, a stop action.

## Reprise panel (webview in the editor area, one per issue)

Sections in order: report summary; replication (verdict, trial strip, rate and interval, trial policy used and why it stopped, signature, test origin "provided by stub" or "your test", platform and where it ran); diagnosis (with **Accept diagnosis** and **Edit**); fix (candidates table with status, diff link and quick-check result per candidate, selected candidate, draft PR link and its checklist); verification (strip, claim sentence, regression table with only non-zero rows); self-review findings; timeline. Buttons: **Acknowledge again**, **Run more trials**, **Accept diagnosis**, **Propose fixes**, **Approve and run candidates** (local only), **Apply selected**, **Verify fix**, **Mark ready for review**, **Address review comments**, **Publish record**.

**Acknowledge** shows the trial policy that will apply ("10 to 20 runs, from .reprise.yml") with a **Change** link: a small form for min, max and time budget, for this replication only. **Run more trials** asks how many to add (default 10, capped at `limit`).

Every output produced by the stub provider shows the label "Stub response prepared for this demo" next to it.

## Approvals (PD-10)

Before a provided test is written to the folder, or a proposed fix is applied, the IDE opens `vscode.diff` of the change and a modal with **Approve and write** / **Approve and apply** and **Cancel**. On approval, the IDE writes the file through `workspace.fs`, computes its SHA-256 and sends it to the runner's `/approve` (if paired). Cancelling a provided test sets state `STOPPED`.

## Commands (Command Palette, prefix "Reprise:")

Sign In to GitHub; Sign Out; Link Repository; Connect Runner; Disconnect Runner; Acknowledge Bug Report; Acknowledge with Custom Trial Count; Run More Trials; Choose Test File for Report; Run Reproduction Test Again; Accept Diagnosis; Propose Fixes; Verify Fix; Mark Ready for Review; Address Review Comments; Set Up CI Runs (PD-14); Publish Record; Open Dashboard; Select Provider; Show Machine Capabilities; Open Local Repository (only if gate G-21 fails).

"Show Machine Capabilities" lists, per platform, whether the paired runner's machine can run it and what is missing (tool, SDK, device), whether CI is configured, and whether a driver fallback is available. Without a paired runner it says "No runner connected: local runs unavailable" and shows CI status only.

## Status bar

`Reprise: <repo>` with the signed-in state; `Runner: <host OS>` or `Runner: not connected`; `n runs` while runs are active. Clicking opens the Runs view.

## Unsaved-work guard

While runs are active or a record is not yet committed, closing or reloading the tab triggers the browser's "Leave site?" prompt (`beforeunload`).

## Settings (VS Code configuration)

`reprise.provider` (default `stub`), `reprise.postResultsToGitHub` (default `false`, PD-6), `reprise.defaultExecutor` (`local` or `ci`, default `local`), `reprise.dashboardUrl`, `reprise.runnerPort` (default `47410`).
