# The answer prompt, restructured — and the refused nomination, fed back

This is the design for slice M3 of epic #169, widened: the answer prompt
is rebuilt as a fixed sequence of blocks any capable model can read, and
the one open policy question about the doors — whether a refused
nomination is withdrawn in silence or carried back by name — is measured
inside the same artifact. It answers one question: *is the porch's
first-call routing habit the prompt's fault, and does a cleaner prompt fix
it without tying the system to one model?*

*Written 2026-09-14, after the M1 porch reading (findings §21). The
prompt's current section order is drawn in [session-flow.md](session-flow.md)
§4; this document is the delta.*

## The rule this slice lives under

> Prompts are structural, never tuned. A prompt change is a usefulness
> lever like retrieval or grammar: it runs on both models at N=3, and a
> change that helps one model and hurts the other is tuning, not cleanup,
> and is withdrawn.

The thesis credits usefulness to layers the operator owns and treats the
model as a replaceable input ([architecture.md](architecture.md)). A prompt
whose wording was chased against one model's replies makes that model
load-bearing again — the exact failure the falsifier in
[generalization.md](generalization.md) §11 names. So this slice changes
*order, presence and redundancy*, states each rule once in plain words,
and never rewords a sentence because one model's replies improved on it.
The domain-word gate stays on the prompt builder: every closed list is
data, and the builder holds no word of the world.

## The diagnosis

The last answer prompt the live page sent for "tell me about the game"
(the dev trace, 2026-09-14), read as the model reads it:

| what | number |
|---|---|
| length | 144 lines, 2,007 words |
| prompt tokens per answer call, over the trace (n=112) | mean 3,349; min 1,664; max 7,840 |
| negation clauses ("do not", "never", "not a", "no other", "nothing", "none") | 35 |
| lines before the model is told what to reply with | 50 |
| line the trainer's own words sit on | 39 |
| blocks present with no content (retrieval headers for an ask that selects no rows) | 3 |
| places the lesson-versus-door rule is stated | 3, each pulling a different way |

Read in order, the prompt does six things a reader should not have to
forgive:

1. **It opens with nothing.** Retrieval selected no rows, so the first ten
   lines are three empty table headers, then three near-identical
   precedents for a different ask.
2. **The task arrives late and the ask sits in the middle.** "Reply with
   one JSON object" is line 51. The trainer's words are line 39, between
   the scope rules and the claim contract.
3. **The lesson rule is stated three times, three ways.** "A lesson can be
   certified right now" (line 22); "when a built-in door fits the ask
   better than a lesson, nominate the door" (line 30); "a lesson is a last
   resort, never a shortcut" (line 108). For an ask that names no set, the
   only doors are `listing` and `profile`, and the model does what line 30
   says. The porch reading measured the result: the strong model nominates
   `listing` first on 20/20 conversations with memory off and 17/20 with
   the ask's own precedent shown; the weak model, which reads less of the
   prose, never does.
4. **It is a patch quilt.** Each dogfood round added a clause — "not a way
   to avoid saying nothing", "a lesson that is merely adjacent is worse
   than no claim", "never a number and never a name" — a fix for one
   trace, accreted rather than rewritten. Thirty-five negations.
5. **It explains why to a human.** "One wrong claim refuses the whole
   answer" is architecture rationale; the decoder and the kernel enforce
   it whether or not the model is told.
6. **It repeats the schema.** The reply's shape is enforced by strict
   decoding, then described again in prose, with the closed lists last —
   after the reader was told to use them.

The strong model mostly copes: 47/57 comparable answerable entries
resolve stably on the bank. The porch shows where it does not, and item 3
is the likeliest cause.

## The target shape

One fixed order, every block present only when it has content, every
rule once. Headings are the model's, in plain words. Fed by data — the
lists, the descriptions, the precedents — and holding no word of the
world in the builder.

```
YOUR TASK
You answer a trainer's question with claims the system will check against
certified records. Reply with one JSON object and nothing else:
{"asked": [...], "rosters": [...], "claims": [...]}

THE QUESTION
  - tell me about the game

WHAT YOU KNOW                       (only when a block has content)
  Certified rows for this question: …
  Earlier questions the records answered, and the accepted shape of each
  (examples of which door to take; never a value): …
  Earlier in this conversation the trainer said: …
  The previous answer was about: …
  Your previous reply to these words was refused, by name: …

WHAT IS KNOWN ABOUT THE TRAINER
  Nothing yet — a lesson can be certified now; any other claim tells the
  system what to establish first.        (or: version=… region=… badges=…)

HOW TO DECIDE, IN ORDER
  1. Small talk, or a question about you rather than the records → no claims.
  2. A question that names a set to list, or one creature to profile →
     one route claim, from the doors below. (Only when a door is listed.)
  3. A question a fact, count, ranking, matchup or eligibility claim answers
     → those claims; a lesson may stand beside them.
  4. A question about what something is or how the game works, that no
     claim above answers → one lesson from the catalogue.
  5. A question you genuinely cannot read → one clarify entry with typed
     options, nothing else.
  Link each thing asked for in "asked" first; use "none" when the records
  certify no such field. Claim only what was asked; omit what you cannot
  support. At most 12 claims and 4 rosters.

THE DOORS                            (only when offered on this call)
  - listing: …    - profile: …

THE SHAPES
  roster: …   fact: …   count: …   ranking: …   matchup: …   eligibility: …
  explanation: …   recommendation: …   action: …   clarify: …   suggest: …
  (one line each: the JSON and the one rule that governs it)

THE CLOSED LISTS
  lessons: …   rules: …   tools: …   the data dictionary: …
```

