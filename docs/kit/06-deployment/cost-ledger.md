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
