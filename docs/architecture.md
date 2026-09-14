# Architecture

A deliberately small, readable enforcement kernel. The target is ~1–2k lines
of TypeScript that a reader can hold in their head, where every module maps
to an article of [the Indigo Accord](the-indigo-accord.md) and every
guarantee is demonstrated by a failure-injection test.

## The shape

*The mechanism of one live turn — every model call named, every deterministic
step beside it, and both prompts section by section — is drawn in
[session-flow.md](session-flow.md). Read it after this section: this is the
shape, that is the motion.*

```
trainer message
   │
   ▼
Scope resolution (Art. I, V, VIII)      →  ScopeGrant
   │   typed dimensions; model proposes, trainer confirms, kernel binds
   ▼
Answer compilation (Art. II, III, IV)   →  AnswerManifest
   │   claims bound to fact IDs in a pinned CertifiedSnapshot;
   │   counts/lists from ClosedRoster objects; triggered Exhibits attached
   ▼
Render + verification (Art. VI)         →  RenderAffidavit
   │   the final DOM is walked independently; certified values bound to
   │   typed slots, mandatory text to digested blocks, all other text to
   │   a copy catalogue; artifact digest derived from what is shown
   ▼
Confirmation (Art. VII, IX)             →  ConfirmationEvent
   │   binds the exact artifact digest the trainer saw, on the trainer's
   │   own channel
   ▼
Action gate (Art. VII, IX)              →  ActionGrant → execute
       the act is a claim in the certified answer, so it is on the page the
       trainer confirmed and an irreversible one owes its consent notice
       under Art. VI; the chain is re-verified at the moment of execution,
       and any break anywhere denies the action with a named violation
```

The hypothesis this shape exists to test is two-sided: **a governed agent
can be both provably compliant and useful enough to ship, and the two come
from different places.** Compliance comes from the architecture below.
Usefulness comes from layers the operator owns — retrieval, grammar, data,
dialogue, and the model as a replaceable input — and the claim is that the
*governance tax* on usefulness (what the kernel costs in answers, measured
against the same model ungoverned on the same questions) can be driven to a
product-grade floor by those layers alone. Both halves are north stars, and
neither may be traded for the other: a direction that lifts usefulness only
by weakening a check is wrong, not the check. The measured form of each is
in [generalization.md](generalization.md) §11, "The north stars".

Two properties are non-negotiable and testable:

- **Fail closed.** Every stage that cannot prove, refuses. The refusal names
  its article (`IA-3/fabricated-entity`, `IA-6/exhibit-hidden-collapsed-details`, …).
- **Model-agnostic guarantees.** The LLM sits only inside "propose" steps
  (interpret wording, draft prose, suggest candidates). No model output
  crosses a commit boundary without deterministic verification. Swapping a
  strong model for a weak one may change how often the pipeline reaches a
  useful answer — never whether an unproven claim or action can ship.

One property is empirical and has a bar rather than a proof:

- **Usefulness is rebuilt, not rented.** When a governed agent underperforms,
  the residual factors into named layers, each with a deterministic or
  training-time fix that never touches the gate. The falsifier: the
  governance tax stops shrinking under operator-owned fixes and only a
  stronger model moves it. That would mean usefulness came from model
  capability after all, and the product story would collapse to "buy the
  best model and bolt on a checker."

## Core contracts (fresh, minimal)

```ts
TrainerScope        // typed dimensions: version, region, badge level, basis
ScopeTranscript     // the recorded conversation: utterances with the channel
                    //   they arrived on, proposals, and confirmations
ScopeBinding        // one dimension, its value, the evidence, and the route
                    //   it took — matched directly, or confirmed
ScopeGrant          // scope + bindings + evidence digest + validity window
CertifiedSnapshot   // pinned registry version (PokeAPI commit)
ClosedRoster        // closed-world certified set: members + cardinality
Claim               // fact | count | membership | ranking | recommendation |
                    //   action, each carrying what it asserted, bound to
                    //   fact IDs — an act is part of the answer, not a
                    //   message that follows one
AccordPack          // versioned policy data: badge gates, the closed action
                    //   registry and what is irreversible, triggered
                    //   exhibits, approved locales, formats, renderer copy
Exhibit             // a governed display unit and the disclosure block it owes
DisclosureBlockRef  // mandatory text named by id, version, locale and digest
AnswerManifest      // claims + rosters + exhibits + snapshot + pack + grant
RenderPlan          // the closed list of units the artifact must show, the
                    //   exact string each slot must hold, and the block each
                    //   disclosure must carry — all resolved for one locale
RenderAffidavit     // derived from the final DOM: visibility + digest
ConfirmationEvent   // trainer's confirmation of the exact artifact digest,
                    //   carrying the channel it arrived on
ActionGrant         // one action bound to txn + confirmation + entity + scope
ActionRecord        // everything a verdict about an act may depend on: the
                    //   manifest, the artifact, the affidavit, the
                    //   confirmation, the grant, and the moment of execution
Violation           // { article, rule, message, expected, actual }
```