What changes, block by block, against today's prompt (session-flow.md
§4): the task and the reply shape move to the top; the ask moves above
every rule; context blocks are emitted only when non-empty; the scope
status becomes one line; the five-way decision list replaces the three
lesson rules, the small-talk clause, the "reach for a lesson only when"
clause and the door clause, stated once; the schema-linking instruction
becomes one line inside the decision list; the clarify and suggest
paragraphs become one shape line each; the rationale sentences go; the
closed lists stay where they are, last, because they are reference. The
target is about half the words, and it is a number the trace reports per
call.

Two things do not change. The claim kinds, ids and closed lists are the
same data. And nothing about enforcement moves: the same strict schema
at decode, the same gate.

## M3, folded in: the refused nomination

Today a nomination the driver refuses is withdrawn for one call and the
model is asked again with nothing said (`route/withdrawn`). The
alternative — carry the refusal back by name, the way a kernel denial is
(`route/refused-back`, one line: *the listing door was refused: the
question names no set to list*) — was queued as M3. The decision list
above is a third treatment: with the rule "a question that names a set to
list" stated once and first, the door may simply stop being nominated
where it does not fit. The three are measured together:

| arm | prompt | refused nomination |
|---|---|---|
| A | today's | withdrawn in silence (today) |
| B | restructured | withdrawn in silence |
| C | restructured | carried back by name |

B against A is the prompt. C against B is the policy. Both models, N=3,
one artifact per model, the product's other levers as the live page runs
them (retrieval, gated grammar, repair, profile, feedback, clarify,
suggest, precedents *nearest* with the shipped store).

## Mechanism

- **`answerPrompt` becomes a sequence of blocks**, each `{ heading, lines,
  present }`, assembled in the fixed order above; a block whose `present`
  is false is not emitted, and the request's hint records which blocks
  were, beside the doors, so a trace shows the prompt's structure as data
  and the artifact can count tokens per block. The rationale prose and
  the duplicate rules are deleted, not moved.
- **A prompt lint, by test**: no block emitted empty; no sentence
  appears twice in one prompt; a length ceiling per call, ratcheted down
  only, pinned the way the dictionary collision count is.
- **The refusal fed back**: a new driver option (`refusalFeedback`) and a
  ledger code (`route/refused-back`), the refusal in the driver's fixed
  wording on the feedback block of the retry; the trail's sent-back note
  reads "fed back" for it. Recorded per run like the other levers.
- **The harness**: `--prompt legacy|blocks` and `--refusal-feedback`
  flags, recorded in the artifact; `nominationRetries` and prompt tokens
  per call summarised per arm.
- **The precedent section**, one small data fix beside: promotion keeps
  one shape per distinct ask (the commonest across passes) instead of
  numbering every shape, so k=3 is not spent on three copies of one ask.
- **The scope prompt** (call 2) is untouched; the raw arm's prompt is
  untouched (the tax measures the chatbot, not the prompt).

*As built (2026-09-15, the M3 PR).* Four things differ from the mechanism
above, each the smaller shape:

- **The prompt is a lever, not a replacement.** `answerPromptBlocks` is
  built beside the legacy builder and selected per call
  (`AnswerStepInput.prompt`, `SessionDeps.prompt`, `session:trace --
  --prompt blocks`, `coverage:map -- --prompt blocks`); the legacy prompt
  is byte-identical to before, so arm A is exactly today's. The blocks a
  call emitted ride on the doors (`DoorState.blocks`) and the dev view
  prints them under the call. Block ids: `task`, `question`, `known`
  (the group heading), `rows`, `precedents`, `earlier`, `previous`,
  `refusal`, `trainer`, `decide`, `doors`, `shapes`, `lists`.
