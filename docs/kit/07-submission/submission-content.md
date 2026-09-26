# Submission Content (draft)

Placeholders in angle brackets are filled in phase 11 from what was actually built and observed. Remove any sentence that stops being true.

## Title

Reprise IDE

## Short description

Reprise IDE is a VS Code-based editor that runs in your browser and turns bug reports into proof. Open your project folder in Chrome or Edge, acknowledge a GitHub issue, and Reprise replicates it with a failing test, runs it on the right platform — Windows, Android, iOS, macOS or Linux — measures how often it fails, helps fix it, and verifies the fix broke nothing else.

## Long description

**The problem.** About 17% of bug reports can't be reproduced by the developer who picks them up (Rahman et al., 2022). On native apps it's worse: the bug may only appear on one OS or device, and reproducing it means a different toolchain for each platform.

**What Reprise IDE does.** Reprise is a fork of VS Code (Code - OSS) with bug reports built in, running in the browser. Open the IDE in Chrome or Edge, open your local repository folder (through the browser's File System Access API), sign in with GitHub, and your bug reports appear in the editor. A small Reprise Runner on your machine lets the browser run your tests locally. Acknowledge a report and Reprise:

1. Structures the report and checks it against earlier ones by what they describe, not how they're worded.
2. Provides a reproduction test, or validates one you wrote, and checks it fails for the reported reason.
3. Runs it on the report's platform — on your machine or an attached device or emulator through the Reprise Runner, or on a GitHub-hosted runner — using your project's own test command, with built-in Appium drivers as a fallback.
4. Repeats it (10 to 20 runs by default, adjustable) and answers: reproduced, reproduced sometimes with a measured rate, duplicate, or one precise question for the reporter.
5. Proposes several candidate fixes, tests each in isolation, shows you the best as a normal diff, opens a draft pull request with a live checklist, and verifies it: the reproduction test must pass enough times to rule the bug out, and the whole suite is compared against the base branch so anything newly broken blocks the fix.

**AI.** <State exactly what ran. If still stubbed: "In this hackathon build, the AI layer is a stub that returns responses prepared for each demo bug; every stubbed output is labelled. The provider interface is ready for IBM Bob, Claude, Gemini and Groq.">

**Demo.** <Per platform: app, bug, verdict, where it ran — from the live dashboard only.>

**Cost.** Free to run: open-source Code - OSS served from GitHub Pages, GitHub Actions on public repositories, a single-file Node.js runner on GitHub Releases. Nothing to install except the runner.

**Try it.** Dashboard: <URL>. IDE (Chrome or Edge on desktop): <URL>/ide/. Runner: <Releases URL>. Build from source: <BUILDING.md URL>.

## Tags

IBM Bob, Developer Tools, IDE, Browser IDE, VS Code, Software Testing, Quality Assurance, Bug Reproduction, Mobile Testing, Cross-Platform, GitHub
