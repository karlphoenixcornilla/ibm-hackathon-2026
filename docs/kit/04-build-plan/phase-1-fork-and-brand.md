# Phase 1 — Fork, web build, brand, extension skeleton

**Serves:** R-2, R-16. **Specs:** `02-specs/ide-fork.md`, `02-specs/browser-runtime.md`, `01-architecture/decisions.md` (ADR-1, ADR-2, ADR-12). **Gates:** G-1 to G-6, G-19, G-21, G-26.

## Task prompt

```
In OWNER/reprise-ide (a fork of microsoft/vscode), create branch reprise/main from tag <PINNED TAG> and implement docs/kit/02-specs/ide-fork.md for the web build only:
1. Change product.json and web assets exactly as the gate results G-3 and G-4 recorded in ide-fork.md require (names from PD-4, gallery removed per PD-21). Record every changed field, old and new value, in ide-fork.md.
2. Configure the web entry page for serving under /ide/, with the supported-browser check and unsupported-browser page from browser-runtime.md and a Content-Security-Policy whose connect-src matches browser-runtime.md.
3. Add a built-in web extension at extensions/reprise/ registered in the web build as recorded for gate G-2: package.json with a "browser" entry only, contributing an activity-bar container "Reprise" with the first-run checklist and empty "Bug Reports" and "Runs" views, the commands listed in 02-specs/ide-ux.md as stubs that show "Not implemented yet", and the settings listed there. TypeScript, strict mode, bundled for a web worker. Unit test setup that runs without Node-only APIs in the extension code.
4. Verify each API in gate G-19 with a small call in the extension, in Chrome and in Edge; check gates G-21 and G-26 by opening a demo repository folder. Record results.
5. Serve the minified web build from a plain static server with no custom headers (gate G-6) and record what breaks, if anything.
6. Add docs/kit/ (this kit) and a first BUILDING.md with the exact commands you ran.
Touch nothing else in the Code - OSS source. Report any step where the pinned tag differs from what the specs expect.
```

## Acceptance

The web build opens as "Reprise" in Chrome and Edge from a static server; Firefox or Safari shows the unsupported-browser page; a local folder opens, edits and saves through the File System Access API and comes back after a reload; the Reprise container and views appear; stub commands run; G-6, G-19, G-21 and G-26 recorded; the fork diff contains only the listed changes.
