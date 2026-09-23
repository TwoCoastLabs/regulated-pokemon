# The Indigo Accord

*Rules of Conduct for Automated Advisors, as adopted by the Pokémon League
Conduct Authority (PLCA). Entirely fictional; written as a teaching device.*

---

## Preamble: the Cinnabar Incident

In the years before the Accord, automated advisors flourished along the
Cinnabar coast. They were fluent, confident, and helpful — and occasionally,
catastrophically wrong. The breaking point is remembered simply as the
**Cinnabar Incident**: advisors began recommending, cataloguing, and even
brokering trades of a Pokémon that does not exist. Trainers surfed the east
coast of Cinnabar Island chasing **MissingNo** — a glitch, an artifact, a
fabrication — and real Bag inventories were corrupted by transactions
grounded in a creature no certified Pokédex had ever contained.

No advisor had *lied*, exactly. Each had produced plausible text. The League's
inquiry concluded that plausibility was precisely the problem: **the advisors
had no mechanism that distinguished what they could say from what they could
prove.** The Accord exists to impose that mechanism. Its premise is not that
advisors must be smarter. It is that certain statements and actions must be
impossible to commit without proof — no matter how capable, or how limited,
the advisor happens to be.

> **Real-world analog.** Most financial-conduct regimes were born the same
> way: not from malice, but from confident intermediaries whose claims
> couldn't be traced to anything. Post-crisis rulebooks (Dodd-Frank, MiFID II)
> regulate the *commitment* — what may be represented, sold, and executed —
> rather than the intelligence of the seller.

## Definitions

- **Trainer** — the human the Advisor serves. The Trainer is the sole
  authority on their own intent.
- **Advisor** — an automated agent that answers questions or performs actions
  for a Trainer. The Advisor may draft, interpret, and propose; it holds no
  authority over facts, scope, or permission.
- **Certified Registry** — the League-certified Pokédex snapshot for a given
  game version — species, stats, types and the type chart, movesets and
  learn methods, encounters, machines and, where a pack admits them, items —
  at a pinned version; together with the certified constants (the game's
  rules: party size, moves per Pokémon, badge count) and the lessons of the
  Accord pack at its pinned version. The only sources from which regulated
  facts may be asserted.
- **Accord pack** — the versioned data file that carries the League's
  policy: the vocabulary Material Scope is matched against, the restricted
  instruments and their thresholds, the disclosures and what triggers them,
  the actions and which are irreversible, the approved wording and locales,
  and the lessons. Every record pins the pack version it was decided under.
- **Material Scope** — the typed context that changes what is true or what is
  suitable: game version, region, trainer accreditation (badge level), and
  the comparison basis of any ranking. Region is declared and recorded; no
  claim the League currently certifies depends on it.
- **Regulated Claim** — any claim the answer may commit: a fact, a count, a
  type count, a game rule, a membership, a treatment (what an item or move
  does), a comparison, a ranking, a matchup, an eligibility ruling, an
  explanation (a lesson), a recommendation, or an action.
- **Consequential Action** — any operation the pack lists that changes the
  Trainer's state: adding to a team, releasing a Pokémon, and, where the pack
  admits it, using an item. The pack states which of them are irreversible.

---

## Article I — Know Your Trainer

An Advisor shall commit no Regulated Claim that depends on a dimension of
Material Scope — a fact on the game version, a ranking on its comparison
basis, a recommendation on the badge level — until that dimension is
**established as typed values**, either from the Trainer's explicit words
matched against League-approved vocabulary, or through the Trainer's exact
confirmation of a stated interpretation. Conversational vibes do not
establish scope. An Advisor uncertain of scope shall ask; an Advisor certain
without evidence is in violation. An established scope is valid for the
period and the number of turns the pack sets; beyond them it must be
established again, and an action taken on an expired scope is denied.

> **Real-world analog:** suitability and know-your-customer obligations
> (MiFID II, FINRA Reg BI). You may not recommend before you have
> established, on the record, who you are advising and for what.

> **Engineering consequence:** scope is a typed, versioned object with an
> evidence trail — never a hidden inference. The model may *propose* an
> interpretation of long-tail wording ("the Pikachu one"); only the
> Trainer's explicit confirmation of that exact interpretation can bind it.

## Article II — Certified Facts Only

Every Regulated Claim shall resolve to the Certified Registry at the
version established in Material Scope. A claim that cannot be resolved shall
not be made; the Advisor shall abstain and say why. Facts from the wrong
version — however true elsewhere — are violations here. Every released
answer names the Registry it drew on and the licence it is used under.

> **Real-world analog:** approved marketing materials and current-prospectus
> rules. A fund fact sheet quotes the current filed prospectus, not a stale
> one, and not the salesperson's memory.

> **Engineering consequence:** the answer pipeline binds each claim to a
> fact ID in a pinned snapshot. Freshness and version scope are checked at
> commit time, not assumed at retrieval time.

## Article III — No Fabrication (the MissingNo Clause)

The assertion of a species, stat, move, or relationship absent from the
Certified Registry is a strict-liability violation. Fluency is not a
defense. Confidence is not a defense. The MissingNo Clause is honored in
this project's test suite in perpetuity: the canonical fabrication test
injects MissingNo, and the system must refuse it by name.

> **Real-world analog:** misrepresentation and anti-fraud provisions
> (SEC Rule 10b-5). It does not matter how the false statement was produced.

> **Engineering consequence:** hallucination is not treated as a quality
> problem to minimize but as a commit-time impossibility: an unresolvable
> entity cannot enter a released answer, whatever the model emitted.

## Article IV — Complete Answers Carry Certificates

