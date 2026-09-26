# Cost Ledger (R-13: zero cost is a hard rule)

| Component | Cost | Basis | Condition | Verified |
| --- | --- | --- | --- | --- |
| GitHub repositories | 0 | GitHub Free, public | Stay public | [ ] |
| GitHub Actions (web IDE and Pages builds, runner release, CI runs) | 0 | V-4 standard runners in public repositories | Standard runners only; macOS/Windows coverage confirmed by G-9 | [ ] |
| GitHub Pages | 0 | V-5 | Under limits; non-commercial | [ ] |
| GitHub Releases (runner file) | 0 expected | Gate G-8 | Within file limits | [ ] |
| GitHub sign-in | 0 | Fine-grained personal access token (PD-23); no server | — | [ ] |
| Hosting of the web IDE | 0 | GitHub Pages (V-5), static files only | Within 1 GB (gate G-5); if G-6 needs another host, record its cost here | [ ] |
| Browsers (Chrome, Edge) | 0 | Free browsers | — | [ ] |
| Node.js (for the runner) | 0 | Open source | — | [ ] |
| Code - OSS source | 0 | Licence per gate G-4 | Rebranding as G-4 requires | [ ] |
| Extension gallery | Not used | PD-21 | — | [ ] |
| Appium 2 and drivers, WebdriverIO | 0 expected | Open source; confirm licences in G-12 | — | [ ] |
| Toolchains (Android SDK, Xcode, .NET, etc.) | 0 expected | Per `demo-apps.md`; confirm each is free for this use | No paid tiers | [ ] |
| Code signing (Windows certificate, Apple Developer Program) | Not used | Paid, so excluded by R-13; nothing is installed except a Node.js script | — | [ ] |
| AI providers | Not used | R-5 stub | Future providers must be re-evaluated against R-13 | [ ] |
| Fonts (IBM Plex) | 0 | Gate G-16 | Self-hosted | [ ] |

## G-5 prerequisite inspection

- Inspected the local `track/t5-web` checkout on 2026-09-26.
- Status: blocked before the build trial. The checkout contains the Reprise skeleton but no root `package.json`, `product.json`, `.nvmrc`, or `build/gulpfile.vscode.web.js`. No local Git tags are present.
- `../02-specs/ide-fork.md` still has no pinned Code - OSS release tag. The root `verification-gates.md` labels G-5 "Likely PASS", but provides no build measurements; this does not verify G-5.
- Required next input: the team's Code - OSS fork location and pinned stable release tag, with the base web build available.
- Build command, output folder, output size, and hosted-runner duration remain unverified. No build, deployment, or paid resource was started during this inspection.
- After the source is available, inspect its build scripts, run the hosted build trial, and record the measured size and duration before marking G-5 complete. G-6 then requires testing the built IDE in Chrome and Edge without custom headers.
