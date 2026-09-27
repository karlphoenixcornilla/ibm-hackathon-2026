# Definition of Done (v3)

## Requirements

| Req | Done when | OK |
| --- | --- | --- |
| R-1 | Provided and user-validated failing tests both work | [ ] |
| R-2 | Reprise IDE's web build builds from the fork with branding and the built-in web extension | [ ] |
| R-3 | Sign-in and repository linking work | [ ] |
| R-4 | Acknowledging a report starts replication | [ ] |
| R-5 | Stub provider works; placeholders registered; stub labelled everywhere | [ ] |
| R-6, R-10 | Each of the five platforms produced a verdict from real test runs | [ ] |
| R-7 | Local runs through the Reprise Runner on all platforms; CI runs on every platform whose gates passed | [ ] |
| R-8 | Repository command used first; driver fallback shown on every platform whose gate passed | [ ] |
| R-12 | Duplicate detected; fix proposed and applied via diff; verification gives FIX_VERIFIED and REGRESSION_DETECTED; dashboard live | [ ] |
| R-13 | Cost ledger verified column complete, no charges | [ ] |
| R-14 | Dashboard URL, IDE at `/ide/`, BUILDING.md, runner on Releases (as confirmed for PD-20) | [ ] |
| R-16 | IDE works in Chromium-based desktop browsers through the File System Access API (tested in current Chrome and Edge); browsers without the API see the unsupported-browser page | [ ] |

## Demo outcomes (rehearsal)

| Platform | Report | Executor | Browser | Expected verdict | Observed | OK |
| --- | --- | --- | --- | --- | --- | --- |
| Windows native | from demo-apps.md | | | | | [ ] |
| Android | | | | | | [ ] |
| iOS | | | | | | [ ] |
| macOS | | | | | | [ ] |
| Linux | | | | | | [ ] |
| Duplicate | | | | DUPLICATE | | [ ] |
| Fix (provider) | | | | FIX_VERIFIED | | [ ] |
| Wrong fix (team) | | | | REGRESSION_DETECTED | | [ ] |

## Quality

- [ ] Unit, pipeline and security tests pass.
- [ ] UI review complete for the IDE webviews, the first-run checklist, the unsupported-browser page and the dashboard.
- [ ] Every gate has a result; every provisional decision has a status.
