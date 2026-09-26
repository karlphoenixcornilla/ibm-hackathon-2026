# Phase 0 — Gates, machines and decisions

**Serves:** everything. **Who:** the whole team; a builder agent can help research.

## Steps

1. Fill in `00-context/demo-apps.md` completely (every app, bug, machine, browser version, Node.js version, local clone path).
2. Go through `00-context/provisional-decisions.md`; mark each Confirmed or Changed. PD-20 changes a team answer (R-14) and needs an explicit team decision. Changed rows update the specs they affect before those phases start.
3. Resolve the gates marked phase 0: G-1, G-2, G-3, G-4, G-15, G-20. Record results in `verification-gates.md`.
4. Parse every `01-architecture/diagrams/*.mmd` with a Mermaid parser and fix any error.
5. On each machine: install a supported browser (G-20) and Node.js for the runner, and the platform toolchain for its demo app; record versions in the Machines table. On the build machine only: the Code - OSS prerequisites (V-1, exact Node version from `.nvmrc` at the pinned tag).

## Task prompt (research help)

```
Read docs/kit/00-context/verification-gates.md. For gates G-1, G-2, G-3 and G-4, inspect the microsoft/vscode repository at tag <PINNED TAG> (web build scripts and entry page, extensions/ folder and a built-in extension with a "browser" entry, product.json, LICENSE.txt) and VSCodium's documentation. For gate G-20, check MDN browser compatibility data and Chrome Platform Status for showDirectoryPicker and FileSystemHandle permissions, and note whether Brave, Opera, Vivaldi and Arc enable the API by default. For each gate, report what you found with file paths or URLs, and a proposed pass/fail. Do not modify any file other than the Result column and the "(fill in)" sections of 02-specs/ide-fork.md and 02-specs/browser-runtime.md. If a source contradicts another, report both.
```

## Acceptance

`demo-apps.md` has no empty cells; every provisional decision has a status; G-1 to G-4, G-15 and G-20 have results; the build machine can build and serve the Code - OSS web target; every demo machine has a supported browser and Node.js.

## Stop conditions

G-15 says IBM Bob must be used in the product at runtime → R-5 must be revisited with the team before phase 4. G-15 says a Chrome/Edge-only Application URL is not acceptable → revisit R-16 with the team. G-1 fails (the web target does not build at the pinned tag) → pick another tag with the team before phase 1.
