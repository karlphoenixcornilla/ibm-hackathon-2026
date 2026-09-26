# Dashboard Spec

Static site in `reprise-ide/dashboard/`, built by `.github/workflows/pages.yml` (scheduled, manual and on pushes to `reprise/main`) and deployed to GitHub Pages at `/`, next to the web IDE at `/ide/` (ADR-8, PD-4, PD-13). The dashboard itself works in every modern browser; only the IDE needs Chrome or Edge (R-16). The build reads the public `reprise-data` branches of the repositories in `dashboard/repos.json`, validates every record, and generates `data/index.json` (`data-contracts.md`). No framework: vanilla ES modules, one CSS file, self-hosted fonts (gate G-16). The same design tokens and motion rules apply to the IDE's webviews (`ide-ux.md`).

## Changes from v1

- Every report shows its **platform** and **where it ran** (this machine or CI, plus device), and the report list can be filtered by platform and repository.
- Every report produced with the stub provider shows "Stub response" next to provided tests, diagnoses and fixes.
- When `data_source` is `sample`, a banner on every route reads: "Sample data. These reports illustrate how Reprise works; they were not produced by a live run."
- Bobcoin columns are replaced by provider and call counts.

## Audience and job

Judges, maintainers and developers opening a public link. The page has one job: show, for each bug report, what Reprise proved and how, in under ten seconds of looking.

## Design plan

**Subject.** A reproduction lab. Each bug is a specimen run many times; the evidence is a row of trials. The visual identity comes from that: the **trial strip** (one cell per run) is the single memorable element, and everything around it stays quiet.

**Palette** (light):

| Name | Hex | Use |
| --- | --- | --- |
| Mist | `#F2F5F4` | Page background |
| Slate ink | `#1B2733` | Text |
| Rule | `#C9D3D0` | Borders, table rules, empty cells |
| Reproduced | `#B3261E` | Failing trial, "reproduced" states |
| Clean | `#2E6B4F` | Passing trial, "fix verified" |
| Intermittent | `#9A6A00` | Flaky states |
| Signal blue | `#2F4FA8` | Links, focus ring, the one interactive accent |

Dark scheme (via `prefers-color-scheme: dark`): background `#16212B`, text `#E4ECEA`, rule `#34454F`, reproduced `#F2837B`, clean `#7CC8A1`, intermittent `#E0B54D`, signal blue `#9DB3F2`. Every text/background pair must meet WCAG AA; check with a contrast tool in the UI review.

**Type.** IBM Plex Sans for everything (an IBM family for an IBM Bob hackathon entry, open-licensed per gate G-16). Weights 400 and 600 only. IBM Plex Mono only where the content is literally code: test source, commands, commit SHAs. Scale (rem): 0.875 / 1 / 1.25 / 1.563 / 1.953. Body line height 1.55, max line length 72 characters. Sentence case everywhere; no all-caps labels; no eyebrow labels above headings.

**Layout.** Left-aligned single column, max width 72 rem, generous left margin on wide screens. Numbers in the wireframes are illustrative only.

```
Overview (#/)
+--------------------------------------------------------------+
| Reprise  all repositories  all platforms  Open IDE  How it works |
|                                                              |
| Latest: #2 <report title>                                    |
| Before  [F . . F . . . . F . . . . . F . . . . .]  4 of 20   |
| After   [. . . . . . . . . . . . . . . . . . . . ...] 0 of 36|
|                                                              |
| Reports                                                      |
| #   Title                     Platform  Result        Trials   |
| 1   <report title>            Android   Fix verified  ▮▮▮▮▮▮   |
| 2   <report title>            iOS       Reproduced sometimes ▮▯▮|
| 3   <report title>            Windows   Duplicate of #1  -     |
| 4   <report title>            Linux     Needs one answer ▯▯▯   |
|                                                              |
| 4 reports  5 platforms  median time to result 6m              |
+--------------------------------------------------------------+

Issue detail (#/r/OWNER/REPO/issues/N)
+--------------------------------------------------------------+
| #2 <report title>                            Fix verified    |
| Android, emulator on this machine, result in 7 min, stub      |
|                                                              |
| Reproduction                                                 |
| [trial strip, 20 cells, large]  4 of 20 (8.1%-41.6%)         |
| Signature, test file link, attempts                          |
|                                                              |
| Diagnosis   summary, locations, fix direction                |
| Fix         PR link, source (provider or person), iterations |
| Verification [strip of required runs]  claim sentence        |
|             regression table (only non-zero rows)            |
| Timeline    events in order                                  |
+--------------------------------------------------------------+
```

The overview opens with the most recent before/after pair of strips rather than headline statistics; totals sit quietly at the bottom.

