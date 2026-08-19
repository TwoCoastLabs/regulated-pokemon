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
