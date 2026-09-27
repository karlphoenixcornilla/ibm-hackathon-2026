# Pairing with the local runner — UX spec for the Review UI (#33)

Implemented against `server/src/api/runner-bridge.ts` (#31). The browser, not the backend, talks to the user's Reprise Runner on `127.0.0.1:47410–47419`. The backend's runs reach the runner only through the page, via `RunnerBridge.attach`.

## States

### 1. Not connected

Show a panel **"Connect your local runner"**:

- The start command, with this site's origin filled in and a copy button:
  `node reprise-runner.mjs --root <path to your clone> --allow-origin https://<this site>`
- A 6-digit **pairing code** field (numeric, `autocomplete="one-time-code"`) and a **Connect** button.
- Helper text: *"The runner prints the code in its terminal. Codes expire after 5 minutes."*

Acknowledge and **Test fix locally** are disabled, with the tooltip "Connect your local runner first".

### 2. Connecting

Call `bridge.pair(code)`, which probes ports 47410→47419. Show a spinner on the button and disable the field. Pairing usually takes well under a second.

Map errors to inline messages under the field:

| `RunnerError.code` | Message | Action |
| --- | --- | --- |
| `not_found` | "No runner found on ports 47410–47419." Also show the start command again, including `--allow-origin`. | Keep the code. Allow retry. |
| `wrong_code` | "That code didn't match. Use the code in the runner's terminal (it changes every 5 minutes)." | Clear the field and focus it. |
| `locked` | "Too many wrong codes. Restart the runner to get a new code." | Disable Connect until the page reloads or the code changes. |

`not_found` also covers a runner that doesn't allow this site. Browsers block that response as a CORS failure, and the page can't tell it apart from a closed port. That's why the message repeats the `--allow-origin` part of the command.

### 3. Connected

Show a compact status chip in the header, with **Disconnect** (`bridge.disconnect()`), built from `bridge.connection`:

- repository: `remote` shown as `owner/repo`
- `HEAD` as a short sha
- `host_os`
- platforms: each `platforms[].platform`, greyed out with a `missing` tooltip when `local_possible` is false

**Same-repo check.** When the reviewed repository changes, check `bridge.sameRepo(owner, repo)`. If it is false, show a blocking banner on the issue page: *"Your runner is serving `<remote>`, not `<owner/repo>`. Restart it with `--root` pointing at your clone of `<owner/repo>`."* Acknowledge and Test stay disabled. The backend enforces the same rule and would fail the run anyway.

Refresh with `bridge.status()` when the tab regains focus, so a new commit (a new HEAD) shows up.

### 4. During a run (acknowledge, test fix locally)

1. Start the run (`api.acknowledge(...)` / `api.check(...)`), then **immediately** call `bridge.attach(api, runId, { onEvent, onOutput })`. The backend waits up to 10 s for the page to attach, then fails the run with "Open the Review UI and connect your local runner, then try again."
2. `onEvent`: render `core` status events as a step list ("Applying the fix on your runner", "Running the reproduction test ×3 with the fix", …).
3. `onOutput`: stream runner output lines into a collapsible log.
4. `attach` resolves with the final `RunStatus`. For `check`, render `status.check`:
   - `FIX_VERIFIED`: green. "Reproduction test passes 3/3 with the fix; no regressions in N tests."
   - `FIX_INCOMPLETE`: amber. "The reproduction test still fails (k/n)."
   - `REGRESSION_DETECTED`: red. List `regression.blocking`.
   - `repro.fixed` / `failed` / `runs`, the files changed (`files[]`), and the short `base_sha` it ran on.
5. If the run failed with *"…no longer staged…"*, show **Acknowledge again** in place of Test (the server restarted or slept).

Keep only one run attached at a time. The runner executes one run at a time.

### 5. Showing code

Use `bridge.readFile(path)` (the local clone at its HEAD) to render `Proposal.locations`. Use the same source when showing the fix diff in context. Only git-tracked files are served, so untracked files such as `.env` never are.

## Session and reloads

The runner session token lives in memory only, inside `RunnerBridge`. After a reload the user pairs again. The first attempt prints a fresh code in the runner's terminal: the old one was used up. The UI should say *"Enter the new code from the runner's terminal"* after the first `wrong_code` in a session that had paired before. Don't store the token in `localStorage` or `sessionStorage`.
