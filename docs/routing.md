# Routing: scope belongs to the profile, routing belongs to the model

This is the plan for the epic that follows twelve front-porch rounds and
the first self-driven dogfood sessions (findings §19). It answers one
question honestly: *is the user experience going to be materially better
if we do something different?* — and the answer is yes, and not by way of
a thirteenth round.

## The diagnosis

Across every round the kernel produced **no fabrication, no wrong-scope
commit and no unauthorized act**. That half of the thesis is proven. Nearly
every defect lived in the session driver — by round twelve some 1,700 lines
of cue regexes, doors, guards, phases and stop-word lists in
`src/session/session.ts`. That layer exists for one reason: **the weak
model could not route or compose, so routing was written in regex.** The
rule "no LLM in enforcement paths" was then over-applied to machinery that
is not enforcement but *usefulness*, and the project ended up hand-rolling
a natural-language-understanding layer — the one thing a language model is
for.

The findings already hold the decisive number. On the 21-question bank,
before the deterministic routes: strong model 71%, weak model 62%. After
the routes: both 86–90%. Read plainly: **the routes did the work, not the
model — and the routes are where the bugs are.** The five wrong-shape
answers the porch produced (wrong set, wrong direction, wrong subject,
twice the wrong shape — the last on 2026-09-04, a superlative ask served
the previous exchange's listing) each came from the interaction of two
hand-written doors.

Underneath is a limit worth stating without euphemism: the Accord proves
that what is said is *true and in scope*. It cannot prove that it *answers
the question*. Relevance is routing's job. Routing by regex at the porch is
what "true but not what you asked" looks like.

## The organizing rule

> Scope belongs to the profile. Routing belongs to the model. Guarding and
> proof stay deterministic.

Three things follow, and they are the epic's slices:

1. **The trainer's scope is a setting, not a chat inference.** A version,
   region and badge count the trainer sets once, recorded on the trainer
   channel like any utterance, replayable like any evidence. This deletes
   the largest friction class outright — the version question, the cards,
   the corrections, the switch-back, the contradiction re-ask (rounds 9,
   11, 12 and both dogfood sessions were mostly this). It is also how a
   regulated product actually works: a profile, not a guess. Chat
   inference stays as an override, under the same vocabulary.
2. **Routing is nominated by a capable model and validated by the
   driver.** The route-nomination path that exists since epic #118 becomes
   the *only* dispatch: the model picks a route from the closed catalogue
   and its arguments; the driver validates; the kernel verifies.
   Nomination is untrusted and recorded, so replay and proof are untouched.
   The deterministic *guards* (subject, direction, set — they catch wrong
   certifications) stay; the deterministic *dispatch* (cue lists, bareness
   readings, prior-roster doors) goes.
3. **The demo's default model is not the control arm.** The weak model is
   a feature *of the harness* — it proves the architecture leans on nothing
   it does not control. It is a poor default for a visitor. The measured
   strong model is the default; the weak model stays the doctrine's second
   leg in every harness run.

What does not change: enforcement stays a hard zero on every run, the
crucible stays the gate, and every published number still traces to the
artifact that produced it. And "true but not what you asked" remains
*possible* with any model — the mitigation is the measured usefulness
bank, never a proof.

## The slices

Each ships its instrument; enforcement stays a hard zero; no slice is
finished while a crucible article it owes is uncovered.

### R1 — The default is the measured strong model

The shipped relay already defaults to `[DEFAULT_STRONG_MODEL,
DEFAULT_WEAK_MODEL]`; the weak-first order used for dogfooding was a local
`.env` override. R1 makes the doctrine explicit in the docs and the dev
setup, and keeps the porch usable meanwhile with the smallest possible
patch: a superlative in a catalogue ask marks it a ranking ask, never a
bare listing (the 2026-09-04 misfire).

*Gate:* the realistic bank on the default model resolves at least as well
as on the weak model, with the number filed; the superlative misfire has a
test.

### R2 — The trainer profile

A typed `profile` event on the trainer channel — `{ version, region,
badgeLevel }`, set from a panel in the live session page — binds its
dimensions on a kernel route of its own (`profile`), the way a recorded
question lets a direct answer bind: the form is the context, so no context
word and no card is owed. A profile event from any other channel is refused
by name under IA-8; a profile that contradicts a later direct statement is
a contradiction like any other, and the trainer is asked. The pack's
questions remain the fallback for a trainer who never sets a profile.

*Gate:* a crucible mutation forges a profile on a foreign channel and is
denied by name; with a profile set, the version question never fires on
the realistic bank; the ceremony count (questions + cards per resolved
answer) is filed before and after.

### R3 — Dispatch by nomination

The listing cue dispatch, the bareness reading, the prior-roster door, the
deflected-profile dispatch and the eligibility dispatch are retired as
*dispatch*; each survives only as (a) an executor the model can nominate
and (b) a guard the driver applies to whatever the model composed. The
activation gauge (round eight) is repurposed to count nominations by route
and their validation outcomes, so a route the model never picks is as
visible as a door that never fired.

*Gate:* usefulness on the realistic bank, default model, at least current;
enforcement zeros; each of the five wrong-shape classes pinned by a bank
entry or mutation as denied-or-abstained, never certified-wrong; the
driver's cue-list count and line count filed before and after.

### R4 — The ceremony audit

With R2 and R3 in, measure what ceremony remains — questions, cards,
restatements per resolved answer on the bank — and set the ceremony dial's
defaults from the number rather than from taste.

*Gate:* the ceremony instrument is in the results page; the defaults are
stated with their number.

## Sequencing

R1 immediately — one commit. R2 next: the largest experience gain for the
least code, and it removes the friction R3 would otherwise have to route
around. R3 is the core and the largest. R4 closes. This epic pulls S3/S4
of [scale.md](scale.md) forward because the porch demands them, not
because scale does; the two plans share the invariant that nothing
nondeterministic ever gates proof.

## Deliberately not built

A model-phrased clarifying question (the pack's question is the binding
instrument; rewording it buys warmth and costs auditability — revisit after
R4's numbers). A per-user memory of scope across sessions (a profile is a
setting the page keeps, not a record the kernel owns). Any relaxation of
the closed route catalogue.
