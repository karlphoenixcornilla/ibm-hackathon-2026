# Browser Runtime Spec

Implements R-16, ADR-1, ADR-2, ADR-12. Decisions: PD-4, PD-21, PD-22. Gates: G-6, G-19 to G-21, G-25 to G-28.

## Supported browsers (PD-22)

| Browser | Status | Minimum version |
| --- | --- | --- |
| Any Chromium-based desktop browser (Windows, macOS, Linux) that exposes `window.showDirectoryPicker` in a secure context: Chrome, Edge, Brave, Opera, Vivaldi, Arc and others | Supported. The startup check below is the gate, not a list of browser names | The Chromium version that ships the File System Access API: 86 (G-20) |
| A Chromium desktop browser with the API turned off (for example by a privacy setting or policy, G-28) | Shows the unsupported-browser page; the user can turn the API on or use Chrome or Edge | — |
| Firefox, Safari, any mobile browser (including Chrome and Samsung Internet on Android) | Not supported (R-16): no directory picker | — |

The team tests Chrome and Edge (G-20); other Chromium browsers are covered by the capability check rather than by testing each one. Do not add a user-agent allow-list.

## Startup check

Before the workbench loads Reprise features, the IDE checks for `window.showDirectoryPicker` and a secure context (`window.isSecureContext`). If either is missing, it shows the **unsupported-browser page** instead of the editor:

> Reprise IDE needs a Chromium-based desktop browser that can open folders on your computer, such as Chrome, Edge, Brave, Opera, Vivaldi or Arc. Firefox, Safari and mobile browsers aren't supported yet. If your browser blocks folder access, turn it on in the browser's settings or use Chrome or Edge. You can still browse results on the dashboard.

The page links to the dashboard (`../`). It has no other content. Where this check lives in the web build (the embedder page or the extension) is recorded in `ide-fork.md` in phase 1.

## Opening the local folder (gate G-21)

- The workbench's **Open Folder** calls `showDirectoryPicker({ mode: "readwrite" })`. The user picks the root of their clone of the target repository.
- The handle is kept by the workbench (IndexedDB) so the folder reopens after a reload. On reload the browser asks for permission again; until the user grants it, Reprise shows "Allow access to <folder name> to continue" with one button that requests permission.
- If G-21 fails, the extension adds "Reprise: Open Local Repository", which calls `showDirectoryPicker` itself and mounts the handle as a file system provider under the scheme `reprise-local`. Record which path is used.
- The extension reads and writes only through `vscode.workspace.fs`. Every write (provided test, applied fix) happens only after approval (PD-10) and is followed by reading the file back to compute its SHA-256 with `crypto.subtle.digest`.
- Reading `.git/config` and `.git/HEAD` for repository linking goes through the same handle (gate G-27). Reprise never writes inside `.git/`.

## What the browser stores

| Data | Where | Cleared by |
| --- | --- | --- |
| GitHub token | Workbench secret storage (PD-23) | "Reprise: Sign Out" |
| Runner session token and port | Workbench secret storage | "Reprise: Disconnect Runner", runner restart |
| Folder handle | Workbench IndexedDB | Closing the folder |
| Linked `owner/repo`, UI state | Workspace state | Unlinking |
| Cached issue records | Memory, optionally IndexedDB (gate G-25) | Reload |

Nothing is stored in `localStorage` in plain text except UI preferences.

## Network

| Destination | From | Purpose | Gate |
| --- | --- | --- | --- |
| `https://api.github.com` | Extension (`fetch`) | Issues, Git Data API, PRs, workflows | G-19 |
| Artifact download redirect target | Extension | CI results | G-24 |
| `http://127.0.0.1:<port>` | Extension | Paired Reprise Runner | G-23 |
| Future AI provider APIs | Extension | Provider stages | Checked per provider (ADR-4) |

No other origins. The IDE page's Content-Security-Policy `connect-src` lists exactly these (with the port range from `local-runner.md`); the exact header or meta tag is recorded in `ide-fork.md` (the web build may need to relax other directives, gate G-6).

## Hosting (PD-4, gates G-5, G-6)

- Static web build under `/ide/` of `https://OWNER.github.io/reprise-ide/`, next to the dashboard at `/`.
- If G-6 shows the web build needs cross-origin isolation headers that Pages cannot set, apply the G-6 fallback and record it here.
- The IDE works offline only as far as the browser cache allows; nothing is promised.

## Things the browser cannot do (and where they happen instead)

| Need | Where it happens |
| --- | --- |
| Start test processes, adb, xcodebuild, Appium | Reprise Runner (`local-runner.md`) or CI |
| Check out base and head for verification | Runner worktrees (PD-24) or CI |
| git push | GitHub REST Git Data API (PD-19) |
| Integrated terminal | Not available in the web build; not needed |
