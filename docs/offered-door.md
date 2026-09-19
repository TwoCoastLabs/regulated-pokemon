# The offered door: a route is in the grammar only when the driver would accept it

This is the design for the slice that follows #169 M3 — the first step of
the scale plan's S4 ([scale.md](scale.md), "the shortlist grammar"),
taken on one door. It answers one question: *does the strong model's
first-call listing nomination on asks that name no set go away when the
door is simply not offered on those asks — and does anything else move
with it?*

*Written 2026-09-15, after the M3 bank legs (findings §21). The mechanism
it changes is drawn in [session-flow.md](session-flow.md) §1 (the "reply
was only a nomination the executor refused" branch) and named in
[routing.md](routing.md) R3 ("the door, not the work").*

## The diagnosis, in numbers

Two readings of the same behaviour, both filed:

- The porch (findings §21, M3): the strong model's first reply to "tell me
  about the game" is a listing nomination on 45%, 25%, 55%, 75% and 75%
  of conversations across five twenty-conversation cells and three
  prompt shapes. The weak model never does it.
- The bank (§21, "M3, the bank legs"): the answer call was repeated after
  a refused nomination on 203, 215 and 255 of 411 samples across arms A,
  B and C on the strong model. B and C build byte-identical first calls,
  so the ten-point spread between them is the metric's own churn, and A
  sits inside it. **The prompt's wording does not move this number.**

What does move it is where the nomination goes when it arrives. Read
from the strong model's baseline leg (arm A, 411 samples), the driver's
own reasons for refusing the 209 whole-reply listing nominations:

| the executor's refusal | count | readable from the ask alone, before any call? |
|---|---|---|
| "the question is about one named thing, and a listing answers a set" | 114 (55%) | yes — the ask names a certified species, move or item |
| "the question names no set to list — no type, and not a plain ask to list the catalogue" | 83 (40%) | yes — the ask names no single type and is not the bare catalogue ask |
| "a list of one is not a list (the model asked for n = 1)" | 12 (6%) | no — it is the nomination's own argument |
| listings served | 9 | — |

**197 of 209 (94%) refusals are decided by two deterministic checks on
the trainer's words that the driver already runs — after the model has
been paid to nominate.** The other three legs read the same way (B: 197
of 220; C: 234 of 259). The habit is the strict schema's: the route
variant is a valid reply on every first call, and this model takes it
whenever the ask is vague enough to fit the door's description.

## The organizing rule

> A door is the driver's offer, not the model's obligation. The driver
> offers a door only when it would accept the nomination — the same
> deterministic check, moved from after the call to before it.

Nothing about what the model may do changes: it may still nominate an
offered door and the executor still verifies the nomination. Nothing
about what may commit changes: the kernel is not in this path. What
changes is the grammar the model is handed on a given ask: the `listing`
variant is present when the ask names one type or is the bare catalogue
ask and names no certified subject, and absent otherwise — exactly the
set of asks on which a nomination would be served. This is the grammar
gate's discipline (§19: offer a count only when the question nominates
one) applied to the route door, and it is the scale plan's S4 in
miniature: a schema built from what the ask admits, not from the whole
catalogue of what exists.

It is not a prompt change. The prompt's wording is untouched; the doors
block simply lists the doors offered, as it does today when the door is
withdrawn on a retry. It is not tuning: the check is the executor's own
precondition, data about the ask, the same on every model; and it is
measured on both models under the tuning rule of
[answer-prompt.md](answer-prompt.md).

## What the lever costs, by construction

Lesson 6 (a deterministic front door that never engages is a silent
ceiling) is the risk to name. Here the door's "off" state is exactly the
executor's refusal: a listing the offer withholds is one the executor
would have refused, so no listing that would have been served is lost.
The cost is bounded at the twelve-in-209 the check cannot see (the
model's own `n = 1`), which the executor still refuses as today. The
offered-or-withheld state is recorded on every call's doors
(`DoorState.routes`), so the withheld rate is a number on every artifact,
never an assumption.

The profile door is left as it is: 2 of 261 refused nominations across
the strong legs were profiles, and its executor's ask-only check (the
ask names no move) refuses nothing the model attempts. One door, one
number.

## Mechanism

- **`offeredRoutes(world, state)`** in the driver: the ask-only half of
  `executeRoute`'s listing checks — `namesCertifiedSubject` false, and
  one type named or `bareCatalogueAsk` true — decides whether `listing`
  is in the routes passed to the first answer call. The executor keeps
  every check it has; the offer reuses two of them and adds none.
