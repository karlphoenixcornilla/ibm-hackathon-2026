# T5 — Public Dashboard, Web Deployment and Runner Release

**Branch:** `track/t5-web` from `base-v1`. **Kit phases:** 6 and 9 (R-12, R-14, R-16).
**Kit inputs:** `04-build-plan/phase-6-dashboard.md`, `phase-9-web-deploy-and-runner-release.md`, `02-specs/dashboard.md`, `data-contracts.md` (dashboard index), `06-deployment/{deployment,runbook,cost-ledger}.md`, `05-quality/ui-review.md`, `01-architecture/diagrams/deployment.mmd`, gates G-5, G-6, G-8, G-16.

**Owns:** `dashboard/**`, `.github/workflows/pages.yml`, `.github/workflows/release-runner.yml`, branding assets (icons and logo referenced by `product.json`), `06-deployment/*` updates.
**Must not touch:** `extensions/`, `runner/src/` (call T2's `runner/build.mjs`; don't edit it), and `ci.yml` (base).

**Do the deploy part first.** The kit says the IDE should be on Pages right after phase 1, so every other track tests against the same URL the judges will use.

## Tasks
1. **G-5 and G-6:** find the minified web build task, its size and its build time on a hosted runner. Check whether Pages can serve it without custom headers. If G-6 fails, implement the recorded fallback (for example a service worker that sets the headers) and record the cost in the ledger.
2. **pages.yml** (scheduled + manual):
   - build the web IDE into `/ide/`
   - build the dashboard into `/`
   - aggregate the `reprise-data` branches of the repos in `dashboard/repos.json` into the dashboard index (schema from `contracts/`)
   - deploy with the Pages actions at the G-18 major versions
3. **release-runner.yml** (on `v*` tags): run `node runner/build.mjs`, then publish `reprise-runner.mjs` and its SHA-256 to Releases (G-8).
4. **dashboard/**: a static site per `dashboard.md`:
   - the design plan, display names and trial-strip component
   - motion rules (respecting reduced motion), empty and error states, and the "How it works" page
   - IBM Plex fonts if G-16 confirms OFL, otherwise the system font stack
   - validate the index against the schema at load time

   Develop against fixture records (`dashboard/fixtures/`) generated from the example in `data-contracts.md`, so no real data is needed.
5. Run the checklist in `05-quality/ui-review.md` for the dashboard and the IDE branding.
6. Update `06-deployment/runbook.md` with the deploy, rollback and runner release steps. Write the "build from source" instructions (R-14).

## Acceptance
- `https://OWNER.github.io/reprise-ide/ide/` opens Reprise IDE in Chrome and Edge. Early deploys contain only the base extension, and it redeploys as tracks merge.
- `https://OWNER.github.io/reprise-ide/` shows the dashboard from fixtures, and from real records once T1 and T3 write them.
- Tagging `v0.1.0` publishes the runner file and its checksum to Releases.
- The cost ledger shows zero cost. The G-5, G-6, G-8 and G-16 results are recorded.

## Stop conditions
- The build exceeds the Pages 1 GB limit or the 6-hour job limit (G-5) → use the fallback (build locally and push the output) and ask.
- Any hosting cost appears → stop (R-13, zero cost).
