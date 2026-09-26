# Phase 2 — GitHub connection, Bug Reports, Reprise panel

**Serves:** R-3, R-4, R-16. **Specs:** `github-connection.md`, `ide-ux.md`, `browser-runtime.md`, `security.md`, `dashboard.md` (tokens and motion, for webviews). **Gates:** G-7, G-17, G-22, G-25, G-27.

## Task prompt

```
Implement in extensions/reprise (web extension, no Node APIs), following the specs exactly:
1. auth/: sign-in per github-connection.md: built-in provider only if gate G-7 passes, otherwise the fine-grained token prompt (PD-23); try the device flow from the browser and record gate G-22. Workbench secret storage only. Record the required token permissions (G-17) in the spec.
2. workspace/: reads and writes through workspace.fs on the opened folder; SHA-256 with crypto.subtle; read .git/config and .git/HEAD (gate G-27).
3. github/: repository linking from the origin remote with confirmation; issue listing by configured labels; attachments on demand with the CORS fallback message; the Git Data API commit helper (blobs, tree, commit, ref, 422 retry) from github-connection.md; a typed client with errors redacted.
4. views/: first-run checklist; Bug Reports tree with state badges and the inline actions from ide-ux.md; Runs tree (empty for now); the Reprise panel webview with all sections rendered from an issue record (use a fixture record), CSP and textContent-only rendering per security.md, design tokens and motion rules per dashboard.md; status bar items; beforeunload guard.
5. Acknowledge action: for now, creates an issue record in state REPLICATING with the "acknowledged" event and opens the panel. The pipeline is phase 4.
6. .reprise.yml loading from the opened folder and validation per 02-specs/reprise-config.md, with a clear BLOCKED_ENV message when missing or invalid.
Tests: config validation, record rendering (no unreplaced placeholders), redaction, trust of link targets, Git Data API helper against a mocked fetch (including the 422 retry), .git/HEAD parsing (symbolic ref, packed-refs, detached).
```

## Acceptance

In Chrome and Edge: open a demo app folder, sign in, link its repository, see its bug reports, acknowledge one, and see its panel; commit a test file to a scratch branch through the Git Data API; missing `.reprise.yml` produces the specified message; UI review rows logged in `05-quality/ui-review.md`.