- **Recorded, not narrated.** A withheld door is a doors difference the
  dev view already draws (`DoorState.routes` without `listing`), and the
  bank run records per sample whether the listing door was offered
  (`listingOffered`), so the map reads *offered / nominated / served /
  refused* as four numbers.
- **A lever until measured** (`SessionDeps.offeredDoors`,
  `session:trace -- --offered-doors`, `coverage:map -- --offered-doors`),
  recorded on the artifact; the live page and the tracer keep today's
  behaviour until the legs pick the default.
- **The domain-word gate** stays at its count: the checks are the
  executor's existing functions; the offer adds no literal.

*As built (2026-09-15, the S4a PR).* As designed, with three small
shapes: the executor's two ask-only checks are one function
(`listingAskCheck`), called by the executor and by the offer, so the two
cannot drift; a withheld door is a ledger step in the driver's fixed
wording (`route/withheld`, registered with the other codes), so the
trail, the tracer and the chat's sent-back reading all see it; and the
session counts `listingDoor.withheld` and `listingDoor.nominated`, which
the bank records per sample as `listingDoor: { offered, nominated,
served }` and the map sums as the door's funnel, on every leg whether
the lever is on or off. The lever is `SessionDeps.offeredDoors`,
`session:trace -- --offered-doors`, `coverage:map -- --offered-doors`;
the artifact records `offeredDoors`. The domain-word gate's count is
unchanged. One reading the build surfaced: "what is a Pokemon" is the
bare catalogue ask to the executor and is served when the nomination's
`n` allows — the offer reuses that reading rather than second-guessing
it, so the test ask for a withheld door is the porch's "tell me about
the game".

*As shipped (2026-09-21).* The door passed its gate on the bank
(findings §25), and two nights of dogfood after that still paid a
wasted first call nominating the listing on "tell me about the game"
and on every "compare" ask, because the live page and the tracer had
never turned it on (§27). It is the default now — `SessionDeps.offeredDoors`
is on unless set `false`, the live page inherits it, and
`session:trace -- --no-offered-doors` / `coverage:map -- --no-offered-doors`
are the off arm; every coverage artifact records `offeredDoors` either
way, so an artifact that says nothing is one filed before the offer
existed.

## The measurement, pre-registered

The porch reading first, for pennies (`session:trace`, the four opening
phrasings, five each, both models, offer on and off), then two bank legs
per model at N=3 — today's behaviour beside the offer — read from the
record, count and percentage together:

1. **The nomination**: answer calls repeated after a refused nomination,
   from 203 of 411 on the strong model. Target: at or under the
   executor's own residue (the `n = 1` class, ~12 of 411); on the seven
   lesson entries from 9 of 21 toward 0.
2. **The tuning check**: the stable core and band on both models, within
   or above today's band on each (strong 111–114, weak 93–97 passes per
   repetition of 137, from the M3 legs). A lift on one model with a drop
   on the other withdraws the lever.
3. **Listings served**: 9 of 411 today on the strong model; not fewer
   with the offer. A served listing lost is the lesson-6 cost, and it
   would be a bug in the reuse, not in the rule.
4. **Calls per sample and three-call exchanges** (1.70 and 45 of 411
   today, strong): both down, since a refused nomination is one call
   each.
5. **The honest-disposition rate** on the must-not-resolve entries: not
   below today's (121 of 174, strong).
6. **Enforcement**: 0 of N escalations, both legs, both models, the
   denominator stated.

Cost: about $0.30 per strong leg and $0.04 per weak leg — two of each,
under $0.70 — after a porch reading for about three cents.

## What would make this wrong

- **The nomination moves elsewhere.** With `listing` withheld, the strong
  model nominates `profile` on the same asks, or writes a clarify entry.
  Then the habit is not the door's but the model's reluctance to answer
  a vague ask, and the number to read is the clarify and profile
  nomination counts on the lesson entries.
- **Served listings fall.** The reuse missed a check the executor makes,
  or `bareCatalogueAsk` and the executor disagree on some wording; the
  entries are named and the offer is fixed to match the executor, never
  the other way round.
- **The band drops on one model.** Withdrawn, per the tuning rule — and
  it would say a door withheld changes what a model composes beyond the
  door, which is a finding about the schema worth its own entry.

## Deliberately not built

The full S4 shortlist (the answer schema from the nominated k, the
provider's schema-size ceiling, recall@k) — that needs S2 and S3 under
it. A model-side "reason about whether to nominate" instruction (that is
prompt wording, and two readings say wording is not the lever). Any new
check on the ask: the offer reuses the executor's two and adds none.
