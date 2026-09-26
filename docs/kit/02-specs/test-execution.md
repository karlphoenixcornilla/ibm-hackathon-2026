# Test Execution Spec

Implements R-6, R-7, R-8, ADR-5, ADR-6, ADR-11. Diagram: `test-execution.mmd`. Gates: G-9 to G-14, G-23, G-24.

Nothing in this spec runs in the browser. Adapters run inside the Reprise Runner (`local-runner.md`) and inside the CI run loop; the browser only sends run requests and receives `RunResult`s.

## Result format (all executors and adapters)

```ts
type TestStatus = "passed" | "failed" | "error" | "skipped";
interface TestResult { id: string; status: TestStatus; message: string; output: string }   // id = "<file>::<full test name>"
interface RunResult {
  platform: Platform; executor: "local" | "ci"; method: "repo_command" | "driver";
  exit_code: number | null; timed_out: boolean; duration_ms: number;
  tests: TestResult[]; output_tail: string;       // last 200 lines, redacted
  host_os: string; device: string; ci_run_url: string | null;
  runner_version: string | null;                  // set by the Reprise Runner; null on CI
}
```

Trial outcomes (`PASS`, `FAIL_MATCH`, `FAIL_OTHER`, `ERROR`) are derived from a `RunResult` and the signature, exactly as `statistics.md` §1: the reproduction test's `TestResult` decides; a missing result, `error`, a timeout not declared by the signature, or a non-zero exit with no test results is `ERROR`.

## Adapters

| Platform | Host required (ADR-5) | Prerequisite checks | Repository command (from `.reprise.yml`) | Driver fallback (PD-8, PD-9) | Result parsing |
| --- | --- | --- | --- | --- | --- |
| `windows` | Windows | Commands in `prereq` present on PATH | `platforms.windows.test.single` / `.all` | Appium `windows` driver (host requirements: G-12) | JUnit XML at `report_path` (G-14), else adapter parser |
| `android` | Any host with Android SDK | `adb` on PATH; `adb devices` lists the configured device or a running emulator | `platforms.android.test.*` | Appium `uiautomator2` | same |
| `ios` | macOS with Xcode | `xcodebuild` on PATH; configured simulator or device available | `platforms.ios.test.*` | Appium `xcuitest` | same |
| `macos` | macOS with Xcode | `xcodebuild` on PATH (if configured) | `platforms.macos.test.*` | Appium `mac2` | same |
| `linux` | Linux | Commands in `prereq` present | `platforms.linux.test.*` | None unless G-13 passes | same |

Exact tools, SDK versions and commands come from `demo-apps.md` and `.reprise.yml`; the adapters do not hard-code any framework. "Host" means the machine running the Reprise Runner (or the CI runner), not the machine showing the browser tab; in practice they are the same machine (ADR-5).

### Choosing the method (R-8)

1. If `platforms.<p>.test.single` is set and the reproduction test is a file the repository's own test runner can execute (its path matches `platforms.<p>.test.pattern`), use the repository command.
2. Otherwise, if a driver fallback exists for the platform and `platforms.<p>.driver` is configured, run the test with the fallback runner.
3. Otherwise `BLOCKED_ENV`: "No way to run tests for <platform>: configure a test command or a driver."

Regression comparison (`fix-and-verify.md`) always uses `platforms.<p>.test.all` (repository command); if it is not set, verification reports "no suite configured" and cannot give `FIX_VERIFIED`.

## Local executor

- In the browser: a client that sends `POST /runs` to the paired Reprise Runner and turns its server-sent events into Runs-view progress and `RunResult`s. If no runner is paired, the local executor is unavailable and the pipeline offers "Connect Runner" or CI.
- In the runner, on the machine where the runner is started; attached devices and emulators count as local (R-7):
- Starts commands with the shell named in `platforms.<p>.shell` (`bash`, `zsh`, `pwsh`, `cmd`), working directory `platforms.<p>.cwd`, environment filtered as PD-15, timeout `platforms.<p>.run_timeout_seconds`, killing the whole process tree on timeout.
  - `{file}` in the single-test command is replaced with the test path, quoted for the shell.
  - Before each run, deletes the report file so a stale report is never read.
  - Streams redacted output to the tab, which shows it in an output channel "Reprise: <platform>".
