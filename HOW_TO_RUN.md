# How to run Reprise

This guide takes you from a fresh machine to Reprise reproducing a real bug with IBM Bob. Follow it top to bottom the first time. After that, [Everyday start-up](#everyday-start-up) is all you need.

For a full reference of every variable and setting, see [docs/SETUP.md](docs/SETUP.md). To build release artifacts, see [BUILDING.md](BUILDING.md).

---

## Contents

1. [What you are running](#1-what-you-are-running)
2. [Prerequisites](#2-prerequisites)
3. [One-time setup](#3-one-time-setup)
4. [Run it](#4-run-it)
5. [Use it: acknowledge, fix, verify](#5-use-it-acknowledge-fix-verify)
6. [Other ways to run](#6-other-ways-to-run)
7. [Run the tests](#7-run-the-tests)
8. [Troubleshooting](#8-troubleshooting)
9. [Everyday start-up](#everyday-start-up)

---

## 1. What you are running

Reprise has three parts. You run two of them locally.

```
 Browser (Chrome/Edge)                        Your machine                          GitHub
┌───────────────────────────┐  pairing code  ┌──────────────────────────────┐   ┌──────────────────────┐
│ Reprise IDE               │◀──────────────▶│ Reprise Runner (127.0.0.1)   │   │ Issues labelled bug  │
│ (VS Code for the Web +    │  127.0.0.1:    │ • runs your app's tests      │   │ reprise-data branch  │
│  the Reprise extension)   │  47410         │ • runs IBM Bob (`bob run`)   │   │ fix PRs              │
│ • lists bug reports       │                │   in your local clone        │   └──────────▲───────────┘
│ • shows diffs, verdicts   │───────────── GitHub token (browser only) ──────────────────────┘
└───────────────────────────┘
```

| Part | Where it runs | You start it with |
| --- | --- | --- |
| **Reprise IDE** — the `extensions/reprise` web extension | A browser tab at `http://localhost:3000` | `npm run web -- <your clone>` |
| **Reprise Runner** — runs tests and IBM Bob | A terminal on your machine | `node runner/reprise-runner.mjs --root <your clone>` |
| **Dashboard** — public results (optional) | Any static host / GitHub Pages | `node dashboard/build.mjs` |

**The one rule:** the IDE and the runner must use **the same local clone** of the app you are debugging. Bob and the tests read and write files in that folder.

---

## 2. Prerequisites

| Need | Version | Check | Get it |
| --- | --- | --- | --- |
| Node.js | **24 or later** (Bob Shell needs 24; the runner alone needs 22) | `node --version` | <https://nodejs.org> or `winget install OpenJS.NodeJS` |
| Git | any recent | `git --version` | <https://git-scm.com> |
| GitHub CLI (optional, makes step 3.4 easier) | any | `gh --version` | `winget install GitHub.cli`, then `gh auth login` |
| Google Chrome or Microsoft Edge | recent, desktop | — | Firefox and Safari are not supported |
| IBM Bob account (trial or paid) | — | log in at <https://bob.ibm.com> | — |
| The app's own toolchain | — | — | The demo app only needs Node. Real apps may need the Android SDK, Xcode, and so on |

The commands below use **PowerShell** on Windows. On macOS/Linux, use `export NAME=value` instead of `$env:NAME = "value"`, and `/` paths.

---

## 3. One-time setup

### 3.1 Get this repository and install the extension

```powershell
git clone https://github.com/karlphoenixcornilla/ibm-hackathon-2026.git
cd ibm-hackathon-2026\extensions\reprise
npm install
npm run compile          # builds dist/extension.js (the web extension)
```

The first `npm run web` later downloads VS Code for the Web (about 50 MB) into `extensions/reprise/.vscode-test-web/`, which git ignores.

### 3.2 Install IBM Bob Shell and accept its license

```powershell
powershell -c "irm -Uri https://bob.ibm.com/download/bobshell.ps1 | iex"     # Windows
# macOS/Linux:  curl -fsSL https://bob.ibm.com/download/bobshell.sh | bash

bob --version            # confirms it is on PATH
bob                      # run once interactively: read and ACCEPT the license, then exit
```

> Skipping the license step makes every AI stage fail with *"Bob Shell's license has not been accepted"*.
> Alternatively, start the runner with `--bob-accept-license`, which accepts it on your behalf.

### 3.3 Create an IBM Bob API key

1. Log in at <https://bob.ibm.com>, open your **subscription instance**, then **API keys**.
2. Create a key with type **Inference**.
3. **Copy it now.** It is shown only once.

This key only ever goes into the runner's terminal (`BOB_API_KEY`). Never put it in the IDE, the repository, or GitHub.

### 3.4 Get an app to debug

Reprise needs a **local clone** of a GitHub repository that:

- has a `.reprise.yml` at its root (it tells Reprise how to run tests),
- has open issues labelled **`bug`**.

**Fastest option: the demo app.** `reprise-demo-app` is a small Node.js invoicing library with two planted bugs, a ready `.reprise.yml`, and stub answers for rehearsing without Bob.

| Issue | Bug | Expected verdict |
| --- | --- | --- |
| #1 | Invoices sometimes come back out of order | **Reproduced sometimes** (about 4 runs in 10) |
| #2 | A refund shows as `€-19.99` instead of `-€19.99` | **Reproduced** (every run) |

If a copy is already on GitHub, clone it:

```powershell
gh repo clone AustineLomocso/reprise-demo-app C:\dev\reprise-demo-app
```

To host your own copy, fork or push it to your account and create the two issues **in this order**. The stub answers are keyed by issue number.

```powershell
cd C:\dev\reprise-demo-app
gh issue create --label bug --title "Invoice export sometimes lists invoices in the wrong order" --body "When I export several invoices at once, the CSV sometimes lists them in a different order than I selected. It doesn't happen every time."
gh issue create --label bug --title "Refunds show the minus sign after the euro symbol" --body "A refund of 19.99 EUR is shown as €-19.99. It should be -€19.99."
```

**Your own app:** clone it and add a `.reprise.yml`. Copy the demo app's file and change `edit_scope` and the `platforms.<os>.test` commands. The full reference is [docs/kit/02-specs/reprise-config.md](docs/kit/02-specs/reprise-config.md). Keep it in plain block-style YAML: the runner reads it with a small built-in parser that does not understand inline `{ a: 1 }` maps.

### 3.5 Create a GitHub token

Reprise reads issues, stores records on a `reprise-data` branch, and opens fix PRs, so it needs a token. You can create it now, or when the IDE asks (step 5.1).

**Fine-grained token** (recommended), at <https://github.com/settings/personal-access-tokens/new>:

- **Repository access:** *Only select repositories*, then your app repository.
- **Permissions:** Contents, Issues, Pull requests and Actions all **Read and write**; Metadata **Read**. Add Workflows **Read and write** only if you will use *Set Up CI Runs*.
- **Expiration:** after the hackathon.

A classic token with the `repo` scope (plus `workflow` for CI setup) also works. The IDE's built-in *Continue to GitHub* flow creates one for you.

The token stays in the browser's secret storage. It is **never** sent to the runner or to IBM Bob.

---

## 4. Run it

You need **two terminals**. Leave both open while you work.

### Terminal 1 — the runner

```powershell
cd C:\path\to\ibm-hackathon-2026
$env:BOB_API_KEY = "<your IBM Bob Inference API key>"
node runner/reprise-runner.mjs --root C:\dev\reprise-demo-app
```

Check the banner it prints:

```
Reprise Runner 0.1.0
Root:    C:\dev\reprise-demo-app
Remote:  https://github.com/<you>/reprise-demo-app.git
...
Platform capabilities:
  windows: ✓ local                      ← the app's tests can run here

IBM Bob: available 1.x.x                ← Bob is ready (else it says why not)

Listening on http://127.0.0.1:47410
Allowed origins: ..., http://*.localhost:3000
Pairing code: 482913  (valid 5 min, single use)     ← you type this into the IDE
```

- `--root` must be a real folder containing `.reprise.yml`.
- The pairing code appears **only in this terminal**. Each code works once and lasts 5 minutes.
- Useful flags: `--bob-max-cost 1` (Bobcoin cap per stage call, about US$0.50 each), `--bob-max-turns 30`, `--bob-accept-license`, `--no-bob`, `--port`. Run `node runner/reprise-runner.mjs --help` for all of them.

### Terminal 2 — the IDE

```powershell
cd C:\path\to\ibm-hackathon-2026\extensions\reprise
npm run web -- C:\dev\reprise-demo-app
```

Chromium opens at `http://localhost:3000`. Before going on, check:

- [ ] The terminal printed **`Serving local content C:\dev\reprise-demo-app at /static/mount`**. If not, the folder path was not passed.
- [ ] The browser address bar does **not** contain `vscode-vfs`. That would be a GitHub virtual folder; see [Troubleshooting](#8-troubleshooting).
- [ ] The Explorer shows your app's files (`src`, `test`, `.reprise.yml`, …).
- [ ] The status bar at the bottom shows **`Reprise: … · AI: bob`**.

You can also open `http://localhost:3000` in your own Chrome or Edge instead of the launched Chromium.

---

## 5. Use it: acknowledge, fix, verify

Open the **Reprise** view: the clock-shaped icon in the left activity bar. It has two panels, **Bug Reports** and **Runs**. Every command is also in **F1**; type `Reprise:`.

### 5.1 Connect (every browser session)

1. **F1 → Reprise: Sign In to GitHub**.
   - Click **Allow**. Then either click **Continue to GitHub**, which makes a classic token for you, or click **Cancel** and paste your fine-grained token.
   - The status bar changes to **signed in**.
2. **Bug Reports** fills with your `bug` issues.
   - If it says *link a repository*: **F1 → Reprise: Link Repository**, enter `owner/repo`.
   - If it is empty: click the ↻ refresh icon, and hover the placeholder text to see why.
3. **F1 → Reprise: Connect Runner** and type the pairing code from terminal 1.
   - You'll see *"Runner connected to reprise-demo-app on win32 … IBM Bob … ready"*.
   - The status bar shows **runner connected**.

### 5.2 Reproduce a bug

Right-click a report, choose **Acknowledge Bug Report**, and watch the progress notification:

| Step | What happens | What you do |
| --- | --- | --- |
| Intake | Bob reads the issue and the code and describes the bug | — |
| Duplicate check | Compares it with earlier reports | — |
| Test | Bob proposes one reproduction test. A **diff view** opens | **Review it, then click Approve.** Nothing is written or run before you do |
| Trials | The runner runs the test 10–20 times; output streams to **Runs** and to the *Reprise Runs* output channel | — |
| Verdict | *Reproduced*, *Reproduced sometimes*, *Duplicate*, *Needs one answer*, … | — |
| Diagnosis | Bob points at the cause, with files and lines | Optionally **Accept Diagnosis** |

The **Reprise #N** panel shows the fingerprint, trial strip, verdict and diagnosis. The record is saved to the repository's `reprise-data` branch.

Other actions on a report (right-click):

- **Acknowledge with Custom Trial Count** — choose the minimum and maximum number of trials.
- **Run More Trials** — add runs to tighten the result.
- **Choose Test File for Report** — use your own test instead of Bob's (validate mode).

### 5.3 Fix and verify

1. **Propose Fixes.** Bob proposes several fix candidates. For each one you **review the diff**, then the runner quick-checks it in a separate worktree. Candidates that still reproduce, or that break other tests, are rejected.
2. The best survivor is committed to `reprise/fix-N` and opened as a **draft PR**. Click **Open PR** to see it.
3. **Verify Fix.** Runs the reproduction test enough times to support a claim, and compares the full test suite before and after. You get **Fix verified**, **Still reproduces** or **Fix breaks other tests**.
4. **Mark Ready for Review.** Turns the draft PR into a normal PR.

With the demo app, issue #1 has a correct candidate and a deliberately wrong one. The wrong one sorts by id, and the quick check rejects it because it breaks an existing test.

---

## 6. Other ways to run

### Without a Bob key: stub mode

Useful for rehearsing a demo, or while you wait for a key. Reprise replays prepared answers from `.reprise/stubs/<issue>/` in your clone.

1. In the IDE: **F1 → Reprise: Select Provider → stub**, or set `"reprise.provider": "stub"` in Settings.
2. Start the runner with `--no-bob`, no key needed.

Everything else works the same, and records are labelled *stub response*.

### With no runner, no token and no Bob: fake data

To look at the UI only, set `"reprise.dev.useFakes": true` in Settings, then reload the page. Every service is replaced by in-memory fake data.

### In vscode.dev instead of the local server

1. Serve the extension folder (`package.json`, `dist/`, `media/`) over HTTPS. The Pages workflow publishes it at `https://<owner>.github.io/<repo>/ide/extension/`.
2. In <https://vscode.dev>, run **Developer: Install Extension from Location…** with that URL.
3. Start the runner with `--allow-origin "https://*.vscode-cdn.net"`. vscode.dev runs extensions on that domain.
4. Open your local clone with **File → Open Folder** and allow the browser's folder permission.

### The dashboard

```powershell
cd C:\path\to\ibm-hackathon-2026
node dashboard/build.mjs --out _site          # live records from dashboard/repos.json, else sample data
npx http-server _site                          # open http://localhost:8080
```

To show real results, list the public app repositories in `dashboard/repos.json`, for example `["you/reprise-demo-app"]`.

---

## 7. Run the tests

```powershell
cd extensions\reprise
npm run typecheck; npm run lint; npm run depcheck; npm test    # 201 tests

cd ..\..\runner
npm test                                                         # 73 tests

cd ..\dashboard
npm test                                                         # 15 tests
```

After editing `docs/kit/03-runtime-prompts/*.md` (Bob's prompts) or `templates/ci/*`, run `npm run gen:assets` in `extensions/reprise`. A test fails if you forget.

---

## 8. Troubleshooting

### Starting up

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Fatal error: ...\.reprise.yml not found` | `--root` is a placeholder or the wrong folder | Point `--root` at your real clone; it must contain `.reprise.yml` |
| Runner banner says `Port: 47411` | Another runner is still running | Stop it (Ctrl+C in its terminal), or set `reprise.runnerPort` to the printed port |
| IDE terminal: `EADDRINUSE ... 3000` | An IDE server is already running | Close the other `npm run web` (Ctrl+C), or use that one |
| Explorer is empty / "No Folder Opened" | The IDE was started without the folder | Restart with `npm run web -- C:\dev\reprise-demo-app` |
| Address bar contains `vscode-vfs://github/...` | Opened with **Open Repository**, a GitHub virtual copy | Restart with the local folder. Reprise refuses to acknowledge from a virtual folder, because tests written there never reach the runner |
| `Activating extension 'vscode.typescript-language-features' failed` | A built-in VS Code extension that the local test server cannot load | Harmless; ignore |

### Connecting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Bug Reports: *Sign in and link a repository* | Not signed in or not linked | **Sign In to GitHub**, then **Link Repository** (`owner/repo`) |
| Bug Reports empty after signing in | Token cannot read issues, or no open issue has the `bug` label | Hover the placeholder for the reason; check the token has Issues: Read; check the label |
| *Pairing failed: Failed to fetch* | Runner not running, wrong port, or the page's origin is not allowed | Check terminal 1 is running. The runner prints `403 Forbidden origin: "<origin>"`; restart it with `--allow-origin "<origin>"` |
| *Wrong pairing code* | Typo, or an old code | Use the latest `Pairing code:` line. After 5 minutes, try once to get a new code printed |
| *Pairing locked* | 5 wrong codes | Restart the runner |
| *Runner is pointed at a different repository* | The IDE and runner opened different repositories | Use the same clone for `--root` and for `npm run web --` |

### Running with IBM Bob

| Symptom | Fix |
| --- | --- |
| *IBM Bob runs through the Reprise Runner. Use Connect Runner first.* | Connect the runner, or switch to the `stub` provider |
| Runner banner: `IBM Bob: unavailable ("bob" not found …)` | Install Bob Shell, or pass `--bob-bin C:\full\path\to\bob.cmd` |
| *Bob Shell's license has not been accepted* | Run `bob` once and accept it, or start the runner with `--bob-accept-license` |
| *did not finish: … cost* | Raise `--bob-max-cost` (per stage call) |
| *Bob failed: … timed out* | Raise `--bob-timeout <seconds>` (default 600) |
| *output failed the stage schema after one repair* | Bob's answer was malformed twice. Acknowledge again, or use **Choose Test File for Report** |
| Bob's test proposal replaces an existing test file | Allowed inside `edit_scope.test`. Check the diff keeps the old tests before approving |

### Running tests

| Symptom | Fix |
| --- | --- |
| Runner: *Test not approved* (409) | Approve the test in the diff view; Reprise then registers it with the runner |
| *Platform "x" is not locally runnable* | Install what the runner's banner lists as missing, or run on CI (**Set Up CI Runs**) |
| Every trial passes, but the bug is real | Check the **Reprise Runs** output channel. The test may not be running at all: check `platforms.<os>.test.single` works when run by hand in the clone |
| Report has *BLOCKED_ENV* | The report's platform is not in `.reprise.yml` → `platforms` |

---

## Everyday start-up

```powershell
# Terminal 1 — runner
cd C:\path\to\ibm-hackathon-2026
$env:BOB_API_KEY = "<key>"
node runner/reprise-runner.mjs --root C:\dev\reprise-demo-app

# Terminal 2 — IDE
cd C:\path\to\ibm-hackathon-2026\extensions\reprise
npm run web -- C:\dev\reprise-demo-app
```

In the browser: **Sign In to GitHub**, then **Connect Runner** (code from terminal 1), then right-click a bug report and choose **Acknowledge Bug Report**.

To stop, press Ctrl+C in both terminals.
