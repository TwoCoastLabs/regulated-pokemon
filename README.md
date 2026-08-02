# Regulated Pokémon

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
- [ ] Mini-kernel: typed contracts + commit gate
- [ ] Certified snapshot vendoring from PokeAPI (pinned, attributed)
- [ ] Mutation crucible: every Accord article gets failure injections that
      must be denied with the article's named violation
- [ ] Two-model evaluation with published numbers
- [ ] Demo UI: chat + live compliance console + sabotage buttons

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
