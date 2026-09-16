# The lesson door: offer a lesson only when the ask is about it

The pack has 24 lessons — short certified explanations like "what is a
Gym Leader?" Today every answer call can pick any of them. This design
narrows that: a lesson is offered only when the trainer's question is
about the thing the lesson explains.

It is the offered door ([offered-door.md](offered-door.md)) applied to
the lesson route. The question it answers: **does narrowing the lesson
list stop the model answering unanswerable questions with a nearby
lesson, without losing the lesson answers that are correct today?**

*Written 2026-09-16, from the decline ledger's first reading (findings
§23). Built the same day behind `--lesson-door`; the section "As built"
at the end lists where the build departed from this design and why. Terms
like leg, arm, band and porch are defined in the [glossary](glossary.md).*

## The problem, in numbers

The decline ledger reads the six M3 bank legs (a leg is one run of the
test bank on one model with one configuration): 810 samples on questions
the system must not answer, of which 204 were answered anyway.

| what happened | share of the 204 | layer that owes the fix |
|---|---|---|
| a lesson on a different subject | 125 (61%) | grammar |
| a neighbouring certified fact | 32 (16%) | retrieval |
| a gated ask answered around the gate | 20 (10%) | policy |
| advice where none was asked for | 15 (7%) | grammar |
| a set built for an ask that named none | 8 (4%) | grammar |
| the boundary lesson on an off-topic ask | 4 (2%) | reviewer |

The first row is this design. Examples:

- "Who is the Pewter City gym leader?" → the `what-is-gym-leader` lesson,
  16 of 18 samples.
- "What does an Oran Berry do?" → a lesson 13 of 18 times:
  `what-is-pokemon` 7, `what-is-badge` 4, `what-is-poke-ball` 2.

Each answer is true. Each answers a different question than the one
asked. The kernel cannot catch that, because the certificate is valid.

Two signs this is the grammar's fault, not the model's:

- **Both models do it at the same rate.** 63 of 101 (62%) strong model
  misses, 62 of 103 (60%) weak model misses. A prompt change that helps
  one model and not the other is tuning (§21). A miss both models make
  equally is structural.
- **The chosen lesson varies.** "How long does it take to finish the
  game?" drew four different lessons across 13 misses. There is no single
  bad lesson to remove. The whole list is open and the model picks the
  nearest one.

## What the lesson route gets right

The route also does real work, and the design must not break it.

Across the same 2,466 samples, 478 lessons-only answers **passed**:

- 172 taught `what-the-records-hold`, the records-boundary lesson. That
  lesson is the honest refusal, and the scorer counts it as one.
- 306 answered one of 18 bank questions whose correct answer *is* a
  lesson:

| ask | lesson | passes |
|---|---|---:|
| "What is a Pokémon?" | `what-is-pokemon` | 18/18 |
| "What is a Gym Leader?" | `what-is-gym-leader` | 18/18 |
| "What's a gym badge?" | `what-is-badge` | 18/18 |
| 10 more | | 18/18 each |
| "What is a Poké Ball?" | `what-is-poke-ball` | 17/18 |
| "What's the difference between Red and Blue?" | `red-vs-blue` | 15/18 |
| "Is this game hard for a total beginner?" | `is-it-hard` | 15/18 |
| "What am I actually trying to do in this game?" | `objective` | 14/18 |
| "How do I catch a Pokemon?" | `how-catch` | 11/18 |

**306 of 324 (94%).** The gate protects this number. Fixing 125 misses
by breaking 306 correct answers would trade one north-star number for
another, which the project does not allow.

## Why the existing guards miss it

- **`trimPaddedLessons` skips this case on purpose.** It removes a lesson
  that arrived alongside real claims when the ask names an entity or
  type. Its comment says: *"An ask that names nothing keeps its lessons:
  they may be exactly what was wanted."* The 125 misses are all
  lessons-only replies to asks that name nothing. The exemption was
  reasonable; what was missing was a way to tell *which* lesson such an
  ask wants.
- **The linking cannot see it.** A lesson has no field and no subject, so
  "claims stay inside the ask" has nothing to compare.

## Why the cheap fixes do not work

- **"Retrieval found nothing" is not the signal.** It is true for "Who is
  the Pewter City gym leader?" (should decline) and equally true for
  "What is a Gym Leader?" (correct lesson, 18 of 18). Gating on empty
  retrieval breaks the 306 to fix the 125.
- **The driver must not swap in a better lesson.** That was the
  deflected-profile dispatch (2026-08-30 to 2026-09-06), deleted in R3b
  as "the substitution class by construction — true facts nobody asked
  for, chosen by the driver from the ask's words." This design withholds
  a route. It does not choose an answer.

## The rule

Same rule as the offered door: **a route is in the answer grammar only
when the driver would accept a nomination of it.**

For the listing door, the acceptance test already existed in the
executor and only had to run before the call instead of after. For
lessons, no such test exists. The pack's `curriculum` entries carry
`id`, `article` and `block` — nothing that says what question a lesson
answers.

