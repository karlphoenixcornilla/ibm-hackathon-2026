# Architecture Decision Records

Each ADR points to the requirement or provisional decision it implements. An ADR that rests on a provisional decision is itself provisional until that decision is confirmed.

## ADR-1 Web build of a Code - OSS fork (R-2, R-16; PD-3, PD-4, PD-21)
Fork `microsoft/vscode` at a pinned stable tag and produce only its web build. Rebrand through `product.json` and assets as gates G-3 and G-4 require. Turn the extension gallery off (PD-21); v2's Open VSX gallery (V-2) is the alternative. Serve the static build from GitHub Pages at `/ide/` (PD-4, gates G-5, G-6).

## ADR-2 Features as a built-in web extension (PD-1, provisional)
All Reprise behaviour in the browser lives in `extensions/reprise/`, registered as a built-in web extension (gate G-2), with a `browser` entry point and no Node APIs, using only stable extension APIs (gate G-19). Hashing uses `crypto.subtle`; YAML and JSON Schema libraries must be bundle-safe for a web worker.

## ADR-3 GitHub sign-in (R-3; PD-23, provisional)
Use the built-in GitHub authentication provider only if gate G-7 shows it works in the fork's web build. Otherwise, and by default, the user enters a fine-grained personal access token scoped to the target repositories (permissions from G-17). Device flow is added only if gate G-22 shows it works without a server. Tokens are stored only in the workbench's secret storage and never leave the browser.

## ADR-4 Pluggable providers, stub first (R-5)
One Provider interface covering the stages intake, dedupe, test, rootcause and fix, with stage schemas shared by all providers. The `stub` provider is the only implementation now. `claude`, `bob`, `gemini`, `groq` exist as registered names that report "not implemented" until built. Provider choice is a setting, and the provider name is stored in every record. Future providers call their APIs with `fetch` from the browser; each must be checked for CORS and cost before it is enabled. Providers that only exist as a CLI (for example `bob run`, V-6) would run through the Reprise Runner.

## ADR-5 Executors and adapters (R-6, R-7, R-8)
An Executor decides where a run happens: `local` (the paired Reprise Runner) or `ci` (GitHub-hosted runner). An Adapter decides how (repository command first, driver fallback second) and parses results into one per-test result format. Adapters live in the runner and in the CI run loop, never in the browser. Platform to host requirements: `windows` needs a Windows host; `macos` and `ios` need a macOS host with Xcode; `android` needs a host with the Android SDK and a device or emulator; `linux` needs a Linux host. The browser tab can be on any machine that has a supported browser, but local runs need the runner on the same machine as the tab (ADR-11).

## ADR-6 Driver fallback through Appium 2 (R-8; PD-8, PD-9, provisional)
Fallback tests use Appium 2 drivers `windows`, `mac2`, `xcuitest`, `uiautomator2` (V-3) through a WebdriverIO client, started by the Reprise Runner. Linux has no fallback unless gate G-13 finds one.

## ADR-7 Same statistics everywhere
Verdicts, intervals and required verification runs follow `02-specs/statistics.md` unchanged, for every platform and executor. They are computed in the browser.

## ADR-8 Records on `reprise-data`, dashboard on Pages (R-12, R-14; PD-12, PD-13, provisional)
One JSON file per issue on each target repository's `reprise-data` branch, committed through the Git Data API; a Pages site in `reprise-ide` aggregates the repositories listed in `dashboard/repos.json` and serves the IDE beside it.

## ADR-9 Human approval before running non-user tests locally (PD-10, provisional)
Provided tests and proposed fixes are shown in the diff editor and need explicit approval before they are written to the opened folder. The runner runs a test file only if the IDE reports it as approved and its SHA-256 matches what was approved. CI runs happen on ephemeral GitHub-hosted runners but still need the user to start them.

## ADR-10 Zero cost (R-13)
Public repositories only for CI and Pages (V-4, V-5), static hosting only (no server), runner as a single file on GitHub Releases, self-hosted fonts, no paid services.

## ADR-11 Reprise Runner for local execution (R-7, R-16; PD-17, PD-18, PD-24, provisional)
A browser tab cannot start processes, so local runs go through a Node.js runner on `127.0.0.1`. It is started by the user with `--root` pointing at the same clone the IDE has open, paired by a one-time code, and checks each request's `Origin` against an allow-list. The IDE and runner confirm they see the same repository by comparing the remote URL and `HEAD` (`runner-pairing.mmd`). The runner reads commands only from its own `.reprise.yml`, never from the tab. Whether a public HTTPS page may call `127.0.0.1` in Chrome and Edge, and with which prompt, is gate G-23.

## ADR-12 Chromium-only browser support (R-16; PD-22, provisional)
Any Chromium-based desktop browser is supported (Chrome, Edge, Brave, Opera, Vivaldi, Arc and others). The IDE checks for `window.showDirectoryPicker` in a secure context at startup; that capability check is the only gate, with no user-agent allow-list. If the API is missing (Firefox, Safari, mobile browsers, or a Chromium browser with it turned off), the IDE shows a page that describes the supported browsers and links to the dashboard, instead of a half-working editor. Chrome and Edge are the tested browsers (gate G-20).
