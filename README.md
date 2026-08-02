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
- [ ] Mutation crucible: every Accord article gets failure injections that
      must be denied with the article's named violation
- [ ] Two-model evaluation with published numbers
- [ ] Demo UI: chat + live compliance console + sabotage buttons

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
| IA-1 | Know Your Trainer | — phase 3 |
| IA-2 | Certified Facts Only | 4 |
| IA-3 | No Fabrication (the MissingNo Clause) | 3 |
| IA-4 | Complete Answers Carry Certificates | 3 |
| IA-5 | Restricted Species | — phase 2 |
| IA-6 | Disclosures Must Be Seen | — phase 4 |
| IA-7 | What Was Shown Is What Executes | — phase 5 |
| IA-8 | Only the Trainer Speaks for the Trainer | — phase 3 |
| IA-9 | Irreversible Acts Need Informed Consent | — phase 5 |
| IA-10 | The League May Replay | — phase 6 |

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
