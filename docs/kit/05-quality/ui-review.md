# UI Review Template

Use this format for every UI review of the dashboard (team rule). One row per finding. Add screenshots by filename in the "Before" and "After" cells when useful.

| Area | Before | After | Why |
| --- | --- | --- | --- |
| Example: trial strip tooltip | Tooltip scaled from its centre | Tooltip scales from the edge touching the cell | Popovers use origin-aware transforms, so the motion shows where the tooltip came from |

## Checklist to review against

- Motion: transform and opacity only; ease-out; entry from `scale(0.95)` and opacity 0; under 300 ms; stagger 30–80 ms; buttons `scale(0.97)` on `:active`; hover gated by `(hover: hover) and (pointer: fine)`; reduced motion respected; nothing animates on keyboard-triggered actions; no Framer Motion is used (vanilla CSS), so the `x`/`y` shorthand rule does not apply.
- Design plan from `02-specs/dashboard.md` (also applies to IDE webviews): palette, type, left alignment, one accent colour, mono only for code, no eyebrow or all-caps labels, no shadows or gradient washes.
- Copy: display names match the table; empty and error states use the exact copy; sentence case.
- Accessibility: contrast AA in both schemes, focus visible, strip has aria summary and hidden list, table semantics, page titles.
- Security: no `innerHTML`, CSP clean, links only to `https://github.com/`.
- Responsiveness: 360 px, 768 px, 1440 px (dashboard); the IDE is desktop-only (R-16).
- Browsers: IDE webviews checked in Chrome and Edge; the dashboard also in Firefox and Safari.
