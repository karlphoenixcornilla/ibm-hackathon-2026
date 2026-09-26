# Fix Assistance and Verification Spec

Implements R-12 (fix assistance, fix verification with regression check). Decisions: PD-26 to PD-29. Diagrams: `fix-verify-sequence.mmd`, `regression-classification.mmd`. Statistics: `statistics.md`.

v3 changes the fix flow from "one proposal, retry" to candidates filtered by tests, an early draft PR with a live checklist, a self-review pass, and review-comment rounds. The model comes from existing tools: several candidate patches filtered by reproduction and regression tests (Agentless), stage checkpoints (Sentry Seer), an early draft PR with a checklist steered by PR comments (GitHub Copilot coding agent), a separate reviewer pass (CodeRabbit), and capped loops that skip repeated attempts (a known failure of SWE-agent-style loops).

## Flow

| Step | What happens | Human checkpoint |
| --- | --- | --- |
| 1. Bug details | Intake and duplicate check (`replication-pipeline.md` §1–2); stops with one question if `attempt_possible` is false | — |
| 2. Replication | Reproduction test and adaptive trials (`statistics.md` §2a) | Approve a provided test (PD-10) |
| 3. Root cause | Diagnosis narrowed files → functions → lines, with evidence | **Accept diagnosis** (`replication-pipeline.md` §7) |
| 4. Candidates | N candidate fixes, each quick-checked in isolation, filtered and ranked | Approve the candidate batch when it runs locally (PD-27) |
| 5. Branch and draft PR | Winner written to the folder and committed to `reprise/fix-N`; draft PR with checklist | **Apply** the winner (PD-10) |
| 6. Verification | Required repeat runs and regression comparison; checklist ticked | — |
| 7. Self-review | Provider stage `review` plus the repository's linters, if configured | — |
| 8. Ready | User marks the PR ready; review comments can start a new round | **Mark ready for review** |

## 4. Candidates (PD-26, PD-27)

Available in states `CONFIRMED` and `FLAKY` after the diagnosis is accepted, and in `FIX_ABANDONED`, `FIX_INCOMPLETE`, `REGRESSION_DETECTED`.

1. **Generate.** Call provider stage `fix` `fix.candidates` times (default 3) with the accepted diagnosis, the reproduction test and its failing output, `vars.candidate` = 1..N, and, from the second round on, the previous round's results. Candidates are generated independently of each other.
2. **Scope.** Each candidate's files are checked against `edit_scope.fix` minus `edit_scope.never`; out-of-scope files are dropped and listed. A candidate that changes the reproduction test loses that file. A candidate left with no files is `error`.
3. **Duplicates.** Each candidate's diff is normalised (line endings, trailing whitespace, blank lines) and hashed (`diff_hash`). A hash already seen in this issue, in this round or an earlier one, is `rejected_duplicate` and not run. This stops loops of near-identical attempts.
4. **Where candidates run** (`fix.candidate_executor`, PD-27):
   - `ci` (default under `auto` when CI is configured): each candidate is committed to `reprise/try-N-<round>-<k>` through the Git Data API and run on a GitHub-hosted runner. No local approval needed; branches are deleted afterwards.
   - `local`: the panel lists all candidates with a diff link for each and one **Approve and run candidates** button. The runner applies each candidate in its own worktree of the base (`local-runner.md`, overlays), never in the opened folder.
5. **Quick check** per candidate on the report's platform: the reproduction test `min(fix.quick_runs, required_runs)` times and `test.all` once; base suite results come from a cached base run per base SHA.
6. **Filter.** Any `FAIL_MATCH` or invalid run → `rejected_repro`. Any blocking regression class (`ADDED_FAILING`, `REMOVED`, `REGRESSION`, after the reruns in `regression-classification.mmd`) → `rejected_regression`. The rest are `survived`.
7. **Rank survivors**, in order: fewer non-blocking regression notes; more candidates sharing the same `diff_hash` (a vote); fewer changed lines. The top one is marked `selected`; the panel shows every candidate with its status and lets the user pick another survivor instead.
8. **No survivors.** Start another round with the failures as feedback, up to `fix.max_rounds` (default 3). After the last round → `FIX_ABANDONED`, listing every candidate and why it was rejected.

With the stub provider, candidates are the prepared `fix`, `fix-2`, … fixtures (`ai-providers.md`). Preparing one deliberately wrong candidate per demo bug shows the filter working.

