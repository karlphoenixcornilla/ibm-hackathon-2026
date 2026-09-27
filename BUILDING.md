# Building Reprise from source

Configuration (IBM Bob, tokens, settings) is covered in [docs/SETUP.md](docs/SETUP.md).

## Prerequisites

- Node.js 24 or later. The runner needs 22 or later; IBM Bob Shell needs 24.
- Google Chrome or Microsoft Edge on desktop to run the IDE.

## Extension (`extensions/reprise`)

```sh
cd extensions/reprise
npm ci
npm run gen:assets   # regenerate Bob prompts and CI templates from docs/kit and templates/ci
npm run typecheck && npm run lint && npm run depcheck && npm test
npm run compile      # → dist/extension.js (web worker bundle)
npm run web -- /path/to/app-clone   # try it in Chromium at http://localhost:3000
```

To use it in VS Code for the Web without the rebranded IDE, serve the folder containing `package.json`, `dist/` and `media/` over HTTPS (Pages does this at `/ide/extension/`). Then run **Developer: Install Extension from Location…** in vscode.dev.

## Runner (`runner`)

```sh
cd runner
npm test
node build.mjs       # → dist/reprise-runner.mjs + dist/reprise-runner.mjs.sha256 (single file, no dependencies)
```

## Dashboard (`dashboard`)

```sh
cd dashboard
npm install --no-save          # optional: IBM Plex fonts
npm test
node build.mjs --out ../_site  # live records from repos.json, or sample data when there are none
```

## Rebranded web IDE (Code-OSS)

`.github/workflows/pages.yml` does this when the repository variable `REPRISE_BUILD_IDE` is `true`. To build it locally:

```sh
git clone --depth 1 --branch <VSCODE_TAG> https://github.com/microsoft/vscode.git
cd vscode
# apply the product.json fields from docs/kit/02-specs/ide-fork.md (G-3/G-4)
npm ci
npm run gulp vscode-web-min    # → ../vscode-web
```

Serve `vscode-web/` under `/ide/vscode-web/`, with `dashboard/ide/workbench.html` as `/ide/index.html` (replace `__BASE__` and `__HOST__`) and the built extension at `/ide/extension/`. Gates G-1 and G-5 (build time and size on a hosted runner) are still pending; see `verification-gates.md`.