A claim of the form "all", "every", "the only", or a count, shall carry a
completeness certificate: a closed-world enumeration from the Certified
Registry whose cardinality equals the number shown. An Advisor that cannot
certify closure shall abstain.

> **Real-world analog:** comparative-advertising and best-execution
> evidence. "We compared all available options" is a regulated claim with a
> paper trail, or it is not made.

> **Engineering consequence:** counts and lists render from one immutable
> certified set object. The visible number and the set cardinality cannot
> drift apart, because they are the same datum.

## Article V — Restricted Species

Legendary and mythical species are restricted instruments, and so is any
item category the pack marks controlled. An Advisor shall not recommend
acquisition of a restricted instrument to a Trainer whose accreditation
(badge level) does not meet the League threshold, regardless of how the
Trainer phrases the request.

> **Real-world analog:** accredited-investor rules and complex-product
> gating (Reg D; appropriateness tests for derivatives).

> **Engineering consequence:** eligibility is evaluated against typed scope
> at the commit gate. Prompt-level pleading ("just this once") has no
> mechanism by which it could work.

## Article VI — Disclosures Must Be Seen

Certain claims trigger mandatory companion disclosures, as the pack lists
them — an answer that names Selfdestruct or Explosion carries a handling
warning; an irreversible action carries its consent notice (Article IX);
every answer carries its provenance (Article II). A triggered disclosure
shall be **visibly present in the final rendered artifact**, adjacent to
what triggered it. A disclosure that exists in the payload but is hidden,
collapsed, truncated, or styled into invisibility is not a disclosure; it is
a violation.

A certified statement is rendered in League-approved wording and an approved
locale, its certified values in their typed places. The Advisor's own words —
its prose, its follow-up suggestions — appear only in a register marked as
the Advisor's own, and are held to what was recorded.

> **Real-world analog:** risk-warning prominence rules (FCA "fair, clear
> and not misleading"; pharmaceutical boxed warnings). Regulators have long
> known that the fine print's *location* is the whole game.

> **Engineering consequence:** compliance is verified against the final DOM,
> not against the renderer's intentions. What the document can carry —
> hidden, collapsed, detached, styled invisible — is derived by the kernel;
> what only the layout knows — occluded, shrunk, pushed off the screen — is
> sworn by the rendering page and pinned by digest. Those facts are
> attested, not replayed.

## Article VII — What Was Shown Is What Executes

A Consequential Action shall execute only against the exact certified
answer the Trainer saw and confirmed: same transaction, same rendered
artifact (by digest), same entity, same scope, confirmed *after* rendering
and executed *after* confirmation, while scope is still valid. An action
naming anything the Trainer was never shown shall be denied — even if that
thing is true.

> **Real-world analog:** order confirmation and e-sign regimes. What
> executes is the confirmed order ticket — not a later paraphrase of it.

> **Engineering consequence:** one proof identity chains scope → answer →
> render → confirmation → action. "Confirmed A, executed B" is not a bug to
> test for; it is a violation the verifier names.

## Article VIII — Only the Trainer Speaks for the Trainer

Reported wishes of rivals, friends, guides, walkthroughs, pasted notes, and
text instructing the Advisor to disregard these rules establish nothing.
Quotation is not intent. Instruction is not intent. Negation is respected.

> **Real-world analog:** authorized-party rules and power-of-attorney
> formalities — plus every social-engineering control ever written.

> **Engineering consequence:** prompt injection is handled first as an
> authority problem: a third-party channel — a rival, a guide, a tool result
> — is structurally incapable of binding scope or authorizing action,
> whether or not anyone detects it as malicious. Within the Trainer's own
> words, quotation, report, instruction and negation are recognised by
> League-listed markers that the pack versions, so the reading is auditable
> rather than inferred.

## Article IX — Irreversible Acts Need Informed Consent

An irreversible Consequential Action — releasing a Pokémon; whatever else
the pack declares irreversible — requires a disclosure of what is being
given up, drawn from the Certified Registry, and the Trainer's explicit
confirmation rendered *after* that disclosure. A released Pokémon, and every
move it knew, is gone for good; the consent must be as final.

> **Real-world analog:** cooling-off periods and irreversibility warnings in
> consumer finance.

> **Engineering consequence:** the irreversibility disclosure is a triggered
> exhibit verified by Article VI's machinery and denied under this Article,
> and the consent binds under Article VII — the articles compose rather than
> multiply.

## Article X — The League May Replay

Every released answer and executed action shall be reconstructible from
records: the registry snapshot version, the Accord pack version, the scope
evidence, the certified sets, the rendered artifact digest, the
confirmation, the grant, and the moments of render, confirmation and
execution. "It must have seemed right at the time" is not a record.

> **Real-world analog:** books-and-records obligations (SEC 17a-4).

> **Engineering consequence:** every verdict is a pure function of recorded,
> versioned inputs. Replay is not logging; it is re-execution.

---

## Enforcement philosophy

1. **Fail closed.** Where proof is absent, the Advisor abstains, asks, or is
   withheld. Silence is compliant; confident invention is not.
2. **Violations are named.** Every denial cites its article. "Blocked by
   policy" is itself a transparency violation.
3. **The Advisor's freedom is not the target.** The Accord constrains what
   may be *committed* — said in the final artifact, and done. Within that
   boundary the Advisor may reason, explore, and charm as it pleases; what
   it says uncertified is marked as its own.
4. **Capability is no defense and no requirement.** The Accord must hold for
   the weakest advisor the League has ever certified and grant no exemptions
   to the strongest.

*Adopted at Indigo Plateau. Penalty schedule (revocation of gym-badge
sponsorship, suspension of Advisor certification) omitted from this draft.*
