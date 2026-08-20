# The eval loop: down-sample, run, fix, grow

The full playability bank is 137 questions; a two-model paid run over all of it
(finding §19) is the epic's close, not its daily instrument. This is the
instrument in between: a **small, stratified smoke set** that runs for pennies,
finds the gaps, and grows as the system earns coverage.

The loop, each pass:

1. **Down-sample** — one or two questions per disposition × claim kind × new
   surface, so a run exercises every *shape* without paying for every *entry*.
2. **Run** — `npm run coverage:map -- --ids <set> --live` (strong) and
   `--live --weak`. Dry by default; `--live` bills the key in `.env`. Each run
   files a replayable artifact in `runs/coverage/`.
3. **Document** — the numbers, and every failure categorised (below).
4. **Fix** — the *system* gaps and the *eval* gaps are different repairs; tell
   them apart before touching anything.
5. **Grow** — add ids as surfaces are added or gaps are closed. The set only
   ever gets bigger; the full-bank §19 run is where it ends up.

## Failure taxonomy (read a red cell before fixing it)

A resolved-but-failed question is one of three things, and only two are the
system's fault:

- **Over-strict oracle** — the model gave a *different but valid* certified
  answer than the entry pinned (a `fact` where the entry expected `membership`).
  Fix the **eval** (broaden `expectClaimKinds` / `expectBlockIds`), not the
  system.
- **Shape deflection** — a structured answer of the wrong shape (a "how many"
  rule for a "what are" list). Fixable in the **system**, usually by tightening
  a claim's prompt so it stops being reached for out of shape.
- **Subject deflection** — a certified, true answer on the *wrong subject* (a
  `what-is-gym-leader` lesson for "who is the Pewter leader?"). This is the
  eager-model channel (finding #7, #11): **measured, not suppressed.** Prompt
  nudging is unreliable and can backfire; the guarantee that holds is that the
  answer is reviewed, certified content, never a fabrication.

The one line that is never negotiable: **enforcement is zero.** No
`should-refuse` question may commit gated advice; a red there is a broken zero,
not a usefulness miss.

## The smoke set (25)

Stratified across every disposition, every answerable claim kind, and each
surface added through epic #64 (curriculum, `typeCount`, `gameRule`, matchup,
eligibility), plus the known deflection-prone spots (a specific character, a
no-data fact, the ambiguous "what is Pokémon").

```
ans-fact-speed-pikachu,ans-count-electric,ans-type-count,ans-party-size,
ans-moves-per-pokemon,ans-member-zapdos-electric,ans-rank-fastest-electric,
kind-type-effectiveness,meta-what-is-pokemon,meta-what-is-game,
meta-what-is-gym-leader,meta-what-is-evolution,meta-what-is-type,
meta-first-steps,ans-rec-eligible-snorlax,kind-starter-pick,refuse-mewtwo-2,
ans-eligibility-mewtwo-8,data-catch-rate-snorlax,data-gym-leader-pewter,
meta-champion,kind-nickname,off-capital,off-pasta,data-my-team
```

## Current baseline (2026-08-19, N=1)

| | `gpt-5.4-mini` | `gemini-3.5-flash-lite` |
|---|---|---|
| overall | 19/25 | 21/25 |
| **answerable (structured)** | **16/16** | **16/16** |
| enforcement (gated commits) | **0** | **0** |
| honest-refusal on unanswerable | 20% (1/5) | 40% (2/5) |

Every structured surface resolves on both models; the whole gap is subject
deflection on unanswerable questions, and the weak model is the *more* honest of
the two — it deflects less. That is the finding the smoke set exists to keep
honest as the vocabulary grows.

## Fixed this pass

- **Shape deflection:** "what are on my team?" was grabbing the `party-size`
  rule; the `gameRule` prompt now says it counts a rule and does not list what a
  trainer owns, and the question abstains.
- **Over-strict oracle:** `ans-member-zapdos-electric` now accepts a `fact`
  (Zapdos's types) as well as a `membership` — both answer "is Zapdos electric?".
- **New gap documented:** `data-my-team` — the trainer's own party is not in the
  snapshot; expected: honest non-certification, never the party-size rule.

## Multi-turn: the dialogue bank

The smoke set above is single-turn — a fresh session per question. That is
blind by construction to everything that only exists *across* turns in one
session, which `docs/generalization.md` §10 names as the unmeasured axis: a
scope grant established early and reused (or gone stale) later, a recorded
clarifying question arming the wrong later utterance's answer route, deflection
compounding down a thread, and the ceremony cost of a *whole task* rather than
one exchange.

The dialogue bank (`data/playability/dialogues.v1.json`) is the instrument for
it. A `dialogue` entry is one truthful trainer (a single `profile`) speaking a
fixed sequence of `turns` into one live session — the same `startSession` /
`say` / `decideScope` / `decideAct` spine the page and the single-turn bank
both drive. Every turn carries the same oracle a bank question does (a
`disposition`, and for the resolving/refusing ones the claim kinds a good
answer asserts), so a turn is scored by exactly the same machinery
(`scoreOracle`), read from the record *that turn* produced. Reading a turn from
the session's latest record instead would score an abstaining turn against the
answer before it — so the reader is bounded by where each turn began.

Running it (dry by default, `--live` bills the key like the single-turn run):

```
npm run coverage:map -- --dialogues                 # dry: the plan, nothing billed
npm run coverage:map -- --live --dialogues          # the whole bank, filed as a dialogue artifact
npm run coverage:map -- --live --dialogues --weak    # the weak model, per doctrine
npm run coverage:map -- --render --dialogues        # re-render the newest filed dialogue artifact
```

A live run files a `*-dialogue.json` artifact in `runs/coverage/`, replayable
like every other, and renders two things a single-turn run cannot:

- **Per-turn coverage** — the single-turn disposition tally, over every turn in
  conversation. The enforcement-escalation guard is the same, and here it is
  the *cross-turn* enforcement zero: a turn that committed the advice the pack
  gates part-way through a friendly thread is exactly the case single-turn evals
  cannot see. It stays a hard zero.
- **Ceremony cost** — prompts-to-answer over a whole task, per conversation and
  on average. Scope established early and reused is what makes later turns cheap;
  a thread that re-establishes it every turn shows up as a high calls/turn.

The failure taxonomy is unchanged — a red per-turn cell is still an over-strict
oracle, a shape deflection, or a subject deflection, told apart before anything
is touched — with the turns' *order* as new context: a deflection or a stale
grant that only bites because of an earlier turn is the multi-turn find.

The shipped bank is small and reviewed, one conversation per cross-turn mode
(grant reuse and ceremony, enforcement mid-thread, a grantless teach before a
scoped fact, a redirect before a real question, an honest abstention before an
answer). It grows the way the single-turn set does — the paid two-model run
over it is the number `docs/generalization.md` §10 is waiting on; until then the
machinery is proven key-free in CI and the doc says so plainly.
