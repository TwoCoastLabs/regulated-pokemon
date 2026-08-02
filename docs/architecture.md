# Architecture

A deliberately small, readable enforcement kernel. The target is ~1–2k lines
of TypeScript that a reader can hold in their head, where every module maps
to an article of [the Indigo Accord](the-indigo-accord.md) and every
guarantee is demonstrated by a failure-injection test.

## The shape

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
   │   the final DOM is walked independently; visibility and required
   │   fragments verified; artifact digest derived from what is shown
   ▼
Confirmation (Art. VII, IX)             →  ConfirmationEvent
   │   binds the exact artifact digest the trainer saw
   ▼
Action gate (Art. VII)                  →  ActionGrant → execute
       one proof identity across the whole chain; any break anywhere
       denies the action with a named article violation
```

Two properties are non-negotiable and testable:

- **Fail closed.** Every stage that cannot prove, refuses. The refusal names
  its article (`IA-3/fabricated-entity`, `IA-6/exhibit-hidden`, …).
- **Model-agnostic guarantees.** The LLM sits only inside "propose" steps
  (interpret wording, draft prose, suggest candidates). No model output
  crosses a commit boundary without deterministic verification. Swapping a
  strong model for a weak one may change how often the pipeline reaches a
  useful answer — never whether an unproven claim or action can ship.

## Core contracts (fresh, minimal)

```ts
TrainerScope        // typed dimensions: version, region, badge level, basis
ScopeGrant          // scope + evidence digest + validity window
CertifiedSnapshot   // pinned registry version (PokeAPI commit)
ClosedRoster        // closed-world certified set: members + cardinality
Claim               // fact | count | membership | ranking, bound to fact IDs
Exhibit             // a governed display unit with required visible fragments
AnswerManifest      // claims + exhibits + snapshot + scope grant, one txn id
RenderAffidavit     // derived from the final DOM: visibility + digest
ConfirmationEvent   // trainer's confirmation of the exact artifact digest
ActionGrant         // one action bound to txn + confirmation + entity + scope
Violation           // { article, rule, message, expected, actual }
```

These are written fresh for this project. They intentionally cover only what
the Accord needs — one region, one trainer, in-memory registry. Multi-tenant
concerns, external policy engines, and enterprise audit infrastructure are
out of scope here by design.

## Testing philosophy: the crucible

Every article ships with mutations — concrete sabotage of the pipeline that
must be denied with that article's named violation:

- Art. III: inject MissingNo into the roster → denied by name.
- Art. IV: change the visible count; drop a member → denied.
- Art. VI: hide the Selfdestruct warning via `display:none`, `aria-hidden`,
  a collapsed `<details>`, truncation → each denied.
- Art. VII: act on an entity never displayed; confirm a doctored digest;
  confirm before render; execute after scope expiry → each denied.
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

## Non-goals

- Not a guardrails/classifier system: no probabilistic "is this toxic/false"
  scoring anywhere in an enforcement path.
- Not a framework: this is a reference implementation meant to be read.
- Not affiliated with or derived from any proprietary system; contracts and
  code here are written from first principles for this demo.
