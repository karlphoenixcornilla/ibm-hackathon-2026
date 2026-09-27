# Dashboard preview

From the repository root:

```powershell
python -m http.server 8000 --bind 127.0.0.1 --directory dashboard
```

Open http://localhost:8000. No dependency installation or build step is required. Serve the folder over HTTP; opening `index.html` directly cannot load the JSON files.

The preview includes repository and platform filters, trial strips, issue detail pages, a How it works page, light/dark styling, and sample-data labeling. Click a report title to open its details.

To regenerate the five deterministic sample records and refresh the local index schema:

```powershell
node dashboard/fixtures/generate.mjs
```

This overwrites the sample files and `data/index.json`. Do not run it against a dashboard containing live data. Fixtures use `F` for reproduced, `P` for passed, and `I` for invalid; confirm that encoding with the statistics producer before connecting live data.

The index follows the existing dashboard schema. The small validator in `data.js` supports the keywords that schema currently uses, not arbitrary JSON Schema. Detailed verification records provide counts rather than an ordered sequence, so the interface displays counts unless every recorded run passed. Overview run locations currently load detail records; revisit this for large live datasets.

System fonts are used pending G-16. No entry animations are enabled. Font licensing, lifecycle SVG, runner/build links, complete detail evidence fields, custom hover tooltips, and the full accessibility/browser review remain checklist work. No deployment workflow is included.

Suggested manual checks: filter by repository/platform, open a report, navigate back, switch system theme, resize to 360/768/1440 pixels, and navigate with Tab. Temporarily remove an index or record file to inspect the error states. Automated data-source checks: `node --test dashboard/test/*.test.mjs`.

## Application integration

Before loading `app.js`, set `globalThis.repriseDashboard` with `loadIndex()` and `loadRecord(issue)` async functions returning the existing index/record contracts. These loaders can call authenticated APIs; the dashboard does not manage credentials. Alternatively supply `indexUrl` and `baseUrl` (records under `<baseUrl>/<owner>/<repo>/issues/<number>.json`). URLs may be absolute or relative to the document. Without configuration, the standalone preview uses bundled sample JSON. The schema asset resolves relative to the module. No `/ide/` route or static deployment workflow is required.
