# Setting up Reprise with IBM Bob

This guide lists every variable and setting Reprise reads, where it lives, and what to set it to. Reprise has four places that take configuration:

| Where | What it configures | Who sets it |
| --- | --- | --- |
| **Runner machine** — environment variables and command-line flags | IBM Bob (API key, cost and turn caps), which web origins may call the runner, the port | Each developer, on the machine that runs tests |
| **IDE settings** (`reprise.*`) | Which AI provider is active, the runner port, dashboard link, posting to GitHub | Each developer, in Reprise IDE / VS Code for the Web |
| **Target repository** — `.reprise.yml`, GitHub token | How to run tests per platform, which paths Bob may propose changes to | The app's maintainers |
| **This repository on GitHub** — Pages, variables, `dashboard/repos.json` | Dashboard and IDE deployment, runner releases | The Reprise team |

## How IBM Bob fits in

IBM Bob Shell is a command-line program (`bob run`), so it cannot run inside the browser. The Reprise Runner on your machine runs it for the IDE:

```
Reprise IDE (browser)  ──POST /ai/run {stage, prompt}──▶  Reprise Runner (127.0.0.1)  ──stdin──▶  bob run --format json
   renders the kit's runtime prompt                           fixed flags, read-only tools,          reads your clone,
   validates the JSON answer (1 repair)                       strips GitHub tokens from env          answers with JSON
```

- The IDE sends only a stage name and a prompt. The runner fixes everything else on its own command line: the binary, `--mode`, `--max-cost`, `--max-turns`, and `--disable-tool-groups edit,execute,mcp,skill,todo,subagent,mode`. Bob can **read** your repository but cannot edit files or run commands.
- Test and fix files that Bob proposes come back inside the JSON answer. You review each one in a diff view and approve it before Reprise writes or runs it.
- The runner removes `GITHUB_TOKEN`, `GH_TOKEN` and anything that looks like a secret from Bob's environment. It keeps only `BOB_API_KEY`.
- Bob is used for all six stages: intake, dedupe, test, rootcause, fix and review.

---

## 1. Runner machine

### Install

1. **Node.js 24 or later.** Bob Shell needs 24; the runner itself needs 22.
2. **IBM Bob Shell:**
   - macOS/Linux: `curl -fsSL https://bob.ibm.com/download/bobshell.sh | bash`
   - Windows (PowerShell): `powershell -c "irm -Uri https://bob.ibm.com/download/bobshell.ps1 | iex"`
   - Check it: `bob --version`
3. **Accept Bob's license once.** Run `bob` interactively a single time, or start the runner with `--bob-accept-license`.
4. **Get the runner**, either from this repository (`runner/reprise-runner.mjs`) or from the single-file release (`reprise-runner.mjs` plus `.sha256`) on the Releases page.

### Environment variables

| Variable | Required | Default | Meaning |
| --- | --- | --- | --- |
| `BOB_API_KEY` | **Yes**, for headless use | — | IBM Bob API key with **Scope: Inference**, created in the Bob web portal. This is the only credential passed to Bob. |
| `REPRISE_IDE_ORIGIN` | Recommended | `https://owner.github.io` | Origin of the deployed IDE, e.g. `https://karlphoenixcornilla.github.io`. Requests from any other origin get 403. `http://localhost:8080`, `http://localhost:3000` and `http://*.localhost:3000` are always allowed for local development. |
| `REPRISE_RUNNER_PORT` | No | `47410` | Port to listen on. If it is busy, the runner tries the next 9 and prints the one it used. |
| `REPRISE_BOB_BIN` | No | `bob` | Path to Bob Shell if it is not on `PATH`. |
| `REPRISE_BOB_MODE` | No | `agent` | Bob agent mode passed as `--mode`. |
| `REPRISE_BOB_MAX_COST` | No | `1` | Bobcoin cap **per stage call** (`--max-cost`). 1 Bobcoin ≈ US$0.50. A full acknowledge makes 3–5 calls, and a fix round makes one call per candidate. |
| `REPRISE_BOB_MAX_TURNS` | No | `30` | Agent-turn cap per stage call (`--max-turns`). |
| `REPRISE_BOB_TIMEOUT_SECONDS` | No | `600` | Wall-clock limit per call; Bob's process tree is killed after it. |
| `REPRISE_BOB_ACCEPT_LICENSE` | No | unset | Set to `1` to pass `--accept-license`. |
| `REPRISE_BOB_DISABLED` | No | unset | Set to `1` to turn the Bob bridge off. |

