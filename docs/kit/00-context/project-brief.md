# Project Brief — Reprise IDE

## Problem

About 17% of submitted bug reports can't be reproduced (V-8), and developers lose hours finding that out. Even real bugs then need a cause, a fix, and proof that the fix works and broke nothing, all done by hand, and on native apps across several platforms the reproduction effort multiplies.

## Product

Reprise IDE is a fork of VS Code (R-2) that runs in the browser (R-16) and in which bug reports are a first-class part of the editor. The user opens it at a URL in Chrome or Edge and opens their local repository folder through the File System Access API. Tests on the user's own machine run through the Reprise Runner, a small program the user starts on that machine (PD-17).

1. **Open and connect.** Open the IDE URL, open the local repository folder, sign in to GitHub and link the folder to its GitHub repository (R-3). Start and pair the Reprise Runner to run tests on this machine.
2. **See reports.** A Bug Reports view lists the repository's open bug reports.
3. **Acknowledge.** The user acknowledges a report; this starts replication (R-4).
4. **Recognise.** The report is structured into a fingerprint and checked against earlier reports by what they describe (duplicate detection, R-12).
5. **Provide or validate a failing test** (R-1). The AI provider supplies a reproduction test, or the user points Reprise at their own test. Either way Reprise checks that the test fails for the reported reason.
6. **Run it where the bug lives** (R-6, R-7, R-8). Reprise picks the platform and an executor (this machine or a connected device or emulator, through the Reprise Runner, or a GitHub-hosted CI runner), runs the repository's own test command, and falls back to a built-in platform driver when needed. It runs the test repeatedly (10 to 20 times by default, adjustable, PD-25) and reports: reproduced, reproduced sometimes (with a rate and interval), duplicate, or blocked with one question (concept paper).
7. **Help fix** (R-12). After the user accepts the diagnosis, the provider proposes several candidate fixes; each is quick-checked in isolation, failing ones are dropped, and the best is shown as a diff to accept, edit or reject. The IDE branches off the current branch and opens a draft PR with a live checklist.
8. **Verify and review** (R-12). A self-review pass checks the diff after verification; the user marks the PR ready. Reprise reruns the reproduction test enough times to rule the bug out statistically and compares the full suite against the base branch on the same platform; newly broken tests block the fix.
9. **Share.** Records go to a public dashboard on GitHub Pages (R-12, R-14).

AI is stubbed (R-5): the stub returns responses prepared by the team per demo bug, and every stubbed output is labelled as such.

## Users

Developer or maintainer using the IDE in Chrome or Edge; bug reporter on GitHub; judge or visitor using the dashboard or opening the IDE URL.

## Demo success criteria (R-10)

For each of the five platforms, using the team's apps (`demo-apps.md`): acknowledge a real report, get a verdict from real test runs on the platform, and for at least one platform show the fix and verification flow including a caught regression. Show one duplicate. Show the dashboard with all of it.

## Non-goals for the hackathon

Real AI providers (interfaces only), Firefox, Safari and mobile browsers (R-16), desktop installers of the IDE (PD-20), paid code signing, app store distribution, auto-merging, private-repository CI runs.
