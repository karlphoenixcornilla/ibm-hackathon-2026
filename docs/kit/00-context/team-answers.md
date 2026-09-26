# Team Answers (requirements)

Stated by the team on 26 September 2026 (R-16 added the same day, for kit v3). These are requirements, not proposals. If anything else in the kit disagrees with this file, this file is right.

| ID | Question | Answer |
| --- | --- | --- |
| R-1 | What is Reprise? | An IDE capable of recognising and replicating reported bugs, which provides or validates a failing test. Everything in the concept paper is included. |
| R-2 | What kind of IDE? | A fork of VS Code source (Code - OSS). Since R-16, the fork is delivered as its **web build**, used in the browser. |
| R-3 | GitHub | Connects with GitHub and the user's repository. |
| R-4 | Bug reports | The user can acknowledge bug reports in the IDE. Acknowledging a report starts Reprise replicating it. |
| R-5 | AI | Stubbed for now, but kept open for Claude, IBM Bob, Gemini, Groq and other providers. |
| R-6 | Platforms | Runs automated tests for native Windows apps, Android, iOS, macOS and Linux. |
| R-7 | Where tests run | On the user's own machine and devices, and on cloud CI runners (for example GitHub Actions). With R-16, runs on the user's machine go through the Reprise Runner (PD-17). |
| R-8 | How tests run | The repository's own test command first; built-in platform drivers as a fallback. |
| R-9 | Timeline | For the IBM Bob 2.0 hackathon, ending 27 September 2026. |
| R-10 | Demo platforms | All five platforms must actually run tests in the demo: Android, Windows native, Linux, iOS, macOS. |
| R-11 | Team hardware | A Windows PC, a Linux PC, a Mac with Xcode, and an Android phone or an emulator-capable PC. |
| R-12 | Features kept from v1 | Duplicate detection, fix assistance (AI-proposed fix), fix verification with regression check, web dashboard on GitHub Pages. |
| R-13 | Cost | Zero cost is a hard rule. |
| R-14 | How judges get Reprise | Web dashboard as the Application URL, build-from-source instructions, installers on GitHub Releases. **Affected by R-16:** the IDE is now a URL, so there is no IDE installer; PD-20 proposes shipping the Reprise Runner on Releases instead. The team must confirm. |
| R-15 | Demo apps | The team already has an app for each platform. Details are recorded in `demo-apps.md` by the team. |
| R-16 | Browser-based IDE | Reprise IDE runs in the browser and uses the File System Access API to open the user's local project folder. For now, only browsers that support that API are supported: Microsoft Edge and Chrome-based (Chromium) browsers. |

## Concept paper (from the team sheet, "Idea 1"), included in full by R-1

Reprise takes the messy report as it actually arrived (plain text, screenshots, logs), checks it against past reports by what is described rather than how it is worded, rebuilds the environment, writes a test and runs it, then runs it twenty more times to see how often the bug really shows up. It returns one of four answers: reproduced, with a failing test attached; reproduced sometimes, with a rate like 4 in 20 runs; duplicate, with the matching report; or blocked, with the one question worth asking the reporter. All of it happens before a developer starts work on the ticket.

Note on "writes a test" while AI is stubbed (R-5): the stub provider can only return tests the team has prepared in advance (see `02-specs/ai-providers.md`), and the user can always supply a test for Reprise to validate. This is the "provides or validates" in R-1.