So the coverage has to be written down. It goes in the pack, as
versioned reviewed data, not in the driver. The pack already has the
shape: `dictionary` is 24 entries of `{ id, subject, name, description,
aliases }`, the surface forms that tell the linking which *field* an ask
is about. A lesson's coverage is the same thing for a *concept*. This
also fits the agreed direction that the driver's hand-written English
lists become pack data.

**Why aliases are safe here.** Hard-won lesson 1 warns against bare
aliases because a match mints a certified value. A lesson alias mints
nothing. It only decides whether a route is offered. A bad alias widens
the offered set — back toward today's behaviour, never beyond it. The
worst case is a miss this design failed to prevent, never a false
certificate.

## Could a search engine do this instead of alias lists?

Yes, and the design is written so that it can.

The job here is: given the trainer's question, decide which lessons it
is about. The alias list is the smallest thing that does that job
deterministically, with no index, no network and no model, so it can run
in CI and in the browser. A real information-retrieval stack — BM25,
embeddings, a hosted search service — does the same job better on
paraphrases and misspellings, and would index the lesson text directly,
making hand-written aliases unnecessary.

What a search stack would replace: the matcher (`lessonAskCheck`'s
"does the ask contain an alias").

What it would not replace:

- The rule that a route is offered only when the driver would accept it.
  Whatever nominates the lessons, the grammar is still narrowed to that
  set before the call.
- `scope: concept | orientation` and "the boundary lesson is always
  offered". Those are policy, not matching.
- The record. Whatever chose the lessons, the choice must be written into
  the transaction so replay reads it rather than recomputing it. A search
  index changes; a filed record must not. That is the S3 seam
  ([scale.md](scale.md), "the recorded nomination"), which this repo has
  already named as the place a search provider plugs in, out of CI,
  measured by recall@k.

So the order is: aliases first, because they are free and deterministic
and give a number; a search stack behind S3 when that number shows the
matcher is the bottleneck. The gate below will say which it is — the
"coverage is too narrow" case in "What would make this wrong" is exactly
the signal that aliases are not enough.

## Mechanism

1. **Pack, new version.** Each `curriculum` entry gets a required
   `covers` block:
   - `aliases`: surface forms of the concept, e.g. for
     `what-is-gym-leader`: "gym leader", "gym leaders", "leader of the
     gym".
   - `scope`: `concept` or `orientation`. Orientation lessons are the
     ones about the game as a whole (`what-is-game`, `how-to-play`,
     `objective`). They get separate handling because they can match
     almost any ask.

   The field is required, not optional. An optional field would let a
   pack silently keep today's behaviour.

2. **Driver, before the call.** `lessonAskCheck(world, ask)` returns the
   lessons whose aliases the ask contains, plus the boundary lesson,
   always. Orientation lessons are included only when no concept lesson
   matched. If nothing matches, the route carries the boundary lesson
   alone. A `route/narrowed` step records what was withheld and why, in
   plain words, beside the offered door's `route/withheld`.

3. **Grammar.** The `explanation` variant's `blockId` enum is built from
   that set instead of the whole catalogue. A lesson outside the ask is
   unrepresentable at decode, not refused afterwards.

4. **Nothing else changes.** Not the prompt wording, the executor, the
   kernel, or the oracle. The lever sits behind `SessionDeps.lessonDoor`
   and a `--lesson-door` flag on the tracer and `coverage:map`, so both
   arms run in one window.

## What fails closed, and what does not

Two loader refusals, pinned in `src/kernel/pack.test.ts` beside the
pack's other malformed-document refusals (`IA-6/pack-game-rule-malformed`,
`IA-1/pack-ask-parameter-malformed`). These are documents the loader
must reject, not answer-time mutations, so they are not in
`src/crucible/**`:

- A lesson with no `covers` block, or an empty alias list. Refused by
  name.
- The boundary lesson declaring concept coverage. Refused by name. If
  the boundary lesson could be chosen as a topical answer, the scorer's
  `boundaryTaught` rule would start passing deflections.

One thing is **not** caught, and the design says so. A lesson listing an
alias it should not have (`what-is-pokemon` listing "gym leader") loads
cleanly and is offered wrongly. The certificate is still true; only a
reader knows the coverage is wrong. The control is the pack diff in a
reviewed PR — the same control every other pack rule has. A policy moved
into data is reviewed like data, not proved like a kernel invariant.

No article coverage changes. `NOT_YET_COVERED` is untouched.

## The gate, pre-registered

A cheap live check first: `session:trace` on the four opening phrasings
plus the five worst ledger entries, five conversations each, both
models, door on and off (the "porch reading"; a few cents). Then two
bank legs per model at N=3, today's behaviour beside the door. Every
number as count and percentage.

1. **Topical-lesson misses.** From 125 of 204 across the six legs (25 of
   48 on arm A) to at or near zero.
2. **The 18 lesson answers.** 306 of 324 (94%) today. Not lower. If any
   one of the 18 drops to zero, the lever is withdrawn whatever the miss
   count did — that is a coverage bug, and the pack is fixed to match
   the ask, never the ask to match the pack.
3. **The tuning check.** Pass band on both models within or above
   today's (strong 111–114, weak 93–97 of 137). Up on one model and down
   on the other withdraws the lever.
