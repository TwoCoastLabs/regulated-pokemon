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

## The smoke set (52)

Stratified across every disposition, every answerable claim kind, and each
surface added through epic #64 (curriculum, `typeCount`, `gameRule`, matchup,
eligibility), plus the known deflection-prone spots (a specific character, a
no-data fact, the ambiguous "what is Pokémon").

Grown from 25 to 52 (2026-08-20) to give the retrieval configuration a wider
target and a real gap analysis. The additions deepen the biggest buckets and
close two blind spots the 25-set had: **actions** (`ans-act-*` — release and
add, the IA-7 consent surface, previously unmeasured here) and the **vendored
data facts** (`data-tm-surf`, evolutions, locations — answerable now, and a
retrieval test), plus the `ans-move-power-selfdestruct` fabricated-entity trap
(finding #18) and an `off-injection` prompt-injection opener.

```
ans-fact-speed-pikachu,ans-count-electric,ans-type-count,ans-party-size,
ans-moves-per-pokemon,ans-member-zapdos-electric,ans-rank-fastest-electric,
kind-type-effectiveness,meta-what-is-pokemon,meta-what-is-game,
meta-what-is-gym-leader,meta-what-is-evolution,meta-what-is-type,
meta-first-steps,ans-rec-eligible-snorlax,kind-starter-pick,refuse-mewtwo-2,
ans-eligibility-mewtwo-8,data-catch-rate-snorlax,data-gym-leader-pewter,
meta-champion,kind-nickname,off-capital,off-pasta,data-my-team,
ans-fact-attack-machamp,ans-fact-types-charizard,ans-fact-bst-mewtwo,
ans-fact-learnset-pikachu,ans-move-power-thunderbolt,ans-move-power-selfdestruct,
data-tm-surf,ans-act-release-raticate,ans-act-add-eevee,ans-count-surf,
ans-badge-count,kind-weakness-psychic,ans-member-gyarados-water,
ans-rank-highest-bst,ans-rec-legendary-accredited,kind-best-team-elite,
kind-which-legendary,refuse-articuno-4,refuse-legendary-generic,refuse-mew-2,
data-ability-pikachu,data-shiny-odds,data-elite-four,data-berry-effect,
meta-what-is-badge,meta-what-are-stats,off-injection
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

## New-default audition (2026-08-20, N=1)

The defaults moved to open-weights models (strong `qwen/qwen3-235b-a22b-2507`,
weak `mistralai/mistral-nemo`); the smoke set is what auditioned them, plus the
first live run of the dialogue bank below. The full write-up with provenance is
[findings.md](findings.md) **Iteration 14**; the short of it:

| | `qwen3-235b` (strong) | `mistral-nemo` (weak) |
|---|---|---|
| overall | 16/25 | 9/25 |
| answerable (structured) | 11/16 (69%) | 5/16 (31%) |
| enforcement (gated commits) | **0** | **0** |
| honest-refusal on unanswerable | 60% (3/5) | 40% (2/5) |

Cost fell ~10–40× per call and enforcement stayed a hard zero — but usefulness
dropped from the closed models' 16/16 structured baseline, `qwen3-235b` by a new
failure mode the map named on sight: **shape deflection on facts** (a certified,
verified *count* where a `fact` was asked). The smoke set caught it before the
pick could ever be published as a claim — which is what the loop is for. The
alternative (`llama-3.3-70b`) was then auditioned too ([findings.md](findings.md)
**Iteration 15**): 15/25, also short of the closed baseline, but missing by
*value* (wrong stats, denied by the kernel) where `qwen3-235b` missed by *shape*
— the two halves of the gap, pointing at grounding and retrieval-gated grammar
respectively. No open model matched 16/16 structured; enforcement stayed a hard
zero on all five. Then **grounding** ([findings.md](findings.md) **Iteration
16**) closed the gap: grounded, `qwen3-235b` reaches 19/25 and `llama-3.3-70b`
21/25 — the closed defaults' marks — but whole-registry grounding inflates the
prompt ~13× and spends the cost advantage. **Retrieval** ([findings.md](findings.md)
**Iteration 17**) closes that too: grounding only the rows a question needs holds
the 88% at ~1/9th the tokens, and `qwen3-235b` with retrieval reaches **22/25** —
above the closed `gpt-5.4-mini` it replaced (19/25), and *more honest* on
unanswerable questions (a meta question retrieves nothing, so it can't deflect).
Cheaper *and* useful *and* safe: the arc the audition set out to test.

## Grown-set gap analysis (2026-08-20, 52 questions, N=1)

The set doubled to 52 and both defaults ran it retrieval-grounded (the product
config). Full write-up: [findings.md](findings.md) **Iteration 18**.

| | `qwen3-235b` | `mistral-nemo` |
|---|---|---|
| overall | 33/52 | 22/52 |
| answerable (structured) | 20/33 (61%) | 12/33 (36%) |
| enforcement (gated commits) | **0** | **0** |
| cost (52 questions) | $0.044 | $0.010 |

The 88% of the 25-set fell to 61% — a **correction, not a regression**: the small
set undersampled the kinds the model deflects. The dominant gap is **shape
deflection** (a ranking answered with a count, a matchup with a type-count, a
membership with a game-rule), and the tell is that the *same entries* deflect on
both a 235B and a 12B model — so it is claim-kind **routing**, not capability.
Retrieval fixed the value errors it was built for but cannot touch shape (a
routing decision, not a recall one); the fix the gap named is §9's
**retrieval-gated grammar** — narrow the per-call claim-kind schema to what the
question needs. Enforcement held a hard zero throughout. A smaller separable gap:
the `ans-act-*` **action** questions hit scope friction on both models.

That fix is now built and measured ([findings.md](findings.md) **Iteration 19**,
`--gated-grammar`): gating the three aggregate kinds behind nomination took
`qwen3-235b` 33 → **41/52** (answerable 61% → 79%) and `mistral-nemo` 22 →
**31/52** (36% → 61%), enforcement still a hard zero, cost slightly *down*. It
also bought two subtler wins — ungroundable questions abstain instead of
deflecting into a rule, and gated questions provoke the gate by name instead of
dodging — so it strengthened the enforcement demonstration while fixing
usefulness.

The residual's one repairable species — a named fact with a mis-recalled value
(IA-2/fact-mismatch) — is now recovered by **strip-assertion repair**
([findings.md](findings.md) **Iteration 20**, `--repair`, on by default in
`session:trace`): the system strips the assertion and the kernel reads the
certified value, with post-repair outcomes named apart in the map. Its first
live run is a case study in the accounting rule: topline `qwen3-235b`
41 → 45/52, but the `repaired` list attributes exactly **one** fix to the
mechanism (`data-tm-surf`) and **zero** on `mistral-nemo` — the rest is N=1
variance the separate accounting refuses to launder. The remaining residual is
dominated by IA-3/fabricated-entity, unrepairable by design; the doctrine's
channel-3 option (a clarifying "did you mean X?") is the lever that owns it.

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
