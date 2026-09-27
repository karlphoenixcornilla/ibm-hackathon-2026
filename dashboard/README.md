# Dashboard preview

From the repository root:

```powershell
python -m http.server 8000 --bind 127.0.0.1 --directory dashboard
```

Open http://localhost:8000. No dependency installation or build step is required. Serve the folder over HTTP; opening `index.html` directly cannot load the JSON files.

The preview includes repository and platform filters, trial strips, issue detail pages, a How it works page, light/dark styling, and an empty state until reports are published. Click a report title to open its details. The Open IDE link needs the Base team's deployed editor.

The home route (`#/`) introduces the product with a value proposition, published reproduction evidence when available, platform/project details, a three-step workflow, report totals, and one repeated `Open IDE` action. Reports remain at `#/reports`. The default index contains no reports. The hero and reports page show empty states until real reports are published; no sample records ship in the dashboard. IDE implementation and deployment remain with the IDE team.

Manual landing-page checks (not run as part of this UI change):

- At 375 x 812 and 375 x 667, check that the headline, explanation, primary CTA, and evidence visual fit the first viewport where space permits, with no horizontal overflow or clipped content. At increased text size, allow vertical scrolling rather than hiding content.
- Check desktop and mobile in both themes for a darker page, lighter cards, and raised controls.
- Follow Home, Reports, How it works, report details, and the repeated Open IDE action; verify the IDE destination against the IDE team's deployed build.
- Navigate by keyboard, including the skip link, theme switch, report filters, and any IDE fallback dialog.
- Check empty, loading, and error states, then populate the index with real reports to check report rendering.

Publish real report records and update `data/index.json` to populate the dashboard. Trial outcomes use `F` for reproduced, `P` for passed, and `I` for invalid. JSON requests bypass browser caching; reload an already-open page to load a newly published index. Local edits do not update GitHub Pages until deployed.

The index follows the existing dashboard schema. The small validator in `data.js` supports the keywords that schema currently uses, not arbitrary JSON Schema. Detailed verification records provide counts rather than an ordered sequence, so the interface displays counts unless every recorded run passed. Overview run locations currently load detail records; revisit this for large live datasets.

System fonts are used pending G-16. No entry animations are enabled. Font licensing, lifecycle SVG, runner/build links, complete detail evidence fields, custom hover tooltips, and the full accessibility/browser review remain checklist work. No deployment workflow is included.

Suggested manual checks: filter by repository/platform, open a report, navigate back, switch system theme, resize to 360/768/1440 pixels, and navigate with Tab. Temporarily remove an index or record file to inspect the error states.