- **The lint is one test, pinned.** No block empty, no sentence stated
  twice, and the porch ask's word count on the fixture world pinned at
  its measured value (1,418 on the harness world; 1,497 on the shipped
  world, against the legacy 2,076), ratcheting down only — the same
  discipline as the domain-word gate, in the same file as the builder's
  other tests.
- **One rule came back, once.** The first porch reading of the blocks
  prompt (findings §21, M3) found the strong model answering "I'm playing
  Red/blue; tell me about the game" with the whole lesson catalogue — up
  to twelve lessons in one certified answer, 5 of 5 on both blocks arms,
  0 of 5 on the legacy prompt. Of the three legacy restatements of the
  lesson rule, one carried a rule the others did not: *not a lesson that
  is merely adjacent*. It is restored as half a sentence in decision case
  4 ("the one lesson that squarely answers it, not the lessons near it")
  and measured again on both models; it is the rule stated once, not a
  wording chased against a reply.
- **The refusal fed back** is `SessionDeps.refusalFeedback` /
  `--refusal-feedback`, ledger code `route/refused-back`, the reason in
  the emptied-reply round's own wording (`driver/refused-route: the
  "listing" door was refused — <the executor's reason>`) plus one fixed
  line on what to do instead; the door stays withdrawn on the retry, so
  arm C differs from B by the feedback block alone. The trail reads it
  as fed back; the chat says the Advisor was told.
- **Per run**, the artifact now carries `nominationRetried` and
  `promptTokens`; the map counts the retries (count and percentage over
  runs) and prices the prompt per call. Promotion keeps one precedent per
  ask (precedent.md, "Revised with M3"); the shipped store is re-promoted
  to 102.

## The measurement, pre-registered

Read from the record, count and percentage together, per arm and model:

1. **Stable core and band**, all dispositions. **The tuning check:** B is
   within A's band or above it on *both* models. A B that lifts one model
   and drops the other out of its band is tuning, and the block that
   caused it is found and withdrawn — not reworded.
2. **First-call nominations** (`nominationRetries` per 411 samples), the
   M3 number, per arm; and the seven `meta-*` lesson entries' one-call
   rate, the porch's class. Target on B: nominations on lesson entries
   at or near 0 of 21 on the strong model, from the porch's 20 of 20.
3. **Calls per sample and prompt tokens per call**, per arm. B should
   cost less per call by about half; if it does not, the blocks kept are
   listed with their token counts.
4. **Off-ask and no-subject first attempts**, and the honest-disposition
   rate on the 45 must-not-resolve entries: a shorter prompt must not
   answer what the records do not hold.
5. **C against B**: nominations on the retry, third-call rate, stable
   core. The policy with the number becomes the default; the other is
   removed from the driver.
6. **Enforcement**: 0 of N escalations on every arm, stated with the
   denominator.

Cost, from the last legs: about $0.30 per strong-model arm and $0.06 per
weak-model arm — under $1.20 for six legs, roughly six hours of wall
clock. Before the legs, the porch reading (`session:trace`, the four game
ask phrasings, five each, both models, arms A/B/C) for pennies: if B does
not move the nomination on the porch, the diagnosis is wrong and the
legs are not paid for.

*As measured (2026-09-15, findings §21, "M3, the bank legs").* Six legs,
2,466 samples, 0 of 2,466 escalations. The tuning check read against
B: below A's band on the strong model (105–107 against 111–114 passes
per repetition of 137) and above it on the weak (95–99 against 93–97),
so **B is withdrawn as a default** and stays a lever. The loss is one
class, a lesson taught where a pass was due — the legacy sentences
"merely adjacent is worse than no claim" and "an honest pass beats
teaching the nearest thing" carried a rule case 4 does not. The
nomination survived A, B and C alike (203, 215, 255 of 411 on the strong
model; B and C's first calls identical, so the spread is the metric's
own band), which is the third case under "What would make this wrong":
**the habit is the strict schema's**, and the shortlist grammar (scale.md
S4) is the slice that owns it. C against B: no number; the silent
withdrawal stays the default and the fed-back lever waits for M4's porch
bank. Prompt tokens per call fell 10–14%, not half: the closed lists and
the rows are the weight.

## What would make this wrong

- **B moves the porch and not the bank.** Then item 3 was one ask's
  problem, and the block order is worth keeping only for the token cost.
- **B helps one model and hurts the other.** Tuning by another name; the
  slice keeps only the blocks that hold on both.
- **The nomination survives B and C alike.** Then the habit is the strict
  schema's (the route claim is a valid reply shape) and the fix is the
  shortlist grammar of scale.md S4 — offer the route in the schema only
  when a door is offered in the prompt — a different slice.

## Deliberately not built

A per-model prompt. Any wording changed because one model's replies
improved on it. Few-shot examples beyond the precedent door. A model
asked to judge its own prompt. A prompt that carries a fact value, a
count or a policy threshold.
