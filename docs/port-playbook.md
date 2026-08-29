# The port playbook: what a second world actually cost, and the checklist it earned

*The slice-6 reading of [the port log](port-log.md) (epic #94): the
pre-registered budget beside the recorded actuals, the generic core versus
the instance as the rehearsal found them, and the 30-day claim re-derived
with its caveats stated. This is a reading over filed evidence — every
number cites the log row or findings iteration that recorded it. It
extends, and does not repeat, [generalization.md](generalization.md): §2
there says what a port re-instantiates, §10 what the first build cost, §11
how the improvement loop runs; this file says what the *second* world
measured.*

## 1. The headline: the estimate was honest, the split was the finding

The pre-registered budget totalled **33 human working days** across ten
seams, written before slice 3 began and never edited. The recorded actuals
total **≈2 agent-days across rows 1–9, plus ≈1 agent-day and $0.58 for the
burn-in loops the budget missed** (log rows; findings iterations 35–41).
Three discounts separate those numbers, all stated in the log before the
work started: the data pipeline was reused, the author knows the kernel,
and the work was agent-executed with human review. The playbook does not
read "a port takes three days" — it reads:

- **The seam list was complete, minus one.** Nothing outside the ten
  pre-registered rows was needed — except the burn-in loop (§3), which any
  future budget must carry as a named row.
- **The days went where §2 of generalization.md bet they would: data, not
  kernel.** The certification sheet (70 reviewed extractions) dominated
  row 2; curriculum, consent wording and rules dominated row 6; oracles
  dominated row 8. Kernel edits were small, and the spend around them was
  *blast radius* — the five exhaustive switches and pinned suites the
  closed vocabularies deliberately make loud. That is the
  compiled-in-types bet behaving as designed: widening is noisy and
  reviewed, never silent.
- **The 30-day claim survives, re-derived rather than asserted:** for a
  team that has the pipeline, the discipline, and this checklist, 30 human
  days for a comparable-scale vertical remains the honest prior — the
  33-day estimate was written *for human execution with the discounts
  unapplied*, and every seam came in at or far under it. What the claim
  now carries that it did not before: a burn-in loop per new claim kind on
  top, certification review that scales with the corpus (not the kernel),
  and the caveat that a team porting someone else's verifier pays a
  first-time tax at every row the log's lower bound does not measure.

## 2. Generic core versus instance, as the rehearsal found them

The boundary generalization.md §2 drew held, with one refinement. The
*instance* is what the domain team authors: the snapshot projection, the
certification sheet, the pack (rules, lessons, consent wording, templates),
the bank with its oracles. All of it is data, all of it is reviewed, and it
was ~80% of the recorded effort. The *core* is the kernel plus — this is
the refinement — **the propose-side stack, which is five layers deep and
must move as one**: grammar (schema), prompt (both arms), decoder,
canonical folds, retrieval/reference (findings iteration 38; re-learned at
iteration 40 when the kernel had item rosters for a full paid run while
the grammar could not express them). The offline scripted end-to-end leg
is the instrument that finds the layer you forgot, before a paid run does.

## 3. The three-tier operational cost law (issue #112)

Once ported, a world's operating overhead scales with **vocabulary growth,
not knowledge growth** — and vocabulary growth decelerates as the bank
saturates (98 realistic inquiries demanded exactly two new claim kinds).

1. **New facts of existing kinds** — data only, zero application code.
   Model proposes extractions, a human certifies via PR review, the
   snapshot rebuilds under a new digest, old records replay under their
   pinned version. Cost ≈ review time per row; the weekly drift workflow
   watches upstream. This is the common case — in a pharma port it is
   label updates, new SKUs, revised dosing.
2. **New policy** — a pack version, still data. `pokemon-center-v2` (two
   bag rules) was one file; v1 stayed frozen on the shelf because filed
   records pin it (IA-10).
3. **New claim kinds** — the priced tier: five propose-side layers plus
   kernel check, crucible mutation and sentence template, landed together;
   ≈ a PR-sized effort each, **plus one burn-in loop** — the model
   over-reaches for the newest shape until the grammar disciplines it
   (iterations 40–41: the comparison kind arrived, was over-used as a
   value vehicle, and took one loop of enum-narrowing, a decode fold and
   prompt discipline to settle at its intended use).

## 4. The pre-port checklist

Before a line of code, in order:

- [ ] **Expressibility audit first** (the slice-0 method): tag the real
  inquiry distribution against a closed shape vocabulary, tiered
  existing/port/shape/composition. The Center measured 93% before any
  model ran; a vertical under ~90% fails regardless of later effort. This
  is also where the minimum acceptable answerable rate gets its
  denominator (issue #111).
- [ ] **Audit the fact vocabulary for one-fact-one-unit.** Every fact id
  must carry one dimension and one unit; a source that mixes units under
  one field is split or normalized *at certification*, with the
  conversion itself reviewed data. Ask whether the domain's real
  questions compare across fact ids (dose vs maximum, price vs resale) —
  if yes, dimension groups land with the world, as data, before the
  first paid run.
- [ ] **Pre-register the seam budget** in the port log's format — including
  a burn-in-loop row per expected new claim kind — and never edit
  estimates after the fact.
- [ ] **Certification sheet before world:** era/fidelity classes declared,
  provenance per fact, certified absence representable, the extraction
  crucible loaded (a fabricated extraction must be refused at review).
- [ ] **Five layers together** for every new claim kind, proven by the
  offline scripted end-to-end leg before any paid call.
- [ ] **The reference renders every certified column.** A grounding table
  that shows half the facts is a usefulness ceiling wearing grounding's
  clothes (iteration 41: the answer was certified but absent from the row
  in front of the model).
- [ ] **Oracles reviewed with the bank**, dispositions deliberate, no
  oracles before the world exists; expect to widen a few after the first
  paid run (iteration 40 priced oracle strictness at exactly 4 of 166
  misses — real, and small).
- [ ] **Dials fixed before the first paid leg** (grounding mode, gated
  grammar, repair, N) so every later loop iteration is causally
  comparable; then run the loop as §11 of generalization.md states it —
  decompose from the record, treat the owing layer, re-measure free where
  the treatment is instrument-side, re-pay one leg where it is not.

## 5. What this playbook cannot claim

The log measures one port, by the kernel's author, with an agent executing
and the pipeline reused — a lower bound with its discounts stated, not a
distribution. The 30-day figure is a prior to be re-measured on the first
real vertical (and the port log format is exactly the instrument to
re-measure it with); the burn-in-loop cost is one data point per kind, not
a law; and nothing here substitutes for the expressibility audit on the
actual inquiry distribution, which remains the gating number for any
vertical.
