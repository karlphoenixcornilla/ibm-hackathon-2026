# Hackathon Requirements

Event and criteria: V-7. Rules still to confirm: gate G-15.

| Criterion | How Reprise IDE answers it | Open risk |
| --- | --- | --- |
| Application of Technology (clear application of IBM Bob 2.0) | The provider interface includes an IBM Bob provider design (V-6), and the kit is written so Bob can build the product. | With AI stubbed (R-5), Bob is not used at runtime. Judges score Bob's application; confirm with G-15 and decide whether to enable the Bob provider before recording. |
| Presentation | One demo per platform on real machines, all driven from the same browser IDE, one fix with a caught regression, one dashboard. | Five platforms in one video is long; see `07-submission/video-script.md`. |
| Business Value | Non-reproducible reports (V-8) across native platforms, where reproduction is most expensive. | — |
| Originality | Bug reports, replication, fix and proof inside a browser editor, running tests on native platforms through a paired local runner. | Judges must use Chrome or Edge to open the IDE (R-16); confirm this is acceptable (G-15). | — |

Submission fields and where their content comes from:

| Field | Source |
| --- | --- |
| Title, short and long description, tags | `07-submission/submission-content.md` |
| Cover image, video, slides | `07-submission/` |
| Demo application platform | Web (GitHub Pages: IDE and dashboard); runner on GitHub Releases — confirm accepted values (G-15) |
| Application URL | The dashboard URL (R-14), which links to the IDE at `/ide/` |