Command-line flags override the environment: `--port`, `--allow-origin <origin>` (can be repeated), `--bob-bin`, `--bob-mode`, `--bob-max-cost`, `--bob-max-turns`, `--bob-timeout <seconds>`, `--bob-accept-license`, `--no-bob`. Run `node reprise-runner.mjs --help` for the full list.

### Start it

macOS / Linux:

```sh
export BOB_API_KEY="your-inference-api-key"
export REPRISE_IDE_ORIGIN="https://<owner>.github.io"
node reprise-runner.mjs --root ~/dev/my-app
```

Windows (PowerShell):

```powershell
$env:BOB_API_KEY = "your-inference-api-key"
$env:REPRISE_IDE_ORIGIN = "https://<owner>.github.io"
node reprise-runner.mjs --root C:\dev\my-app
```

The runner prints the folder, remote, HEAD, platform capabilities, an `IBM Bob:` line, and a 6-digit pairing code. If it says `IBM Bob: unavailable (...)`, fix the reason it gives before acknowledging reports.

**Finding the right origin (G-23).** The web workbench runs extensions on a per-session subdomain, not on the page's own origin: `http://<hash>.localhost:3000` for `npm run web` (allowed by default), and `https://<hash>.vscode-cdn.net` in vscode.dev. `--allow-origin` accepts a one-label wildcard for this, for example `--allow-origin "https://*.vscode-cdn.net"`. Other extensions on that domain would still need the pairing code. If pairing fails with "Failed to fetch", the runner console shows `403 Forbidden origin: "<origin>"`; restart the runner with `--allow-origin` for that origin.

---

## 2. IDE settings

Open **Settings** and search for `reprise`, or add these to `settings.json`:

| Setting | Default | Set it to |
| --- | --- | --- |
| `reprise.provider` | `"bob"` | `"bob"` to use IBM Bob through the runner. `"stub"` replays prepared answers from `.reprise/stubs/<issue>/` in the opened folder, which is useful for rehearsing a demo without spending Bobcoins. `claude`, `gemini` and `groq` are listed but not implemented. You can also change it with **Reprise: Select Provider**. |
| `reprise.runnerPort` | `47410` | The port the runner printed, if it differs. |
| `reprise.defaultExecutor` | `"local"` | `"ci"` to run tests on GitHub Actions by default (after **Reprise: Set Up CI Runs**). |
| `reprise.dashboardUrl` | `""` | `https://<owner>.github.io/<repo>/`, used by **Reprise: Open Dashboard**. |
| `reprise.postResultsToGitHub` | `false` | `true` to comment each verdict on the GitHub issue (PD-6). |
| `reprise.dev.useFakes` | `false` | `true` only to demo the UI with in-memory fake data. Needs no token, runner or Bob. |

Then run, in order:

1. **File → Open Folder** on the same clone the runner uses (`--root`). The runner refuses to pair with a clone of a different repository.
2. **Reprise: Sign In to GitHub** — paste the token from section 3.
3. **Reprise: Link Repository** — normally detected from `.git/config`.
4. **Reprise: Connect Runner** — enter the pairing code. The message confirms whether IBM Bob is ready. **Reprise: Show Machine Capabilities** shows the same information later.
5. Right-click a report in **Bug Reports** and choose **Acknowledge Bug Report**.

---

## 3. GitHub token (fine-grained personal access token)

Create one at <https://github.com/settings/personal-access-tokens/new>. Limit it to the target repositories and set an expiry after the hackathon.

| Permission | Access | Used for |
| --- | --- | --- |
| Metadata | Read | Required by GitHub |
| Contents | Read and write | Records on `reprise-data`, fix branches (`reprise/fix-N`) |
| Issues | Read and write | Listing bug reports; comments only if `postResultsToGitHub` is on |
| Pull requests | Read and write | Draft fix PRs, marking them ready |
| Actions | Read and write | Dispatching CI runs and reading their artifacts |
| Workflows | Read and write | Only for **Reprise: Set Up CI Runs**, which adds `.github/workflows/reprise-run.yml` |

