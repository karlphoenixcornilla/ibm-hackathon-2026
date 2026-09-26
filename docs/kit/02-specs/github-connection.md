# GitHub Connection Spec

Implements R-3, R-4, ADR-3. Decisions: PD-19, PD-23. Gates: G-7, G-17, G-19, G-22, G-27.

All GitHub calls are `fetch` requests from the web extension to `https://api.github.com`. There is no git binary in the browser.

## Sign-in (ADR-3)

1. If gate G-7 passed: `vscode.authentication.getSession('github', scopes, { createIfNone: true })`.
2. Otherwise (the default, PD-23): "Reprise: Sign In to GitHub" explains which fine-grained token to create (repositories: only the target repositories; permissions from G-17), links to GitHub's token page, and accepts the token in a password input box. The IDE checks it with `GET /user` and one call per permission.
3. Device flow only if gate G-22 passed.

Tokens are kept only in the workbench's secret storage. They are never sent to the runner, to providers, to test processes, or to any origin other than `api.github.com` (and the artifact exception in `local-runner.md`, only if the team accepts it). Permissions: fill in from gate G-17 here: **(fill in)**.

## Linking a repository

When a folder is opened, read `.git/config` through the opened folder (gate G-27) and take the `origin` remote URL. If it is a `github.com` URL, propose linking it; the user confirms. The linked `owner/repo` is stored in workspace state. A folder without a readable GitHub remote shows "Link this folder to a GitHub repository" with a manual `owner/repo` input.

`HEAD` is read from `.git/HEAD` (following `ref:` to `refs/heads/…` or `packed-refs`) and used as the base SHA for fixes and as the check against the runner's `HEAD`.

## Reading reports

- Open issues filtered by the labels in `.reprise.yml` `issues.labels` (default `["bug"]`, PD-5), excluding pull requests.
- For each issue: body, author, labels, created date; comments are loaded when the issue is acknowledged.
- Text attachments linked in the body (`.log`, `.txt`, `.json`, `.md`), at most 3, 200 KB each, are downloaded when acknowledged, if their host allows CORS; otherwise they are listed by name with "Could not load in the browser". Image attachments are listed by name; whether a provider can read images is a provider capability flag (`ai-providers.md`).

## Acknowledging (R-4)

Acknowledge starts replication (`replication-pipeline.md`). It writes the event `acknowledged` with the GitHub login of the user to the record. It does not post to GitHub unless `reprise.postResultsToGitHub` is on (PD-6). When that setting is on, the IDE posts or updates one comment per issue, marked `<!-- reprise:status -->`, after each verdict, and one per PR, marked `<!-- reprise:verify -->`, after each verification.

## Committing without git (PD-19)

A commit is made from file contents the IDE holds (read from the opened folder, or generated, such as records):

1. `POST /repos/{o}/{r}/git/blobs` for each changed file (base64).
2. `POST /repos/{o}/{r}/git/trees` with `base_tree` = the parent commit's tree.
3. `POST /repos/{o}/{r}/git/commits` with the parent SHA.
4. `POST /repos/{o}/{r}/git/refs` to create the branch, or `PATCH …/git/refs/heads/<branch>` (no force) to move it.

A `422` on the ref update means someone else moved the branch: re-read the ref, rebuild the tree on the new parent, retry up to 3 times, then show the error. The local folder's git state is never changed; the notification after a push says "Committed to <branch> on GitHub. Your local checkout was not changed."

## Writes Reprise performs

| Action | When | API |
| --- | --- | --- |
| Create branch `reprise/repro-N` with the reproduction test | After a verdict with a provided test | Git Data API (above) |
| Create branch `reprise/fix-N` | After the user applies a fix | same, base = linked `HEAD` |
| Open pull request | User clicks Open pull request | REST pulls endpoint |
| Commit `issues/N.json` to `reprise-data` | After each stage result and on Publish Record | Git Data API; creates the orphan branch on first use |
| Create `reprise/run-ID` branch and dispatch `reprise-run.yml` | CI executor | Git Data API + REST workflow dispatch |
| Download run artifact | CI executor | REST artifacts endpoint (gate G-24) |
| Comment | Only if the setting is on | REST issues comments endpoint |
| Delete `reprise/run-ID` | After CI results are recorded | REST refs endpoint |

Every write shows a notification naming what was written and where, with a link.

## Rate limits and errors

Show GitHub API errors verbatim (after redaction) with the endpoint name. On rate limiting, show the reset time and stop polling until then. CORS or network failures are shown as "The browser blocked a request to <host>" with the gate ID that covers it.
