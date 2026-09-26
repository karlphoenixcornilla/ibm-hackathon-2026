# Statistics

Unchanged from kit v1 except wording and §2a (adaptive trial count, new in v3). Applies to every platform and executor (ADR-7). The trial count is adjustable (PD-25, §2a); every formula below works for any count.

All functions live in `src/stats/` as pure functions with unit tests that reproduce the worked examples below exactly (to 4 decimal places). z = 1.959963984540054 (two-sided 95%). α = 0.05.

## 1. Trial outcomes

Each trial of the repro test produces exactly one outcome:

| Outcome | Symbol | Meaning |
| --- | --- | --- |
| `PASS` | `P` | Test ran and passed. |
| `FAIL_MATCH` | `F` | Test failed and the failure text matches the signature. Counts as a reproduction. |
| `FAIL_OTHER` | `X` | Test failed, but not for the reported reason. Invalid. |
| `ERROR` | `X` | Test did not run to completion (syntax, import, timeout not declared in the signature, sandbox error). Invalid. |

Valid trials `n = P + F`. Failures `k = F`. The trial sequence is stored as a string such as `PPFPPPPFPP...`.

If more than 10% of the trials run so far are invalid (more than 2 of 20, or more than 1 of 10), the test is unstable: return to the repro loop if attempts remain, otherwise replication ends in `ERROR` with the invalid outputs attached.

## 2. Verdict from trials

| Condition | Verdict |
| --- | --- |
| k = n (every valid trial failed) | `CONFIRMED` |
| 0 < k < n | `FLAKY` |
| k = 0 | `NEEDS_INFO` (the test never reproduced the bug) |

## 2a. How many trials (adaptive, PD-25)

The trial count is a policy with three numbers, set in `.reprise.yml` (`reprise-config.md`) and changeable per run in the IDE:

| Setting | Default | Meaning |
| --- | --- | --- |
| `min` | 10 | Runs always done before any early stop |
| `max` | 20 | Runs done unless the early stop applies |
| `limit` | 100 | Most runs the user can reach with "Run more trials" |

Optional `max_minutes` (no default): after `min` runs, stop when the elapsed time passes this budget and give the verdict from the runs so far, noting "stopped by time budget".

Rules, checked after each run once `min` valid runs exist:

1. **Early stop when every valid run failed.** If k = n at `min`, stop: `CONFIRMED`. At n = 10 the Wilson low bound is 72.2%, which is enough to call the bug deterministic, and it still gives the minimum 3 verification runs (§5).
2. **Otherwise run to `max`.** A mix of passes and failures gives `FLAKY`; more runs narrow the rate interval, and a higher Wilson low bound means fewer verification runs later. Zero failures gives `NEEDS_INFO` with the §4 bound.
3. **"Run more trials"** in the panel appends runs to the same sequence, up to `limit`, and recomputes the verdict and interval. The strip shows every run.
4. **Fixed count.** `min` = `max` turns adaptivity off (for example `trials: 20` in `.reprise.yml` is shorthand for min 20, max 20: the concept paper's fixed twenty).

The early stop is checked only once, at `min`; the interval is then computed as if n were fixed. This slightly overstates confidence for sequential stopping and is accepted for a one-look rule.

What each count buys (95%):

| Runs n | Wilson low if all n failed | Upper bound if none failed (§4) |
| --- | --- | --- |
| 5 | 56.6% | 45.1% |
| 10 | 72.2% | 25.9% |
| 20 | 83.9% | 13.9% |
| 30 | 88.7% | 9.5% |
| 50 | 92.9% | 5.8% |
| 100 | 96.3% | 3.0% |

Why 10 and 20: Google's guidance catalogues flakiness with 5 to 10 runs on one commit, and iDFlakies defaults to 10 reruns, so 10 matches common practice for a first look. The concept paper's 20 keeps the "never failed" bound under 14%. Retry settings in build tools (Maven Surefire, Gradle test-retry, usually 2) are for hiding flakiness, not measuring it, so they are too low here. Research found flaky tests that did not show up even after 10,000 suite reruns, so no fixed count catches every rare bug; the `NEEDS_INFO` sentence always states the bound instead of claiming the bug is absent. Slow device tests can lower `max` per platform and set `max_minutes`.

## 3. Wilson score interval

```
p = k / n
d = 1 + z²/n
centre = (p + z²/(2n)) / d
margin = z * sqrt( p(1-p)/n + z²/(4n²) ) / d
low = max(0, centre - margin),  high = min(1, centre + margin)
```

Worked examples, n = 20:

| k | rate | low | high |
| --- | --- | --- | --- |
| 20 | 1.00 | 0.8389 | 1.0000 |
| 19 | 0.95 | 0.7639 | 0.9911 |
| 10 | 0.50 | 0.2993 | 0.7007 |
| 4 | 0.20 | 0.0807 | 0.4160 |
| 1 | 0.05 | 0.0089 | 0.2361 |
| 0 | 0.00 | 0.0000 | 0.1611 |

## 4. Upper bound when nothing failed

When k = 0 in n valid trials, the one-sided 95% upper bound on the true failure rate is `1 - α^(1/n)`.

| n | bound |
| --- | --- |
| 3 | 0.6316 |
| 20 | 0.1391 |
| 36 | 0.0798 |

Used in the `NEEDS_INFO` result, with the actual n: "The test never failed in 20 runs, so if this bug exists here it happens in fewer than about 14% of runs."

## 5. Runs required to verify a fix

Goal: if the fix did nothing and the bug still happened at its replication rate, seeing zero failures should be unlikely (below α). Use the Wilson **low** bound from replication as a conservative rate `r`.

```
if r >= 1: required = min_runs
else: required = ceil( ln(α) / ln(1 - r) )
required = clamp(required, min_runs, max_runs)     # defaults 3 and 200
```

| Replication result | r (Wilson low) | Raw required | Used |
| --- | --- | --- | --- |
| 20/20 | 0.8389 | 2 | 3 |
| 19/20 | 0.7639 | 3 | 3 |
| 10/20 | 0.2993 | 9 | 9 |
| 4/20 | 0.0807 | 36 | 36 |
| 1/20 | 0.0089 | 336 | 200 (capped) |

## 6. Claims written in verification comments

If all `required` runs pass and the raw requirement was not capped (evidence `strong`):

> If this bug were still present at its replication rate (at least {r as %}), the chance of {required} clean runs would be below 5%.

Check: for 4/20, (1 - 0.0807)^36 = 0.048 < 0.05.

If the requirement was capped (evidence `limited`):

> {runs} clean runs rule out failure rates above {1 - α^(1/runs) as %}. The bug's replication rate may be as low as {r as %}, so this is limited evidence. Consider verifying again with a higher run limit.

For 1/20 capped at 200: the bound is 1.49% against r = 0.89%.

## 7. Rounding and display

Rates display as percentages with one decimal (20.0%). Intervals display as "8.1%–41.6%". Stored values keep full precision.
