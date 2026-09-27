# Verification Gates — Results

Recorded during base implementation. Phase 0 gates researched; Phase 1 gates require the actual Code-OSS fork build and browser testing.

| Gate | Description | Result | Notes |
| ---- | ----------- | ------ | ----- |
| G-1 | Web build works at the pinned tag | **Pending (build wired)** — pinned tag `1.139.1` (`ide/CODE_OSS_TAG`, Node 24.18.0 per its `.nvmrc`). Web target task is `npm run gulp vscode-web-min`, output `../vscode-web`. Built on the hosted runner by `pages.yml` via `ide/build.mjs`. | PASS once the first `pages.yml` IDE build succeeds. |
| G-2 | Built-in web extension mechanism exists | **PASS (source read at `1.139.1`)** — `build/lib/extensions.ts` packages every `extensions/*` folder whose manifest has `browser`, and `build/next/index.ts` bakes them into the workbench's built-in list. `ide/build.mjs` stages the webpack bundle of `extensions/reprise` there. | Confirmed in the browser after the first deploy. |
| G-3 | `product.json` fields for rebranding | **PASS** — `nameShort`, `nameLong`, `applicationName`, `dataFolderName`, `reportIssueUrl` overridden by `ide/product.overrides.json`. Code - OSS has no `extensionsGallery`, and the build fails if one is added (PD-21). | Old/new values in `docs/kit/02-specs/ide-fork.md`. |
| G-4 | Trademark and licence — icons and names | **Pending** — VS Code name and icon are Microsoft trademarks. The web build's favicon, manifest.json, workbench icons must be replaced. VSCodium's approach (replace with generic icons) applies. | Phase 1 team action. |
| G-5 | GitHub Pages hosting | **Pending (workflow implemented)** — `pages.yml` builds the IDE into `/ide/` and the dashboard into `/`. The embedder page resolves its base URL at runtime, so no base-path configuration is needed. | Record size and build time from the first run's `ide/build.mjs` output. |
| G-6 | Cross-origin isolation headers not required, or Pages can set them | **Pending** — Code-OSS web build may need `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` for `SharedArrayBuffer`. If required, Pages cannot set custom headers; apply fallback (service worker or `coi-serviceworker`). | Serve the built `/ide/` and check browser console. |
| G-7 | Built-in GitHub auth provider works in web build | **Pending** — the `vscode.github-authentication` built-in may not activate in the web build. Default to token entry (PD-23). | Phase 1 check: activate `vscode.authentication.getSession('github', …)` in the extension. |
| G-8 | Runner release workflow | **Deferred** — T5 scope. | — |
| G-9 | Windows CI runner available on GitHub Actions | **Likely PASS** — `windows-latest` is available. | Confirm platform labels from demo-apps.md. |
| G-10 | Android emulator on GitHub Actions (ubuntu) | **Pending** — free tier memory limits may affect emulator start. | Phase 3 (T4) check. |
| G-11 | iOS simulator on macOS Actions runner | **Pending** — `macos-latest` has Xcode; simulator start feasibility depends on demo app. | Phase 3 (T4) check. |
| G-12 | Windows Appium driver host requirements | **Pending** — WinAppDriver or Appium Windows driver 2.x. | T4 scope. |
| G-13 | Linux driver fallback | **Pending** — no Appium fallback unless AT-SPI or similar confirmed. | T4 scope. |
| G-14 | JUnit XML at report_path | **Assumed PASS** — standard for Android/iOS toolchains. | Confirmed when demo-apps.md is filled. |
| G-15 | IBM Bob must run inside the product at runtime | **Pending** — hackathon rules not definitively resolved. PD resolution required before T3. If required, a runner endpoint wrapping `bob run` would be needed (V-6). | Team decision required. |
| G-17 | GitHub token permissions needed | **PASS** — fine-grained PAT with `contents:write` on target repos, `issues:read`, `pull_requests:write`, `actions:write`. | Confirmed from data-contracts.md and test-execution.md CI executor. |
| G-18 | Actions version pins | **Pending** — pin `actions/checkout@v4`, `actions/upload-artifact@v4` after confirming SHA. | T5 scope. |
| G-19 | Extension APIs available in web build | **Pending** — `vscode.workspace.fs`, `vscode.authentication`, `vscode.secretStorage`, `vscode.window.createTreeView`, `vscode.window.createWebviewPanel`, `vscode.window.createStatusBarItem` expected to work. | Phase 1 test calls. |
| G-20 | Browser minimum versions for `showDirectoryPicker` | **Likely PASS** — Chrome 86+, Edge 86+ support the File System Access API with `readwrite` mode. Brave/Opera/Vivaldi/Arc: same Chromium engine, API enabled by default. Firefox/Safari: not supported. | Record exact minimum versions from MDN. |
| G-21 | Open Folder uses File System Access API | **Pending** — Code-OSS web build uses `showDirectoryPicker` via VS Code's web filesystem provider. Must survive reload (IndexedDB handle). | Phase 1 browser test. |
| G-22 | Device flow without a server | **Pending** — GitHub device flow requires polling `github.com/login/device/code`; works from `fetch` in browser. Confirm no server needed. | T1 scope. |
| G-23 | Runner `Origin` for `127.0.0.1` requests from web worker | **Pending** — the exact `Origin` header the web-worker extension host sends to `127.0.0.1` must be recorded from a browser test. Chrome/Edge Private Network Access prompts. `Access-Control-Allow-Private-Network: true` likely required. | Phase 1/T2 browser test. |
| G-24 | Artifact download from browser without runner | **Pending** — downloading GitHub Actions artifacts requires authentication; `fetch` from the browser with the PAT to `api.github.com/repos/.../actions/artifacts/.../zip` then a redirect. ZIP unpacking with a bundled reader. | T2 scope. |
| G-25 | IndexedDB for cached records | **Likely PASS** — available in web workers (extension host). | T1 scope. |
| G-26 | Git/Source Control view works on opened folder | **Pending** — the web build's git extension may not operate on a File System Access folder. Phase 1 browser test required. | Phase 1 browser test. |
| G-27 | Reading `.git/config` through File System Access | **Pending** — `.git/` is visible in the opened folder via the File System Access handle. Test reading `.git/config` and `.git/HEAD`. | Phase 1 browser test. |

## Stop conditions reached

None so far. If G-1 fails at the chosen tag, a new tag must be selected before any further work.
