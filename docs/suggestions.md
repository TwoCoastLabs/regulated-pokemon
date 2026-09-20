# Follow-up suggestions: a next step the records can answer

## What this is for

The usefulness north star has two halves a follow-up suggestion serves. A
visitor who is shown a good next question explores more of what the system
can do; a visitor who clicks a suggestion and gets a decline learns not to
click again. So a suggestion is a promise. It has to be one the system can
keep, and it has to be worth making.

The first cut (R3b step 4, [routing.md](routing.md)) let the model write up
to three questions beside its answer and showed them uncertified, gated
only for compliance: a suggestion may name a topic, never a value. Two
weeks of the live page said what that misses (findings §34):

| live page, 2026-09-06 to 09-20 | count |
|---|---|
| answers carrying suggestions | 16 of 126 (13%) |
| suggestions shown / clicked | 50 / 7 (14%) |
| shown with no lesson or field behind them, judged against the pack | about 15 of 50 |
| the same two questions after "tell me about the game" | 9 of 13 lesson answers |

The model offers suggestions rarely, repeats itself, and a third of what it
offers leads nowhere. One clicked suggestion ("which ones are rare?") was
answered with twelve starter facts, because rarity is not a certified
field and the answer step found the nearest thing it could certify.

## The design

Two sources, one check, as everywhere else in this design: the model may
propose, and nothing is shown unverified.

**The answerable check.** Before any suggestion is shown, the driver reads
it the way the ask itself would be read, with no model call:

- a certified field, through the dictionary's aliases, with "it" resolved
  to a subject the answer just named — "how does its speed compare?" beside
  a Pikachu fact reads as the speed field of Pikachu; the same words beside
  a lesson about badges read as a field of no one, and are dropped;
- a lesson, through the same alias matcher the lesson door uses
  ([lesson-door.md](lesson-door.md)), never the records-boundary lesson;
- otherwise nothing, and the suggestion is dropped and counted as
  unanswerable.

The check errs toward dropping. The alias matcher's recall is a ceiling
(CLAUDE.md, lesson 6), so some answerable suggestions will be dropped. That
is the right side to err on: a dropped suggestion costs nothing, a dead
end costs the trainer's trust.

**The pack's own next steps.** The pack carries a table,
`presentation.nextAsks`, of questions the operator is prepared to be asked,
each worded with a pronoun in place of the subject so the register's rule
(no certified id, no digit) holds unchanged:

- for each lesson, the question that lesson answers and the lessons worth
  offering after it — "what are badges for?" is followed by the gym-leader,
  league and objective lessons;
- for each certified field, the question that asks for it about the
  answer's subject ("how fast is it?"), about a pair just compared ("which
  of the two is faster?"), and about a set just listed ("which of them is
  the fastest?").

Which table applies is read from the answer: after a lesson, its next
lessons; after a comparison, the same pair on another field; after a
listing, the set ranked by a field it was not ranked by; after facts about
exactly one subject, its other fields. After facts, the fields an earlier
accepted exchange asked for about that very subject come first, read from
the precedent store ([precedent.md](precedent.md)): the operator's memory
says which questions trainers ask.

The model's suggestions that pass the check come first, because they are
the conversation's own; the pack's fill the register to its cap of three.
Nothing shown or asked earlier in the session is offered again, and a
step back is no step: a suggestion that reads as the lesson this answer
teaches, or as a field already certified for the subject, is dropped as
already answered, whichever source wrote it.

On the live page every answer's register stays clickable, not only the
latest: a denied or declined turn files no register of its own and leaves
the earlier one on screen, and a click there is a suggestion taken (the
driver counts a suggestion said back from any earlier answer).

One wording rule the table learned on the live page: a `rank` or
`compare` wording must bind its own field through the scope vocabulary,
or bind none. The vocabulary's basis terms are single tokens, so "which
of them has the highest Special Defense?" bound the basis to Defense and
the ranking by Special Defense was denied under IA-1 — a suggestion
offered, then refused. The two special stats carry no rank or compare
wording until the vocabulary can read a two-word basis; a session test
pins every wording against `deriveScope`.

**Held to its promise at load.** The loader refuses a table whose wording
breaks the promise it will make: a lesson's question must carry one of
that lesson's declared aliases or nouns, so the lesson door would offer the
lesson for it; a field's question must carry one of that field's
dictionary aliases, so the linking would read the field in it; every id
must exist; the boundary lesson is never a next step; a lesson does not
follow itself. A session test pins the rest: every lesson wording is
offered its own lesson by the live matcher, every field wording reads its
own field beside a subject of its kind.

## What does not change

The kernel's gate is untouched: a manifest whose suggestion states a value
or names a certified id is still refused under IA-2, and the register's
texts are still held to the record by equality under IA-6. The pack's
wordings pass the same gate as the model's. No model call is added; the
check and the table are deterministic, so a session replays. The register's
lead-in copy ("the Advisor's own ideas, not certified") predates the pack's
candidates and now understates their provenance; it is catalogued copy
that filed records render, so it changes with the next pack version, not
in place.

## Reading it

- **On the trail:** `suggest/gated` lists each of the model's suggestions
  the check dropped, with why; `suggest/supplied` lists the pack's next
  steps shown, each with the lesson or field it will be answered with.
- **On the porch:** `npm run session:trace -- "ask" /next` says the latest
  answer's first suggestion back as the trainer's own words, and the next
  exchange shows whether the promise was kept.
- **In the bank:** with `--suggest`, every run records the suggestions
  shown, the model's dropped as unanswerable, and the pack's supplied.
  With `--follow-suggestion` beside it, the bank's trainer takes the first
  suggestion as the next ask and the run records what came of it: the
  record's status, and whether it carries the lesson or field the check
  predicted. The entry's own reading is taken before the follow-up and
  never touched by it.

## The numbers to watch

Three, reported as count and percentage, pre-registered here:

1. **Click rate** on the live page: suggestions taken over suggestions
   shown (`suggestions.taken` over the shown count). 7 of 50 (14%) before
   this change.
2. **Promise kept** in the bank's follow-through leg: follow-ups answered
   with the predicted lesson or field, over follow-ups asked. The target is
   every one; a miss names a wording or a reading to fix.
3. **Variety**, so a high answer rate cannot be bought by suggesting "what
   is a type?" forever: distinct suggestions shown per session, and how
   often a suggestion's route differs from the answer's.

A direction that lifts the click rate by loosening the check is wrong, not
the check.

## What the leg has read so far

Findings §35: on 30 answerable entries per model, the first suggestion
taken as the next ask was answered with the lesson or field promised on
28 of 29 follow-ups (strong) and 25 of 28 (weak). "Them" after a count is
the count's set (a roster serves a species field); the previous answer's
roster criteria ride into an anaphoric follow-up's prompt; a roster's
move id is read in its canonical spelling at decode; and a rank wording
must bind its basis outright, or every click costs the pack's basis
question.
