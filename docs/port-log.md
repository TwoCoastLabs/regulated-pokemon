# The port log: a second world, timed against a pre-registered budget

*A measurement instrument, not a finding. Epic #94 builds a second certified
world (the Pokémon Center — generation-I items) partly to learn what a port
of this architecture actually costs. A stopwatch is only a finding if the
estimate was written down first; this file is where it was written down,
before slice 3 started, and where the actuals go beside it as the seams land.*

## The rule

Every seam a port re-instantiates gets an estimate **in working days** before
the work begins. The actual is recorded when the seam's PR merges, in the same
table, with the PR number. The estimate is never edited after the fact; a bad
estimate is a finding about estimating, and stays.

Two discounts are stated up front so the total cannot flatter the 30-day
claim it is meant to test:

- **The data pipeline is reused, not rebuilt.** `snapshot:fetch` already
  talks to the same upstream, so the data-steward seam here costs a fraction
  of what a real port pays. The actual for that row is reported as "days on
  top of an existing pipeline", and the playbook (slice 6) has to add a
  from-scratch estimate beside it.
- **One author who knows the kernel.** A port by someone who did not write
  the verifier will take longer at every row; the log measures the lower
  bound, and says so.

## The seams, and the pre-registered budget

Written 2026-08-27, before slice 3. The expressibility pass (findings
iteration 28) named what the bank demanded; the budget assumes exactly that —
`treats`, `comparison`, item rosters, item actions — and nothing the bank did
not name. `arithmetic` (three entries) is deliberately *not* budgeted: slice 4
decides it on the divergence and ceremony numbers, not on three questions.

| # | Seam | What lands | Estimate (days) | Actual (days) | PR |
|---|---|---|---:|---:|---|
| 1 | Snapshot projection | `snapshot:fetch` projects generation-I items by game index; per-surface fidelity declared; loader closed both ways; drift watch covers it | 4 | 0.2 | #104 |
| 2 | Certification pipeline | Prose `effect` → typed facts, with a propose step (model, offline artifact), a human certify step, provenance per fact, and an extraction crucible (an injected fabricated extraction refused at review) | 6 | 0.2 | #104 |
| 3 | Fact readers | Item facts (cost, restores, cures, usable-in, steps, catch multiplier, evolves) as registry readers with fidelity classes | 2 | 0.1 | #104 |
| 4 | Claim shapes the bank demanded | `treats` (with the certified negative) and `comparison`, each with derivation, verifier, formatter, crucible mutation and coverage bucket | 5 | 0.3 | #105 |
| 5 | Vocabulary widening | Roster criteria over items; item actions in the pack's action registry with consent notices for the irreversible ones | 3 | 0.15 (criteria; actions land with the pack, PR 3) | #105 |
| 6 | Pack | Controlled-item gates (the IA-5 analog), disclosures with approved wording, copy catalogue, formatters for the new value kinds, curriculum entries the bank asked for | 4 | | |
| 7 | Crucible | Mutations per new mechanism, plus the clean controls | 3 | | |
| 8 | Bank migration and oracles | The inquiry bank migrated into the playability format with `expectFacts`/`expectBlockIds` validated against the new world | 2 | | |
| 9 | Coverage map | Both defaults at N=3 on the realistic bank; the disposition map rendered from the artifact | 1 (plus billable run time) | | |
| 10 | Certified page and crucible page | Slots and formatters on the certified page for the new value kinds; the new sabotages on the crucible page | 3 | | |
| | **Total** | | **33** | | |

The total is the honest prior, not a number tuned to the target. It sits
above 30 with the two discounts *unapplied*; a from-scratch port by a second
author would sit higher still. What the log is for is the row-by-row
comparison: which seams were estimated well, which were not, and — the
question generalization.md §2 bets on — whether the days went into **data
authoring** (rows 1, 2, 6, 8) or **kernel edits** (rows 3, 4, 5, 7). If most
went into kernel edits, the compiled-in-types stance is costing more than it
claims, and the engine/instance boundary has to move.

### Notes on recorded actuals

- **Rows 1–3 (#104):** ~0.5 working days total, agent-executed with the
  repo's author reviewing the PR. The estimates priced human days; the
  ~20× gap is the agent discount **plus** the two stated discounts
  (pipeline reuse, an author who knows the kernel), and the playbook must
  not read it as "a port takes half a day" — it reads as "this seam's
  *irreducible* work is small once the pipeline and the discipline exist."
  The certification sheet is the honest cost center: authoring 70 reviewed
  extractions was most of row 2, and it scales with the corpus, not the
  kernel.

- **Rows 4–5 (#105):** ~0.45 agent-days. The kernel additions themselves were
  small (two claim kinds, four criteria, one crucible phase); the day went to
  the blast radius — five exhaustive switches and five pinned test suites the
  closed vocabularies deliberately make loud. That is the compiled-in-types
  bet behaving as designed: widening is noisy and reviewed, never silent.
  Item *rankings* wait on the pack's comparison-basis vocabulary (PR 3), and
  the item-action half of row 5 lands with the pack that registers the acts.

## How the actuals are recorded

- One row per PR that lands a seam; a PR spanning rows splits its days by the
  commit log, stated as an estimate if the split is unclear.
- Days are working days actually spent, including review rounds; wall-clock
  gaps between slices do not count.
- A row whose actual exceeds its estimate by more than half gets one line
  under the table saying what the estimate missed.