The token stays in the browser's secret storage. It is never sent to the runner or to IBM Bob.

---

## 4. Target repository

1. **`.reprise.yml`** at the repository root. The full reference is in [`docs/kit/02-specs/reprise-config.md`](kit/02-specs/reprise-config.md). The keys that matter most for Bob:
   - `edit_scope.test` — paths where Bob may propose the reproduction test, e.g. `["app/src/androidTest/**"]`.
   - `edit_scope.fix` — paths a proposed fix may change, e.g. `["app/src/main/**"]`.
   - `edit_scope.never` — always refused, e.g. `[".github/**", ".reprise.yml", ".reprise/**"]`.
   - `platforms.<p>.test.pattern`, `.single`, `.all` — Bob is told the pattern and the command Reprise will run.
   - `components` — optional names Bob chooses from during intake.
2. **Label** the bug reports with the label in `issues.labels` (default `bug`).
3. **Optional `.reprise/stubs/<issue>/`** — only needed for `reprise.provider: "stub"`.
4. **Optional CI runs** — run **Reprise: Set Up CI Runs** and merge the PR it opens. The repository must be public for free Actions minutes.

---

## 5. This repository on GitHub (team)

| Item | Where | Value |
| --- | --- | --- |
| Pages source | Settings → Pages | **GitHub Actions** |
| `dashboard/repos.json` | File in this repository | `["owner/app-one", "owner/app-two"]` — public repositories whose `reprise-data` records appear on the dashboard. When the list is empty, the dashboard shows sample data with a banner. |
| `REPRISE_BUILD_IDE` | Settings → Secrets and variables → Actions → **Variables** | `true` to build the rebranded Code-OSS web IDE at `/ide/` (gates G-1/G-5, a long build, not yet verified). Leave unset to publish only the extension, loadable in vscode.dev. |
| `VSCODE_TAG` | Same place, **Variables** | Pinned `microsoft/vscode` tag for that build, e.g. `1.104.0`. |
| Runner release | `git tag v0.1.0 && git push origin v0.1.0` | `release-runner.yml` publishes `reprise-runner.mjs` and its SHA-256. |

No repository secrets are needed. The workflows use the built-in `GITHUB_TOKEN`, and **`BOB_API_KEY` is never stored in GitHub**: Bob runs only on developers' machines.

---

## 6. Local development

```sh
# Extension
cd extensions/reprise
npm install
npm run gen:assets        # after editing docs/kit/03-runtime-prompts/* or templates/ci/*
npm test
npm run web -- /path/to/your/app-clone   # Chromium with the extension loaded, at http://localhost:3000

# Runner (in another terminal; localhost:3000 is allowed by default)
BOB_API_KEY=... node runner/reprise-runner.mjs --root /path/to/your/app-clone

# Dashboard
node dashboard/build.mjs --out _site --sample && npx http-server _site
```

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "IBM Bob runs through the Reprise Runner. Use Connect Runner first." | Pair the runner, or switch `reprise.provider` to `stub`. |
| `IBM Bob is not available on this runner: "bob" not found` | Install Bob Shell, or pass `--bob-bin /full/path/to/bob`. |
| `Bob Shell's license has not been accepted` (older runners: `A license agreement is required`) | Run `bob` once in a terminal and accept the license, or start the runner with `--bob-accept-license`. |
| `Bob failed: ... timed out` | Raise `REPRISE_BOB_TIMEOUT_SECONDS`, or narrow the report. |
| `did not finish: ... cost` | Raise `REPRISE_BOB_MAX_COST`. The cap applies to each stage call. |
| `output failed the stage schema after one repair` | Bob's answer was not valid JSON for the stage twice. Try again, or use **Choose Test File for Report** to supply the test yourself. |
| Pairing: `Forbidden: origin not in allow-list` | Add the origin from the runner console with `--allow-origin`. |
| Runner: `Test not approved` (409) | Approve the proposed test in the diff view. Reprise registers it with the runner after approval. |
