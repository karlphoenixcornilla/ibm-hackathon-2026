# Phase 8 — Driver fallback

**Serves:** R-8 (built-in drivers as fallback). **Specs:** `test-execution.md` (driver fallback runner), ADR-6. **Gates:** G-12, G-13.

## Task prompt

```
Implement drivers/ inside the Reprise Runner as test-execution.md specifies: with the user's confirmation in the runner console, install Appium 2 and WebdriverIO on first use, start or reuse a local Appium 2 server, ensure the platform's driver is installed (windows, mac2, xcuitest, uiautomator2), create a WebdriverIO session from platforms.<p>.driver.capabilities, run the fallback test module, and return a RunResult. First verify gate G-12 for each driver on the team's machines and record host requirements; for Linux, research gate G-13 and report before implementing anything.
Demonstrate one fallback test per platform whose driver passed its gate, using a demo app from demo-apps.md.
```

## Acceptance

Fallback runs work for each platform whose gate passed; the method `driver` appears in records; Linux status recorded per G-13.