These are written fresh for this project. They intentionally cover only what
the Accord needs — one region, one trainer, in-memory registry. Multi-tenant
concerns, external policy engines, and enterprise audit infrastructure are
out of scope here by design.

## Testing philosophy: the crucible

Every article ships with mutations — concrete sabotage of the pipeline that
must be denied with that article's named violation:

- Art. I / VIII: bind scope from a rival's reported wish, a quoted guide, an
  injected tool result, a negation, or a catalogue question → each denied.
- Art. III: inject MissingNo into the roster → denied by name.
- Art. IV: change the visible count; drop a member → denied.
- Art. VI: hide the Selfdestruct warning via `display:none`, `aria-hidden`,
  a collapsed `<details>`; reword or truncate its approved text; print a
  different number in a certified slot; smuggle in a sentence of the
  renderer's own; localise a flawless page against another plan → each denied.
- Art. VII: act on something the answer only talked about; hide the card
  naming the act; confirm a doctored digest; confirm before render; borrow a
  confirmation from another transaction; execute after scope expiry → each
  denied.
- Art. IX: drop an irreversible act's consent notice, aim it at a reversible
  act, hide it on the page; and a pack declaring an act irreversible with
  nothing to disclose it, refused at load → each denied under IA-9 by the
  Art. VI machinery, because the articles compose.
- Clean-path control: the unmutated pipeline must pass with zero violations
  (no fail-closed theater).

The crucible is deterministic (no LLM, no network) and runs in CI. Live
model evaluation is a separate, explicitly billable harness that measures
*usefulness* per model while asserting the same safety invariants hold.

## Stack

- TypeScript, Node 22, vitest. Kernel first, UI later.
- Data: vendored snapshot from `PokeAPI/api-data`, pinned by commit, BSD-3
  attribution preserved (`data/` + `scripts/fetch-snapshot`). No artwork.
- UI (later): single web app — chat pane + live compliance console + sabotage
  buttons + governed-vs-raw toggle + strong-vs-weak model scoreboard.
- LLM access (later): OpenRouter; cheap models by design — the weak model is
  a feature, not a compromise.

## The kernel-size decision (epic #94, slice 4)

The kernel was pitched at ~1–2k lines and has grown past it, deliberately.
The rule adopted when the first usefulness mechanism (sentence templates,
IA-6) landed: **the teaching kernel stays small per mechanism, not in
total.** Each mechanism ships alone — its own pack data, derivation,
verifier, crucible mutation and named denials — and must be readable in one
sitting; the sum may grow. What is *not* accepted is a general engine: a
template is a string with typed holes filled through the closed formatter
registry, not a template language, exactly as the formatter registry is a
set of reviewed functions and not a transformation language. Policy stays
data; expressiveness stays code under review; and every addition is gated on
a bank demanding it (epic #94's discipline), never on architecture wanting
it.

Pack versions are kept, not overwritten: a record replays under the pack id
it pinned (`data/accord-pack/v1.json` is frozen; sentences arrived in
`v2.json`; the grouping policy — a listing as one sentence, a profile as
one card — in `v3.json`, because 23 filed pages were planned one sentence
per claim and must replay that way), and the replay sweep resolves packs by
the record's pin — policy is versioned data, and IA-10 is why the versions
stay on the shelf.

## Non-goals

- Not a guardrails/classifier system: no probabilistic "is this toxic/false"
  scoring anywhere in an enforcement path.
- Not a framework: this is a reference implementation meant to be read.
- Not affiliated with or derived from any proprietary system; contracts and
  code here are written from first principles for this demo.