- Runs on a base or head commit use runner worktrees (PD-24, `local-runner.md`).

## CI executor (PD-14)

Available when the repository is public (V-4) and `.github/workflows/reprise-run.yml` exists. Works from the browser without a runner, subject to gate G-24. "Reprise: Set Up CI Runs" commits that file and `.reprise/ci/run-loop.mjs` from the templates below to a branch through the Git Data API and opens a PR for the user to merge.

Run procedure:

1. Create branch `reprise/run-<id>` through the Git Data API, containing the test file read from the opened folder (if not already in the repository) on top of the ref under test.
2. Dispatch `reprise-run.yml` with inputs `platform`, `ref`, `mode` (`single` or `all`), `test_path`, `runs`.
3. Poll the run every 15 seconds; show progress in the Runs view.
4. Download artifact `reprise-results` in the browser and unpack it (a bundled zip reader); parse `run-XX/` folders into `RunResult`s. If gate G-24 fails, the paired runner downloads it (`POST /artifacts`), and without a runner CI results are reported as unavailable.
5. Delete branch `reprise/run-<id>` after results are recorded.

Template (runner labels and setup steps per platform are **placeholders** the team fills from `demo-apps.md`; gates G-9 to G-11 decide which platforms can run on CI at all):

```yaml
name: reprise-run
on:
  workflow_dispatch:
    inputs:
      platform: { required: true, type: choice, options: [windows, android, ios, macos, linux] }
      ref:       { required: true, type: string }
      mode:      { required: true, type: choice, options: [single, all] }
      test_path: { required: false, type: string, default: "" }
      runs:      { required: true, type: number, default: 1 }
permissions:
  contents: read
jobs:
  run:
    runs-on: ${{ fromJSON('{"windows":"windows-latest","android":"ubuntu-latest","ios":"macos-latest","macos":"macos-latest","linux":"ubuntu-latest"}')[inputs.platform] }}
    timeout-minutes: 120
    steps:
      - uses: actions/checkout@v4          # version: gate G-18
        with: { ref: "${{ inputs.ref }}", persist-credentials: false }
      # PLATFORM SETUP: one conditional step block per platform, filled from demo-apps.md
      # (toolchain install, build, emulator or simulator start). Android emulator: gate G-10. iOS: gate G-11.
      - name: Run
        shell: bash
        run: node .reprise/ci/run-loop.mjs   # reads .reprise.yml and the inputs, runs N times, writes results/run-XX/
      - uses: actions/upload-artifact@v4   # version: gate G-18
        with: { name: reprise-results, path: results/, retention-days: 1 }
```

`.reprise/ci/run-loop.mjs` is written by "Set Up CI Runs" as well: it reads `.reprise.yml`, runs the configured command `runs` times, and for each run writes `junit.xml` (copied from `report_path`), `output.txt` (last 200 lines) and `exit_code`. It has no dependencies beyond Node.js. It shares its adapter and parser code with the Reprise Runner (bundled into both).

## Driver fallback runner (PD-8, ADR-6)

- Runs inside the Reprise Runner (or the CI run loop). Starts a local Appium 2 server with the platform's driver (installed with `appium driver install <name>`, V-3) if not already running on the configured port.
- A fallback test is a JavaScript module exporting `async function test(driver, assert)`; the runner creates a WebdriverIO session with `platforms.<p>.driver.capabilities`, calls the function, and records `passed` if it resolves or `failed` with the error message if it throws. Session creation failures are `error`.
- Emits a `RunResult` with one `TestResult` whose id is `<file>::test`.

## Capability report

"Reprise: Show Machine Capabilities" asks the paired runner for every adapter's prerequisite checks and shows, per platform: local possible (yes/no and why, or "no runner connected"), CI configured (yes/no), driver fallback available (yes/no).
