# AI Providers Spec

Implements R-5, ADR-4.

## Interface

```ts
type Stage = "intake" | "dedupe" | "test" | "rootcause" | "fix" | "review";
interface StageRequest { stage: Stage; issue: number; repo: string; vars: Record<string, string>; attempt: number; previous?: unknown }
interface StageResponse { json: unknown; files: { path: string; content: string }[]; usage: { calls: number; detail: Record<string, number> }; provider: string; stubbed: boolean }
interface Provider {
  id: string;                                   // "stub" | "claude" | "bob" | "gemini" | "groq" | ...
  capabilities: { images: boolean; implemented: boolean };
  run(req: StageRequest, token: vscode.CancellationToken): Promise<StageResponse>;
}
```

Rules for every provider:

- Output `json` is validated against the stage schema in `data-contracts.md`; invalid output is an error after at most one repair attempt (for providers that support one).
- `files` are proposals only. The pipeline checks each path against `edit_scope` (`test` stage: `edit_scope.test`; `fix` stage: `edit_scope.fix` minus `edit_scope.never`), shows them in a diff view, and writes nothing without approval (PD-10).
- Providers never execute commands and never receive GitHub tokens.
- Provider credentials (future providers) are stored in the workbench's secret storage, entered through "Reprise: Select Provider".
- Providers run in the browser (web worker) and call their APIs with `fetch`. Before a provider is enabled, check that its API allows CORS from the IDE origin and that it is free (R-13). A provider that only exists as a CLI (for example `bob run`, V-6) would need a runner endpoint; that is not designed yet.
- Runtime prompts in `03-runtime-prompts/` are the shared instructions for real providers.

## Stub provider (the only implementation now)

Reads prepared responses from the opened folder through `workspace.fs` (PD-11):

```
.reprise/stubs/<issue-number>/
  intake.json          stage intake output
  dedupe.json          stage dedupe output (optional)
  test.json            { "test_file": "...", "signature": { "kind": "...", "pattern": "..." }, "rationale": "..." }
  test/<path>          the test file content, written to test_file on approval
  rootcause.json       stage rootcause output
  fix.json             { "summary": "...", "files_changed": [...], "risk_notes": "...", "tests_added": [...] }   candidate 1
  fix/<path>           full new content of each changed file for candidate 1
  fix-2.json, fix-2/   optional further candidates (fix-3, ...); a deliberately wrong candidate shows the filtering
  review.json          optional stage review output (PD-29)
```

Behaviour:

- Missing stage file: the stub returns "No stub response for stage <stage> on #<N>". For `test`, the IDE then offers "Choose your own test file" (validate mode, R-1). For `intake`, the IDE asks the user for the platform and continues with an empty fingerprint (dedupe skipped).
- Candidates: stage `fix` is called once per candidate with `vars.candidate` = 1..N; the stub returns `fix-<k>` (candidate 1 is `fix`) and "No stub response" for missing ones, which are skipped. Stage `review` without `review.json` is skipped with the label "No review stub; self-review skipped".
- Attempts: the stub returns the same answer on every attempt; revision loops therefore stop after the first failure with the message "The stub cannot revise; edit the test or choose your own."
- `stubbed: true` on every response; the UI and records label it (`ide-ux.md`).
- Stub files are ordinary repository files; they are excluded from `edit_scope` (`never`) so a proposed fix cannot change them.

## Registered future providers (not implemented)

| Id | Notes for implementation later |
| --- | --- |
| `claude` | Claude API with tool use; model string and API details to be verified from official docs at implementation time |
| `bob` | **Implemented** (`src/providers/bob/`): renders `03-runtime-prompts/<stage>.md` with the stage schema, sends it through the runner's `POST /ai/run` (`local-runner.md` §AI bridge) to `bob run --format json`, read tools only; file proposals come back in the JSON under `files`; one repair attempt. Default provider (`reprise.provider: bob`). |
| `gemini` | To be researched at implementation time |
| `groq` | To be researched at implementation time |

Selecting one of these shows "Provider <id> is not implemented yet" and keeps `stub`. Any provider added later must pass the same stage-schema tests and the security cases in `05-quality/test-strategy.md`.
