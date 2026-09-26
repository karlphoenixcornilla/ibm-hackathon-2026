# Demo Apps (team to fill in)

R-15 says the team already has an app per platform. Nothing about these apps is known to the kit. **Fill in every cell** before phase 3; the build prompts read this file. Write "none" rather than leaving a cell empty.

## Apps

| Platform | App name | Repository URL (public?) | Language / UI framework | Build command | Existing test framework | Command that runs all tests | Command that runs one test file | Does it produce JUnit XML? (path) | Machine it runs on for the demo |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Windows native | | | | | | | | | |
| Android | | | | | | | | | |
| iOS | | | | | | | | | |
| macOS | | | | | | | | | |
| Linux | | | | | | | | | |

## Bugs to demo

At least one bug per platform. For each, also say whether you will prepare a stub test (Reprise "provides") or write your own test for Reprise to validate.

| Platform | Issue title as a user would write it | Actual behaviour | Expected behaviour | Every time or sometimes? | Stub test or user test? | Known fix (for the stub fix fixture) | Duplicate report planned? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Windows native | | | | | | | |
| Android | | | | | | | |
| iOS | | | | | | | |
| macOS | | | | | | | |
| Linux | | | | | | | |

## Machines

| Machine | OS and version | CPU architecture | Browser and version (Chrome or Edge, R-16) | Node.js version (for the Reprise Runner) | Installed toolchains (Xcode, Android SDK, .NET, etc. with versions) | Devices or emulators attached | Local path of each demo repository clone (the runner's `--root`) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Windows PC | | | | | | | |
| Linux PC | | | | | | | |
| Mac | | | | | | | |
| Android device or emulator host | | | | | | | |

## Repository visibility

Zero cost relies on public repositories for GitHub Actions and Pages (V-4, V-5). If any demo app repository must stay private, say so here; the CI executor will then use only local runs (through the Reprise Runner) for it.
