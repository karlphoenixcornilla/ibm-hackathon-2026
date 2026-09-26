# 99 — Integration and Hardening (after T1–T5 merge)

**Kit phases:** 10 (then 11, submission, handled by the team).
**Kit inputs:** `04-build-plan/phase-10-hardening-and-rehearsal.md`, `05-quality/{definition-of-done,test-strategy}.md`, `06-deployment/runbook.md`, gate G-28.

**Owns:** `extensions/reprise/src/extension.ts`, `src/wiring/**`, `test/e2e/**`. Anything else only as a bug fix, coordinated with that module's owning track.

## Tasks
1. Set `reprise.dev.useFakes` to false by default, and confirm `wiring/buildServices` returns every real implementation. Delete the fakes only if no tests use them.
2. End-to-end run per platform, following the video script (`07-submission/video-script.md`):
   - open the folder and pair the runner
   - acknowledge a real issue: verdict, diagnosis, record, dashboard
   - fix: candidates, approve, draft PR, verification verdict
   - run once on CI for each platform where the CI gates passed
3. Cross-track contract drift check: validate every record on each `reprise-data` branch against the schemas.
4. Security pass against `02-specs/security.md`:
   - the token never reaches the runner or providers (grep for it plus a network-log check)
   - redaction everywhere
   - CSP on webviews
   - runner LAN and Origin tests
5. G-28 policies are recorded in the runbook. Rehearse the demo twice on the deployed URL.
6. Walk through the definition-of-done checklist. Record anything cut, in the kit's order (8, then 7, then 5 beyond the first platform), with the team's agreement.

## Acceptance
The kit's `05-quality/definition-of-done.md` is fully checked. The demo has been rehearsed on the Pages URL with all five platforms.
