# The lesson door: a lesson is in the grammar only when the ask is the one it answers

This is the design for the slice the decline ledger named — the offered
door ([offered-door.md](offered-door.md)) applied to the route that
carries the most misses. It answers one question: *does the topical
lesson taken in place of a refusal go away when the lesson catalogue is
narrowed to the lessons the ask is actually about — without costing the
answers the lesson route already gets right?*

*Written 2026-09-16, after the decline ledger's first reading (findings
§23). The mechanism it changes is the `explanation` variant of the answer
schema (`src/harness/schema.ts`) and the doors the driver hands an answer
call (`src/session/session.ts`); the rule it follows is
[routing.md](routing.md) R3, "the door, not the work".*

## The diagnosis, in numbers

From the decline ledger over the six M3 bank legs (§23; 810 samples on
questions that must not receive a certified answer, 204 answered anyway):

| route | share of the 204 | layer |
|---|---|---|
| topical lesson | 125 (61%) | grammar |
| neighbouring fact | 32 (16%) | retrieval |
| gated dodge | 20 (10%) | policy |
| advice route | 15 (7%) | grammar |
| substituted set | 8 (4%) | grammar |
| boundary lesson, off-domain | 4 (2%) | reviewer |

**125 of 204 (61%) of the misses are one certified lesson on a subject
the ask did not name.** "Who is the Pewter City gym leader?" certified
`what-is-gym-leader` on 16 of 18 samples. "What does an Oran Berry do?"
took a lesson on 13 of 18 — `what-is-pokemon` 7, `what-is-badge` 4,
`what-is-poke-ball` 2. Every one is certified-true and answers a
different question, which is why the kernel does not catch them and the
funnel does.

Two readings say this is the grammar's and not the model's:

- **Both models do it at the same rate.** 63 of 101 (62%) of the strong
  model's misses and 62 of 103 (60%) of the weak model's. A lever that
  moves one model and not the other is tuning (§21, the blocks prompt);
  a miss both models make at the same rate is structural.
- **The lesson chosen is not stable.** "How long does it take to finish
  the game?" drew four different lessons across its 13 misses. There is
  no one bad lesson to delete — the whole catalogue is standing open and
  the model lands wherever the ask is nearest.

## What the route gets right, and must keep

The lesson route is not a liability to be closed. Across the same 2,466
samples, **478 answers were lessons alone and passed**: 172 taught
`what-the-records-hold`, the records-boundary lesson that *is* the honest
refusal, and 306 answered a question whose answer is a lesson. Those 306
are 18 bank questions, each drawing exactly the lesson written for it:

| the ask | the lesson | passes |
|---|---|---:|
| "What is a Pokémon?" | `what-is-pokemon` | 18/18 |
| "What is a Gym Leader?" | `what-is-gym-leader` | 18/18 |
| "What's a gym badge?" | `what-is-badge` | 18/18 |
| … 10 more at 18/18 … | | |
| "What is a Poké Ball?" | `what-is-poke-ball` | 17/18 |
| "What's the difference between the Red and Blue versions?" | `red-vs-blue` | 15/18 |
| "Is this game hard for a total beginner?" | `is-it-hard` | 15/18 |
| "What am I actually trying to do in this game?" | `objective` | 14/18 |
| "How do I catch a Pokemon?" | `how-catch` | 11/18 |

**306 of 324 (94%)** on those eighteen questions today. That number is
what the gate below protects: a lever that fixes 125 misses by breaking
306 answers is not a lever, it is a trade, and the usefulness north star
forbids paying for one number with another.

## Why the guards already there do not catch it

- **`trimPaddedLessons` deliberately declines to.** It drops a lesson
  that rode in beside real claims when the ask names a certified entity
  or type — the brochure stapled to the answer. Its own comment states
  the exemption: *"An ask that names nothing keeps its lessons: they may
  be exactly what was wanted."* A lessons-only reply to an ask naming
  nothing is exactly the 125, and exactly what that line waves through.
  The exemption was right when it was written; what was missing was any
  way to tell *which* lesson an ask that names nothing wants.
- **The linking cannot see it.** A lesson asserts no field and names no
  subject, so "claims stay inside the ask" has nothing to compare. This
  is the miss class the funnel was built to catch precisely because the
  certificate is true.

## Why the cheap checks do not work

- **"Retrieval found nothing" is not the signal.** It is true for "Who is
  the Pewter City gym leader?" and equally true for "What is a Gym
  Leader?" — an ask whose right answer is a lesson, passing 18 of 18
  today. Gating the route on empty retrieval would break the 306 to fix
  the 125.