## 5. Branch and draft PR (PD-28)

1. The IDE opens a diff view per file of the selected candidate against the opened folder: **Apply**, edit, or **Reject**. Apply writes through `workspace.fs` (PD-10); the local git branch is not changed (PD-19). Reject returns to the candidate list.
2. The IDE commits the applied files and the reproduction test to `reprise/fix-N` on top of the linked `HEAD` (the user's current branch) through the Git Data API, and opens a **draft** PR (`draft: true` when `fix.draft_pr` is on) titled `Fix #N: <summary>`.
3. The PR body has the summary, diagnosis, changed files, risk notes, "Fixes #N", "Proposed by provider <id> (stub response)" when stubbed, a candidates table (status per candidate), and a **checklist** the IDE updates as steps finish:
   ```
   - [x] Reproduced: 20 of 20 runs failed
   - [x] Candidate 2 of 3 selected (1 rejected: still reproduces; 1 rejected: breaks tests)
   - [ ] Verified: 0 failures in 3 required runs
   - [ ] No regressions against base
   - [ ] Self-review: no high-severity findings
   ```
4. A developer can instead fix the bug by hand and open their own PR with "Fixes #N"; verification works the same, without the candidates table.

## 6. Verification

Started automatically after step 5, or by **Verify fix** in the Reprise panel, or by "Reprise: Verify Fix" with a PR number (PD-16). Linked issues are parsed from the PR body with `\b(close[sd]?|fix(e[sd])?|resolve[sd]?)\s+#(\d+)\b` (case-insensitive). Runs on the same platform the bug was replicated on, with the executor the user picks. Local verification runs base and head in runner worktrees (PD-24), so it does not depend on what the opened folder has on disk.

1. **Reproduction test check.** If the PR contains the reproduction test, its SHA-256 must equal the record's, otherwise `FIX_INCOMPLETE` ("the reproduction test was modified"). If absent, it is added to the head workspace for the run only. Run it `required_runs` times (`statistics.md` §5). Any `FAIL_MATCH` or invalid run → not fixed.
2. **Regression comparison.** `test.all` once on base and head; per-test classification and reruns exactly as `regression-classification.mmd` (3 extra runs each side for pass-to-fail tests). `ADDED_FAILING`, `REMOVED`, `REGRESSION` block.
3. **Verdict.** Any blocking class → `REGRESSION_DETECTED`; else reproduction not fixed → `FIX_INCOMPLETE`; else `FIX_VERIFIED` with evidence `strong` or `limited` and the claim sentence from `statistics.md` §6.
4. **Output.** Panel section and PR checklist updated; record written with the fix round (`source` `provider` or `human`), its candidates and the run context; PR comment only if enabled (PD-6).

## 7. Self-review (PD-29)

After `FIX_VERIFIED`, if `fix.self_review` is on: provider stage `review` reads the PR diff, the diagnosis and the verification results, and returns findings. If `.reprise.yml` names a lint command for the platform (`platforms.<p>.lint`, optional), the runner or CI runs it on head and its output is attached. High-severity findings are shown in the panel with **Start a new round** (back to step 4 with the findings as feedback) or **Keep and list in PR**. The finding count goes into the checklist. Stub: `review.json` or skipped with a label.

## 8. Ready and review comments

- **Mark ready for review** in the panel converts the draft (GitHub GraphQL `markPullRequestReadyForReview`; the REST API cannot do this). Enabled only after step 6 gives `FIX_VERIFIED`; before that the button reads "Verify first".
- **Address review comments** reads the PR's review comments (REST), shows them, and starts a new candidate round with them as feedback. The selected candidate is committed on top of `reprise/fix-N` (moving the ref, no force), and verification runs again.

When the PR is merged (detected on refresh), the record moves to `RESOLVED`, or `RESOLVED` with the note "merged without passing verification" if the last verification of that head was not `FIX_VERIFIED`.

## Cost of candidates

Each round costs up to `candidates × (quick_runs + 1 suite run)` runs plus one cached base suite. With the defaults and a 1-minute test, that is about 18 minutes of runs per round. For slow device tests, lower `fix.candidates` or `fix.quick_runs` per repository, or use CI to run candidates in parallel (V-4: up to 20 concurrent jobs, 5 on macOS).
