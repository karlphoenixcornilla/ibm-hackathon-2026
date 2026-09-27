# Glossary

| Term | Meaning |
| --- | --- |
| Reprise IDE | The web build of the Code - OSS fork (R-2, R-16), opened in a Chromium-based desktop browser. |
| Supported browser | Any Chromium-based desktop browser that exposes the File System Access API in a secure context, such as Chrome, Edge, Brave, Opera, Vivaldi or Arc (PD-22). The startup capability check decides, not the browser's name. |
| File System Access API | The browser API that lets the IDE read and write the local folder the user picks (R-16). |
| Opened folder | The local repository folder the user granted the IDE access to. |
| Reprise Runner | The Node.js program on the user's machine that runs local tests for a paired IDE tab (PD-17, `local-runner.md`). |
| Pairing | The one-time code exchange that lets one IDE tab use one runner (`runner-pairing.mmd`). |
| Reprise extension | The built-in web extension that implements all Reprise features (PD-1). |
| Target repository | The user's repository whose bug reports Reprise works on. |
| Acknowledge | The user action that starts replication of a report (R-4). |
| Provider | The AI back end behind the provider interface: `stub` now; `claude`, `bob`, `gemini`, `groq` and others later (R-5). |
| Stub fixture | A prepared response for one stage and one issue, read by the stub provider (PD-11). |
| Provided test | A reproduction test supplied by the provider. |
| Validated test | A reproduction test supplied by the user that Reprise checks. |
| Platform | One of `windows`, `android`, `ios`, `macos`, `linux` (R-6). |
| Executor | Where a test runs: `local` (through the Reprise Runner on this machine, including attached devices and emulators) or `ci` (GitHub-hosted runner) (R-7). |
| Adapter | Per-platform code in the runner (local) and in the CI run loop that checks prerequisites, runs the repository command or the driver fallback, and parses results (R-8). |
| Driver fallback | Running a test through an Appium 2 driver when the repository command cannot run it (R-8, V-3). |
| Signature | Pattern identifying a failure caused by the reported bug; other failures do not count. |
| Trial | One run of the reproduction test. |
| Trial policy | `min`, `max`, `limit` and optional time budget that decide how many trials run (PD-25). |
| Candidate | One proposed fix in a round, quick-checked in isolation before one is selected (PD-26). |
| Round | One set of candidates; up to `fix.max_rounds`. |
| Verdict | `CONFIRMED`, `FLAKY`, `DUPLICATE`, `NEEDS_INFO`, `BLOCKED_ENV`. |
| Issue record | JSON for one report on the target repository's `reprise-data` branch (PD-12). |