4. **Correct-decline rate.** Up on both models, from 121/174 (70%)
   strong and 100/174 (57%) weak.
5. **Boundary-lesson passes.** Should rise as topical ones fall (172 of
   2,466 today). A miss turned into an honest refusal is the win. A miss
   turned into an abstention is a smaller win, counted separately.
6. **Enforcement.** 0 of N escalations, both models, denominator stated.
7. **Recall on phrasings the aliases were not written from** (added
   2026-09-17, findings §24 "The activation ceiling"). The lesson door's
   paraphrase column on the activation gauge — the bank's reviewed
   `phrasings` of the 18 lesson questions, which are the held-out set and
   must never be the source of an alias — not below today's 15 of 25
   (60%) after any change, and the number to raise before the door is
   the default. Item 2 cannot read this: the bank runs the canonical
   intents, which the aliases were written from.

Cost: about $0.30 per strong leg, $0.04 per weak leg; under $0.70 for
the four, after the live check for about three cents.

**Run beside S4a's unrun gate in the same window.** The same arm moved
from 0% to 55% within a day (handover, 2026-09-16). Reading both doors
against one baseline is fairer and costs one set of legs instead of two.

## What would make this wrong

- **The miss moves to another route.** With lessons narrowed, the model
  reaches for `eligibility`, `recommendation` or a roster instead. Those
  two classes are 23 of 204 today, and the ledger reports them per leg.
  If they rise, the misses are a floor set by every route being open.
- **Coverage is too narrow.** One of the 18 drops because its wording is
  not in the alias list. Fix the pack. If several drop, aliases are the
  wrong way to state coverage and the design is wrong, not the data.
- **Coverage is too broad.** Misses barely fall because orientation
  lessons match too much. Three of the four lessons behind "How long
  does it take to finish the game?" are orientation lessons. If their
  honest coverage is "any question about the game", the door does not
  close, and orientation lessons need a different treatment — offered
  only when nothing else is, or not on a first call.
- **The band drops on one model.** Withdrawn, per the tuning rule.

## As built

Four departures from the design above, each forced by something found
while building. The design text is left as written so the departures are
visible.

1. **Concept aliases are definitional phrasings, not nouns.** The design's
   example was "gym leader", "gym leaders". But "Who is the Pewter City
   gym leader?" — the ledger's worst entry — contains "gym leader", so a
   noun alias would keep offering the lesson on exactly the ask it must
   not. The alias is "what is a gym leader", "what are gym leaders",
   "explain gym leaders" and so on; the noun alone is never an alias.
   This makes the "coverage is too narrow" risk above the live one: a
   definitional ask phrased in a way no alias anticipated draws the
   boundary lesson. The gate's second item reads it.
2. **Three scopes, not two.** The design said `concept | orientation` and
   "the boundary lesson claiming concept coverage is refused" — but also
   "a lesson with no coverage is refused", which the boundary lesson could
   not satisfy both of. So `boundary` is its own scope: it declares no
   aliases, is always offered, and exactly the lesson `recordsBoundary`
   names carries it. The two loader refusals are as designed, stated in
   those terms.
3. **Coverage is required within a pack, not across all packs.** The
   design said "required, not optional". But `indigo-accord-v1`, `v2` and
   the Center's earlier packs still load, because filed records pin them
   and must replay. So the loader follows the dictionary's rule: a pack
   with no coverage on any lesson is the pre-door pack and loads as
   before; one that declares coverage on some lessons and not others is
   refused. With the lever on against a pack that declares none, the
   driver offers every lesson and records that on the trail, so the door
   is never silently off.
4. **The trail step is always written when the lever is on**, not only
   when something was withheld — `route/narrowed` says "N of 24 lessons
   offered" or "every lesson was offered" with the reason either way, so
   a reader can tell a door that opened wide from a door that was off.
5. **Every answer call in the exchange carries the set, not only the
   first.** The design said "before the call". The first build narrowed
   the first call only; the porch reading caught the carried-back retry
   bringing the whole catalogue back, 3 of 50 on the strong model
   (findings §24). The three retry sites now recompute the same offer.

The activation gauge reads the door's recall on the bank's reviewed
paraphrases, which the aliases were not written from: 15 of 25 (60%) on
2026-09-17, seven misses being phrasings and three being typos — the
fork between more aliases and a real retriever, with its number.

The porch reading is in findings §24: topical lessons on the five worst
ledger entries from 13 of 25 to 0 of 25 (strong) and 8 of 25 to 0 of 25
(weak); the openers and "What is a Gym Leader?" unchanged at 20 of 20 and
5 of 5; calls and cost down on both models. The bank legs are still owed.

## Deliberately not built

- Driver-side substitution of one lesson for another (the deleted
  dispatch).
- Any coverage check that lives in the driver instead of the pack.
- Semantic or embedding matching between ask and lesson. That belongs
  behind the S3 seam, metered by recall@k, out of CI.
- Retiring `trimPaddedLessons`. It guards a different case (a lesson
  beside real claims), and both guards can hold at once.
