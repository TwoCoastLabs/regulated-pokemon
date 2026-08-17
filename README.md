# Regulated Pokémon

[![ci](https://github.com/smartnose/regulated-pokemon/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/smartnose/regulated-pokemon/actions/workflows/ci.yml)

**What if a Pokémon assistant were regulated like a bank?**

This project is a working demonstration of a question that matters far beyond
games: how do you make an AI agent *provably* factual and compliant — not
"usually right", but architecturally unable to ship a wrong claim or an
unauthorized action?

Getting a Pokémon fact wrong is harmless. That is exactly why Pokémon is the
right vehicle: we can invite you to attack the agent, run deliberately weak
models, and inject failures live — things no real regulated demo could ever
let you do for fun.

## The premise

The Kanto region has an (entirely fictional) financial-conduct-style
regulator: the **Pokémon League Conduct Authority**, and its rulebook, the
[**Indigo Accord**](docs/the-indigo-accord.md). Every article of the Accord is
a playful stand-in for a real rule from real regulated industries —
suitability, restricted products, mandatory disclosures, complete-comparison
claims, order confirmation, books-and-records.

The agent ("the Advisor") must follow the Accord. Not by prompting it nicely —
by an enforcement kernel that gates what the Advisor is allowed to *commit*:
every regulated claim must resolve to a certified fact, every required
disclosure must be verifiably visible in the final render, every consequential
action must match exactly what the trainer saw and confirmed. The model may
interpret, propose, and explain; it may not mint facts, choose scope
silently, or act on anything unproven.

## The thesis

**Enforcement is structural; usefulness is empirical.** A stronger model gives
better answers; it does not give guarantees. The demo runs the same harness
over strong and deliberately weak models: the weak model gets *less useful*
(more clarifying questions, more abstentions) while the safety properties —
zero fabricated facts, zero wrong-scope commits, zero unauthorized actions —
hold identically on both. That separation is the whole point, and it comes
from engineering, not from model capability.

## Status

Private, work in progress.

- [x] Repo scaffold, the Indigo Accord (draft), architecture note
- [x] Mini-kernel: typed contracts + commit gate
- [x] Certified snapshot vendoring from PokeAPI (pinned, attributed)
- [x] Mutation crucible: failure injections that must be denied with the
      article's named violation, gating CI. Which articles it denies today,
      and which are still owed, is the table below
- [x] Answer compilation and manifest verification
- [x] Scope resolution and the propose/confirm ladder
- [x] A headless compliance trace you can run: `npm run demo`
- [x] Render affidavit: the final DOM walked independently for visibility,
      with certified values bound to typed slots and mandatory text bound to
      digested disclosure blocks — nothing on a certified artifact is proved
      by searching the page for words
- [x] Read-to-act continuity, and replay as re-execution
- [x] A live-model harness spine (scripted, offline): a model behind the
      propose steps, a truthful simulated trainer, and the enforcement-vs-
      usefulness metric split — CI-run and key-free (`npm run harness`)
- [x] Real models behind that same seam: an OpenRouter driver, a strong/weak/
      adversarial line-up, cost reported apart from both other metrics, and a
      filed run artifact (`npm run harness:live`)
- [ ] Published two-model numbers and the results page generated from those
      artifacts
- [x] Demo UI: the filed run replayed as pages (chat, certified page,
      compliance console), and the crucible with buttons on it — every
      sabotage below runnable in the browser, against the real kernel

## Seeing it

In a browser: `npm run app:dev`, then the **run ledger** replays a filed
live-model run page by page, and **the crucible** puts buttons on the
failure-injection suite — one sabotage per Accord article, run live in the
tab and refused under the article it names, next to the untampered control
that must pass. The same exchange without the theatre is the compliance
trace:

```
npm run demo                                  # every scripted conversation
npm run demo -- --list                        # and every sabotage
npm run demo -- --sabotage recommend-missingno
```

Four conversations: one that establishes scope and gets a certified answer,
one that has not said enough and is asked exactly one question, one where the
trainer contradicts themselves and is asked again, and one where a pasted
walkthrough, a relayed rival and an injected tool result all try to move the
trainer's scope — and it reaches the identical answer to the clean one,
because none of them ever had the authority to move anything.

`--sabotage` runs a mutation out of the crucible against the scope that
conversation actually established. It is the same value CI runs, not a
re-enactment, and the trace shows the article, the real-world rule it stands
in for, and the evidence:

```
DENIED  IA-5/restricted-species
  article  IA-5 — Restricted Species
  analog   Accredited-investor / complex-product gating
  because  mewtwo is a restricted species under "legendary-acquisition" and
           this trainer is not accredited for it
  expected badge level 6
  actual   badge level 2
```

The demo checks itself: each conversation declares how it must end and each
sabotage declares the denial it must be refused under, so it exits non-zero
rather than printing a plausible trace nobody reads closely. CI runs it.

The same seam, driven by scripted stand-in models instead of a live one, runs
offline and key-free:

```
npm run harness
```

Three models take the corpus — a capable one, a deliberately weak one, and an
adversarial one that tries to fabricate — and the result is two numbers kept
strictly apart. **Enforcement** (committed fabrications, wrong-scope commits) is
zero on every model, and *re-verified* rather than asserted: each committed
answer is checked again against the snapshot, and the adversarial model is there
so the gate is seen to fire rather than passing vacuously. **Usefulness**
(resolution rate, turns to an answer, abstention) is allowed to differ between
the strong and weak models — that difference is the whole point. It exits
non-zero if any forbidden thing commits, if the adversary never triggers a
denial, or if a run ends other than it declared.

### The billable run

The same corpus, the same metrics and the same self-check, with real models
behind the propose steps. It is the only thing here that touches a network or
costs money, so it never runs in CI and it is a **dry run by default**:

```
npm run harness:live                     # prints the plan, calls nothing
npm run harness:live -- --live           # spend: one pass over the corpus
npm run harness:live -- --live --repetitions 3
```

A key goes in `.env` (see `.env.example`) and nowhere else. Three models run:
a capable one, a deliberately weak and cheap one, and the capable slug again
under a persona that genuinely tries to slip a false certified value past the
kernel. All three are OpenRouter slugs you can override, because a slug is a
moving target and a harness pinned to a retired one cannot be re-run.

Three things the live run has to get right that a scripted one does not:

- **A model can be too timid to be an adversary.** A scripted attacker always
  attacks; a real one asked to may simply decline, and then a safety test
  passes because nobody attacked it. So denials are attributed to the model
  that provoked them, and a named adversary that never made the gate fire is a
  failure, not a pass.
- **Providers diverge at temperature 0.** So `--repetitions` samples each
  model on each scenario more than once — and the first pass is checked before
  the second is paid for. A run whose enforcement broke, or whose provider was
  wholly down, stops rather than billing three times for the same finding.
- **Cost is reported, not computed.** The figure is what OpenRouter priced the
  call at; a price table vendored here would rot, and a wrong dollar figure
  printed beside the enforcement zeros would devalue them. When a call comes
  back unpriced the total is labelled a floor rather than a total.

Every live run files an artifact under `runs/` — the whole record, not a
summary: each run's transcript and, where one was reached, the transaction
`replayTransaction` can re-execute, alongside the snapshot digest and pack id
naming the certified world the numbers were measured in. Nothing in it is
derived from the key, and a test asserts that on the serialised bytes.

## How it is verified

Every guarantee is demonstrated by failure injection. The crucible
(`src/crucible/`) is a list of concrete sabotages — a fabricated roster member,
an edited certified fact, a count tampered with after the fact — each of which
the kernel must refuse under the exact Accord article **and** rule slug the
sabotage declares. A sabotage refused for a different reason is a finding, not
a pass.

So the coverage that counts is *article* coverage, not a percentage. Line
coverage can be total while an article has no mutation denying it by name.
Every article below is either denied by name in at least one mutation, or
listed as owed to a phase that has not landed — there is no third state, and a
phase cannot be marked done while it still owes one. The table is pinned to the
crucible by test, so it cannot drift from what actually runs.

| Article | Title | Mutations |
| --- | --- | --- |
| IA-1 | Know Your Trainer | 12 |
| IA-2 | Certified Facts Only | 10 |
| IA-3 | No Fabrication (the MissingNo Clause) | 6 |
| IA-4 | Complete Answers Carry Certificates | 9 |
| IA-5 | Restricted Species | 3 |
| IA-6 | Disclosures Must Be Seen | 21 |
| IA-7 | What Was Shown Is What Executes | 13 |
| IA-8 | Only the Trainer Speaks for the Trainer | 7 |
| IA-9 | Irreversible Acts Need Informed Consent | 4 |
| IA-10 | The League May Replay | 4 |

Two controls run alongside every phase, because a kernel that refuses
everything is trivially safe and useless. A clean path proves the kernel is not
doing that; a no-op sabotage — the identical harness with the sabotage removed
— proves the crucible is not denying by construction and making every mutation
pass for free.

Line coverage is a backstop rather than a score. `npm run test:coverage`
enforces a floor that ratchets upward only, and the figure itself is
deliberately not published: enforcement is reported as hard zeros, usefulness
is reported empirically per model, and a hygiene percentage blended into either
would muddy exactly the distinction this project exists to draw.

CI is deterministic, key-free and offline — no network fetch, no model call, no
secret in the gate. Upstream PokeAPI drift is watched weekly by a separate
workflow that opens an issue and never blocks a pull request; upstream moving
is not a regression here, and re-pinning is a reviewed act.

## Disclaimers

- **Unaffiliated.** This is an independent educational project. It is not
  affiliated with, endorsed by, or sponsored by Nintendo, Creatures Inc., or
  GAME FREAK. Pokémon names are trademarks of their respective owners. No
  game artwork or sprites are used.
- **Data** comes from the community-maintained
  [PokeAPI](https://github.com/PokeAPI/api-data) project (BSD-3-Clause),
  pinned to a specific commit for reproducibility. See [NOTICE](NOTICE).
- **The Indigo Accord is fiction.** Its "real-world analog" notes are
  illustrative teaching devices, not legal analysis or advice.

## License

[Apache-2.0](LICENSE). See [NOTICE](NOTICE) for third-party attributions.