**Principles.**
1. Evidence first: every verdict is shown next to the runs that justify it.
2. Plain words: users read "Reproduced 4 of 20 times", never enum names.
3. One accent: signal blue is only for things you can click or focus.
4. Borders encode structure (table rules, strip cells); no drop shadows, no gradient washes, no uniform rounded cards.

**Review against generic defaults** (done while writing this spec): a stats-hero with big numbers was the first idea and was replaced by the before/after strip because it is specific to what Reprise does. Cream and terracotta, near-black with acid accent, and newspaper-column layouts were avoided. Mono is limited to real code.

## Display names

| State or verdict | Shown as |
| --- | --- |
| `LISTED` | Not acknowledged |
| `REPLICATING` | Replicating |
| `STOPPED` | Stopped by user |
| `CONFIRMED` | Reproduced |
| `FLAKY` | Reproduced sometimes |
| `DUPLICATE` | Duplicate of #M |
| `NEEDS_INFO` | Needs one answer |
| `BLOCKED_ENV` | Test environment missing |
| `ERROR` | Reprise hit an error |
| `FIXING` | Fix in progress |
| `FIX_ABANDONED` | No fix proposed |
| `VERIFYING` | Checking fix |
| `FIX_VERIFIED` | Fix verified |
| `FIX_INCOMPLETE` | Still reproduces |
| `REGRESSION_DETECTED` | Fix breaks other tests |
| `RESOLVED` | Resolved |

## Trial strip component

- One cell per run in run order. Reproduced: filled with the reproduced colour. Passed: outlined with the clean colour. Invalid: rule colour with a diagonal hatch.
- Large variant on the detail page (cells 14×28 px, 3 px gap, wraps after 40), mini variant in the list (first 20 runs, 5×12 px).
- Each cell has a tooltip on hover and focus: "Run 7: reproduced". Tooltips open from the cell (transform origin at the cell edge they attach to).
- Accessibility: the strip has `role="img"` and an `aria-label` summary ("Reproduced in 4 of 20 runs: runs 1, 4, 9, 15"); a visually hidden list gives every run for screen readers.

## Motion (team rules, apply to every UI element)

- Only `transform` and `opacity` are animated.
- Entering elements start at `scale(0.95)` and `opacity: 0`, use `ease-out`, never `ease-in`.
- Every animation is under 300 ms.
- The one orchestrated moment: on the issue detail page, trial cells enter in run order with a 30 ms stagger (each cell 180 ms). Nothing else animates on load.
- Buttons use `transform: scale(0.97)` on `:active`.
- Popovers and tooltips use origin-aware transforms.
- Hover effects are wrapped in `@media (hover: hover) and (pointer: fine)`.
- `prefers-reduced-motion: reduce` disables all of the above.
- Actions triggered by the keyboard are never animated: if the page was reached or the element was activated by keyboard, the stagger and tooltip transitions are skipped (track the last input modality).
- There are no gesture-driven interactions; if any are added later, they use spring animations.

## Data loading

- `data/index.json` on the overview, `data/<owner>/<repo>/issues/<N>.json` on detail pages, both relative URLs.
- Hash routing: `#/`, `#/r/<owner>/<repo>/issues/<N>`, `#/how-it-works`.
- Every string from data is inserted with `textContent`. Links are built only from `url` and `ci_run_url` fields that start with `https://github.com/`.
- Content-Security-Policy meta (dashboard pages only; the IDE has its own, `browser-runtime.md`): `default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'`.

## Empty and error states

- No records: "No reports yet. Reports appear here after someone acknowledges them in Reprise IDE and publishes the record."
- The "Open IDE" link in the header is a plain link to `ide/`; the IDE itself handles unsupported browsers (`browser-runtime.md`).
- Data failed to load: "The report data didn't load. Reload the page. If a deploy is in progress, it finishes within a few minutes."
- Unknown issue number: "There is no report #N. Go to all reports."

## How it works page

Four short sections in order (a real sequence, so numbering is appropriate): acknowledge the report, replicate it on its platform, help fix it, prove the fix. One embedded static SVG of the lifecycle (from `issue-lifecycle.mmd`), a link to the IDE at `ide/` with the sentence "Reprise IDE runs in Google Chrome and Microsoft Edge on desktop.", a link to the Reprise Runner on GitHub Releases, and a link to `BUILDING.md`.

## Quality floor

Responsive down to 360 px wide, visible focus rings in signal blue (2 px outline, 2 px offset), keyboard reachable tooltips, semantic `<table>` for the report list, `lang="en"`, page titles per route, no console errors, Lighthouse accessibility score recorded in the UI review.
