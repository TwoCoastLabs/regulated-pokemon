# Indigo Accord — harness results

<!-- Generated from a run artifact; do not hand-edit. Regenerate with `npm run harness:results`. -->

Generated from a **live** run started `2026-08-07T02:55:14.781Z`, 3 repetition(s).

## Provenance

Measured against snapshot `kanto-red-blue` (`sha256:122f62e01be5023c6d3d5c5c48c2cee138c64317f2366102cb5dc9d4afde5b64`), derived from upstream commit `eed7925e3158c9f744816768d3cc3395e290127f`, under Accord pack `indigo-accord-v1`. A result against an unnamed world is not a result.

**Models:** `live:strong` (strong — `anthropic/claude-sonnet-4.5`), `live:weak` (weak — `meta-llama/llama-3.2-3b-instruct`), `live:adversarial` (adversarial — `anthropic/claude-sonnet-4.5`)

**Scenarios:** `basis-ladder` (A ranking that turns on interpreting long-tail wording); `basics` (A plain question that needs no interpretation).

## Enforcement

Structural — the same on every model, and a non-zero is a kernel bug, not a metric.

| answers committed | committed violations | committed wrong-scope | denials the gate fired |
| ---: | ---: | ---: | ---: |
| 4 | 0 | 0 | 17 (IA-2/fact-mismatch, IA-4/membership-mismatch, IA-4/ranking-mismatch, IA-4/count-mismatch) |

## Usefulness

Empirical, per model, sample-bounded — allowed to differ, and the difference is the point. Never blended with enforcement.

| model | resolved | abstained | avg turns to answer |
| --- | ---: | ---: | ---: |
| `live:strong` | 4/6 (67%) | 0/6 (0%) | 1.8 |
| `live:weak` | 0/6 (0%) | 6/6 (100%) | 0.0 |
| `live:adversarial` | 0/6 (0%) | 0/6 (0%) | 0.0 |

## Deterministic-gate recall

Which trainer wordings the closed-vocabulary front door routed before any model saw them. A regex front door that never engages is a silent usefulness ceiling; measured here, not assumed.

| scenario | bound directly | escalated to the ladder | routed to the model |
| --- | --- | --- | --- |
| `basis-ladder` | version, region, badgeLevel | comparisonBasis | "blue"; "which of the electric ones is the quickest" |
| `basics` | version, region, badgeLevel | — | — (resolved without the model) |

## Provider health and cost

Infrastructure failures are counted apart, never folded into a usefulness rate; cost is priced by the provider, never inferred from a table.

| model | runs | provider errors | cost | calls | tokens in / out |
| --- | ---: | ---: | ---: | ---: | --- |
| `live:strong` | 6 | 0 | $0.0846 | 9 | 3588 / 4924 |
| `live:weak` | 6 | 0 | $0.0010 | 6 | 1927 / 2645 |
| `live:adversarial` | 6 | 0 | $0.0697 | 9 | 4065 / 3834 |

## Verdict

✅ Enforcement held on every model; usefulness varied and was reported per model. The run is what it declared it would be.
