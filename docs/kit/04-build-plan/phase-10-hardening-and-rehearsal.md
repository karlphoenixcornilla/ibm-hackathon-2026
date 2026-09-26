# Phase 10 — Hardening and rehearsal

**Serves:** all. **Specs:** `05-quality/test-strategy.md`, `05-quality/definition-of-done.md`, `02-specs/security.md`.

## Task prompt

```
Add the security and failure cases in test-strategy.md as automated tests using stub fixtures. Review every path where text from issues, providers, test output or GitHub reaches a webview, record, git ref, commit message or GitHub comment, and make sure it passes redaction and uses textContent. Review the runner's HTTP surface against security.md T11 to T16 and the IDE page's CSP against browser-runtime.md. Resolve gate G-28 and add the blocking policies to the runbook. List every change you made.
```

## Rehearsal (people)

Run the full demo from a clean state on all four machines, from the deployed /ide/ URL in Chrome on at least two machines and Edge on at least one, fill the Demo outcomes table in `definition-of-done.md`, and record the rehearsal as a backup video.
