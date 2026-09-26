# Slides Outline (draft)

1. Reprise IDE — bug reports to proof, inside a browser editor.
2. Problem — non-reproducible reports (V-8); the multi-platform cost.
3. The IDE — Code - OSS fork running in Chrome or Edge, your local folder opened through the File System Access API, GitHub connection, Bug Reports view.
4. Acknowledge → replicate — provide or validate a failing test; the four answers.
5. Five platforms — the Reprise Runner on each machine, adapter table: host, repository command, driver fallback, runner or CI.
6. Fix and verify — diff review, repeat runs, regression classes.
7. Architecture — `system-context.mmd`, `ide-components.mmd`, `runner-pairing.mmd`, `deployment.mmd`; what runs in the browser and what cannot.
8. AI providers — stub today (labelled), interface for IBM Bob, Claude, Gemini, Groq. State plainly what ran.
9. Results — real observed outcomes per platform.
10. Zero cost and how to try it — dashboard, IDE URL (Chrome or Edge), runner download, build from source.