- **The driver must not substitute.** The obvious alternative is for the
  driver to swap a wrong lesson for the boundary lesson. That is the
  deflected-profile dispatch, which stood from 2026-08-30 to 2026-09-06
  and was deleted in R3b: *"the substitution class by construction —
  true facts nobody asked for, chosen by the driver from the ask's
  words."* The same objection applies here and is the reason this design
  withholds a route rather than choosing an answer.

## The organizing rule

The same as the offered door's, one route over: **a route is in the
answer grammar only when the driver would accept a nomination of it.**
For the listing door the acceptance test already existed inside the
executor and only had to move earlier. For lessons there is no such
test — and that absence is the actual gap.

`data/accord-pack/v3.json`'s `curriculum` entries carry `id`, `article`
and `block`, and nothing that says what ask a lesson answers. So the
lesson's coverage has to be written down, and under this project's rules
it is written down in exactly one place: **the pack**, as versioned,
reviewed data, never as a list in the driver. A lesson that does not
declare its coverage is offered only where a lesson with no declared
coverage may be offered — nowhere but the boundary.

The pack already has the shape for it. Its `dictionary` is 24 entries of
`{ id, subject, name, description, aliases }` — the surface forms that
let the linking recognise which *field* an ask is about. A lesson's
coverage is the same idea one level up: the surface forms that say which
*concept* an ask is about. This is also the direction already agreed for
the driver's hand-written English lists — that they become pack data
rather than code (handover of 2026-09-16) — so this slice pays part of
that debt rather than adding to it.

**Why aliases are safe here when hard-won lesson 1 says they are not.**
That lesson is about aliases that *mint a value*: a bare noun matching
turns into a certified claim, so the pattern must require context. A
lesson alias mints nothing. It only decides whether a route is offered,
and a wrong match widens the offered set — back toward today's
behaviour, never past it. The failure mode of a bad alias here is a miss
this design failed to prevent, never a false certificate. That asymmetry
is the whole reason the coverage can be stated as surface forms at all.

## Mechanism

1. **Pack (new version).** Each `curriculum` entry gains a required
   `covers` block: `aliases`, the surface forms of the concept the lesson
   is about (`what-is-gym-leader` → "gym leader", "gym leaders",
   "leader of the gym"), and `scope`, one of `concept` or `orientation` —
   the second being the lessons about the game as a whole, which are
   handled separately below because they are the ones that can swallow
   any ask. The loader refuses a pack whose lesson declares no coverage,
   or an empty alias list, or a `recordsBoundary` lesson that also claims
   concept coverage — by name, the way it already refuses a
   `recordsBoundary` naming a lesson the curriculum does not carry
   (`IA-6/pack-records-boundary-malformed`). Required, not optional: an
   optional field would let a pack silently keep today's behaviour, and
   a hole that looks like policy is the thing that check exists to stop.
2. **Driver, before the call.** A `lessonAskCheck(world, ask)` returns
   the lesson ids whose declared aliases the ask names, plus the boundary
   lesson, always. When the ask names none, the `explanation` route
   carries the boundary lesson alone. The `orientation` lessons are
   offered only when no `concept` lesson matched — they are what "tell me
   about the game" wants and what "how long does it take to finish the
   game?" wrongly drew, and ordering them behind the concept lessons is
   the cheapest thing that could separate those two cases. A
   `route/narrowed` step records what was withheld and why, in the
   executor's words — the offered door's `route/withheld` beside it.
3. **Grammar.** The `explanation` variant's `blockId` enum is built from
   that set rather than from the whole catalogue, exactly as the listing
   route is left out when `listingAskCheck` refuses. A lesson outside the
   ask becomes unrepresentable at decode rather than refused after it.
4. **Nothing else moves.** Not the prompt's wording, not the executor,
   not the kernel, not the oracle. The lever is behind
   `SessionDeps.lessonDoor` and a `--lesson-door` flag on the tracer and
   `coverage:map`, so both arms run in one window.

## What fails closed, and what does not

Two loader refusals, pinned where the pack's other malformed-document
refusals are pinned (`src/kernel/pack.test.ts`, beside
`IA-6/pack-game-rule-malformed` and `IA-1/pack-ask-parameter-malformed`)
rather than in `src/crucible/**` — this is a document the loader must
reject, not an article a mutation must be denied under at answer time:

- **A lesson carrying no declared coverage** — refused at load, by name.
  This is the one that matters structurally: it is what stops the field
  from being quietly optional and the door from being quietly off.
- **The boundary lesson claiming concept coverage** — refused at load, by
  name. A boundary lesson that can be selected as a topical answer is no
  longer the refusal, and the scorer's `boundaryTaught` rule would start
  passing deflections.

And one that is deliberately **not** claimed. A lesson declaring aliases
it should not have — `what-is-pokemon` listing "gym leader" — loads
cleanly and is offered on a gym-leader ask. The kernel cannot catch it:
the lesson is a reviewed block, the certificate is true, and only a
reader knows the coverage is a lie. The control is the pack diff in a
reviewed PR, which is the same control every other pack rule has, and
saying so here is the point — a policy moved into data is reviewed like
data, not proved like a kernel invariant.

That last paragraph is the honest shape of this slice. It moves a
judgement into reviewed data, which narrows what the model may do
without widening what the kernel must prove — and the price is that the
judgement is only as good as its review. No article coverage changes,
and `NOT_YET_COVERED` is untouched.

## The measurement, pre-registered

The porch first, for pennies (`session:trace`, the four opening phrasings
plus the five worst ledger entries, five each, both models, door on and
off), then two bank legs per model at N=3 — today's behaviour beside the
door — read from the record, count and percentage together:

1. **The topical lesson**, the target: 125 of 204 misses across the six
   filed legs, and 25 of 48 on arm A alone. Target: at or near zero,
   since a lesson outside the ask is unrepresentable.
2. **The eighteen lesson answers**, the thing being protected: 306 of 324
   (94%) today. Not lower. A single one of the eighteen dropping to zero
   withdraws the lever regardless of what the miss count did — that is a
   declared coverage bug, and the pack is fixed to match the ask, never
   the ask to match the pack.
3. **The tuning check**: the stable core and band on both models, within
   or above today's (strong 111–114, weak 93–97 of 137). A lift on one
   model with a drop on the other withdraws the lever.
4. **The correct-decline rate**: 121 of 174 (70%) strong and 100 of 174
   (57%) weak today. Up on both, or the lever bought nothing.
5. **The boundary lesson**, which should rise as the topical one falls:
   172 of 2,466 passes today. A miss converted to an honest refusal is
   the win condition; a miss converted to an abstention is a smaller one
   and is counted apart.
6. **Enforcement**: 0 of N escalations, both legs, both models, the
   denominator stated.

Cost: about $0.30 per strong leg and $0.04 per weak leg — two of each,
under $0.70 — after a porch reading for about three cents. **Run beside
the offered door's own unrun gate (#118 S4a) in the same window**, so the
two doors are read against one baseline rather than two drifting ones;
the handover of 2026-09-16 recorded the same arm moving 0% to 55% within
a day, and a same-window pair is the only fair comparison.

## What would make this wrong

- **The miss moves to another route.** With the lessons narrowed, the
  models reach for `eligibility`, `recommendation` or a roster instead —
  the advice route and substituted set are already 23 of 204 between
  them. Then the finding is that the misses are a floor set by *every*
  route being open, and the numbers to read are those two classes'
  counts, which the ledger already reports per leg.
- **A declared coverage is too narrow.** One of the eighteen drops
  because its ask words were not in the declared set. Named, and the
  pack is fixed — but if several do, the vocabulary is the wrong
  mechanism for stating coverage and the design is wrong, not the data.
- **A declared coverage is too broad.** The misses barely fall because
  the general orientation lessons (`what-is-game`, `how-to-play`,
  `objective`) are declared to cover almost any ask. That is a real risk:
  three of the four lessons behind "How long does it take to finish the
  game?" are of exactly that kind. If the honest declaration for them is
  "any ask about the game as a whole", the door does not close and the
  finding is that orientation lessons need a different treatment —
  offered only when nothing else is, or not at all on a first call.
- **The band drops on one model.** Withdrawn, per the tuning rule.

## Deliberately not built

Any driver-side substitution of one lesson for another — the deleted
dispatch, and the reason this withholds a route instead. Any check on the
ask that lives in the driver rather than the pack: the coverage is data
or it is not a policy. A semantic or embedding match between ask and
lesson (that is S3's seam and belongs behind it, metered by recall@k, out
of CI). Retiring `trimPaddedLessons`: it guards a different case — the
lesson beside real claims — and both can be true at once.
