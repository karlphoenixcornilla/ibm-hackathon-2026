# Verified Facts

Checked on 25–26 September 2026. Anything not here is unknown and must go through `verification-gates.md`.

No browser facts have been verified yet for v3. File System Access API support, local network access from a public page, CORS on GitHub endpoints and the web build's behaviour are all gates (G-20 to G-28). Move each result here once checked, with its source.

## Code - OSS (VS Code source)

| ID | Fact | Source |
| --- | --- | --- |
| V-1 | Building Code - OSS requires Node.js (x64 or ARM64) version 22 or later; the repository's `.nvmrc` may give a more precise version. A full build needs at least 4 cores and 6 GB RAM (8 GB recommended). The development build runs with `./scripts/code.sh` and `./scripts/code-cli.sh`; `npm run watch` builds, and `npm run watch-web` builds the web parts of built-in extensions. The development build identifies itself as "Code - OSS". | https://github.com/microsoft/vscode/wiki/How-to-Contribute ; https://github.com/microsoft/vscode |
| V-2 | The Microsoft Marketplace terms state that Marketplace offerings are for use only with Visual Studio products and services. VS Code forks such as VSCodium set `extensionsGallery` in `product.json` (`serviceUrl`, `itemUrl`) to Open VSX (`https://open-vsx.org/vscode/gallery`, `https://open-vsx.org/vscode/item`). Open VSX is a vendor-neutral open-source registry run by the Eclipse Foundation. | https://github.com/VSCodium/vscodium/pull/404 ; https://github.com/VSCodium/vscodium/blob/master/docs/extensions.md ; https://github.com/coder/code-server/pull/4319/files |

## Test drivers

| ID | Fact | Source |
| --- | --- | --- |
| V-3 | In Appium 2, drivers are installed separately (`appium driver install <name>`). Drivers maintained by the Appium team: `xcuitest` (iOS native and web), `uiautomator2` and `espresso` (Android), `mac2` (macOS native), `windows` (Windows native and UWP; based on Microsoft's WinAppDriver; documented as using Windows 10 as the host). No official Linux desktop driver appeared in these sources. | Appium README (mirror at https://github.com/alexandremorgado/appium) ; https://github.com/AppiumTestDistribution/appium-installer |

## GitHub

| ID | Fact | Source |
| --- | --- | --- |
| V-4 | GitHub Actions usage is free for standard GitHub-hosted runners in public repositories. A job can run up to 6 hours. GitHub Free allows 20 concurrent standard jobs, of which at most 5 macOS. Up to 1,000 GitHub API requests per hour across all actions in a repository. | https://docs.github.com/en/actions/reference/usage-limits-billing-and-administration |
| V-5 | GitHub Pages is available for public repositories on GitHub Free; site at most 1 GB; soft bandwidth limit 100 GB/month; deployments time out after 10 minutes; the soft limit of 10 builds per hour does not apply to custom Actions workflows; not for commercial SaaS. | https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits |

## IBM Bob (for the future Bob provider)

| ID | Fact | Source |
| --- | --- | --- |
| V-6 | `bob run` runs Bob Shell headless, with `--format json` (result object with `status`, `stats` including `session_costs`, and `last_message`), `--max-cost`, `--max-turns`, `--disable-tool-groups`, `--mode`, `--resume`. All tools are pre-approved in `bob run`. API-key authentication (`BOB_API_KEY`, Inference scope) is for CI and automation. Requires Node.js 24+. | https://bob.ibm.com/docs/shell/getting-started/start-bobshell-non-interactive ; https://bob.ibm.com/docs/shell/getting-started/install-and-setup ; https://bob.ibm.com/docs/shell/core-concepts/tools |

## Hackathon and research

| ID | Fact | Source |
| --- | --- | --- |
| V-7 | IBM Bob 2.0 Hackathon, online, 48-hour build, 25–27 September 2026. Judging: Application of Technology (clear application of IBM Bob 2.0), Presentation, Business Value, Originality. Submission fields: title, short and long description, tags, cover image, video, slides, demo platform, application URL. | https://lablab.ai/ai-hackathons/ibm-bob-2-hackathon ; team sheet "Hackathon Details" |
| V-8 | About 17% of submitted bugs are non-reproducible; causes include duplication (29%), intermittency (14%), missing information (8%), ambiguous specification (8%); 25% have more than one cause. | Rahman et al., EMSE 2022, via the team research brief |
