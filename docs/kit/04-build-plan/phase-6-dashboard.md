# Phase 6 — Dashboard on GitHub Pages

**Serves:** R-12, R-14 (Application URL). **Specs:** `dashboard.md`, `data-contracts.md` (dashboard index), `security.md` (T8). **Gates:** G-16, G-18.

## Task prompt

```
Build reprise-ide/dashboard/ as docs/kit/02-specs/dashboard.md specifies, and add its build to .github/workflows/pages.yml (which phase 9 also uses to publish the web IDE at /ide/; the dashboard goes at /). The workflow runs on workflow_dispatch and on a schedule, clones the public reprise-data branch of each repository in dashboard/repos.json without credentials, validates every record against the extension's issue-record schema, generates data/index.json, copies records to data/<owner>/<repo>/issues/<N>.json, and deploys with the official Pages actions (versions per gate G-18). Invalid records are skipped and listed in the job summary, never deployed.
Add a script that generates sample records with the real stats functions covering every state, for local preview only; when the site is built from it, data_source is "sample" and the banner shows. The deployed site uses live records only.
Follow every motion rule and the quality floor. Complete a UI review in docs/kit/05-quality/ui-review.md.
```

## Acceptance

Live dashboard lists every published demo record across repositories with platform and run location; the Open IDE link reaches /ide/; works logged out and in any modern browser; no console errors or CSP violations; UI review complete.
