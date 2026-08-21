# Recovery without re-litigation

*A design note, not a finding: it records the doctrine and the open options, and
cites [findings.md](findings.md) where a claim has a number behind it.*

The naive way to make an agent more useful is a repair loop: when the verifier
denies a draft, hand the model the violations and let it try again. This
project refuses that loop — and the refusal is easy to overstate. The precise
doctrine is not "no recovery"; it is **no re-litigation**: a verdict, once
issued, is never fuel for another model attempt. Everything short of that is a
design space, and much of it is safe. This note draws the line and names what
sits on each side.

## Why the verdict is terminal

Four reasons, each load-bearing:

1. **A repair loop changes what "verified" means.** Iterating drafts against
   the gate turns the verifier into a rejection-sampling filter: "verified
   truth" degrades into "whatever survived N attempts." Worse, the violation
   list is an oracle — the cheapest repair is to *drop the denied claim and
   keep the rest*, converting a denial into a quietly partial answer that
   passes. The denial being terminal is what keeps a refusal meaning
   something.
2. **It launders the model's error rate.** First-attempt behaviour is the
   honest measurement; a retry loop hides mis-recall inside the loop the same
   way blended provider failures hide outages inside semantic rates (the
   doctrine in [CLAUDE.md](../CLAUDE.md)). The §14–§19 denial counts are
   meaningful *because* they are first-attempt.
3. **The denial is a product surface, not a failure to route around.**
   "Refused: IA-3/fabricated-entity" is the deliverable — the gate being seen
   to fire. §19 measured this directly: removing the filler escape hatch
   pushed models into *attempting* the gated thing, and the named refusal was
   the pass.
4. **No LLM in enforcement paths.** A model reasoning about violations sits
   exactly where that rule keeps the path clean.

## The four channels, and what each may recover

The useful question is not "may we retry?" but "**through which channel** does
the recovery run?" There are four, and they have sharply different rules:

> The model may be retried on **how** it said something (encoding, transport) —
> deterministically on **what** it named (fact ids, rosters) — by a human on
> **what it meant** (scope, consent) — and **never on whether it was allowed**.

### 1. Encoding & transport — retry freely, feedback must be content-free

A failure *before* the verifier ever judged content is a delivery failure, not
a verdict. Retrying it re-litigates nothing.

- **Built:** the provider retries transient transport failures (408/429/5xx)
  automatically and counts attempts (`src/harness/openrouter.ts`); provider
  errors are tallied apart from abstentions everywhere they can occur.
- **Built, and stronger than repair:** the enforced answer grammar makes most
  syntax errors *unrepresentable* rather than repairable — the §4 finding
  (constraining shape lifted the weak model more than grounding would have) is
  this channel's success story. The best syntax repair is the one that never
  has to run.
- **Built: canonical surface forms** (`canonicalizeClaims`, in the decoder).
  "Bulbasaur" is `bulbasaur` and "selfdestruct" is `self-destruct` — the same
  name in a different spelling, which the §20 residual showed was most of what
  IA-3 was catching on live models. The decoder folds case and separators and
  maps a name only when the fold lands on *exactly one* certified id
  (ambiguous keys are dropped); a matchup naming a type in the species slot
  re-slots, because type names and entity ids are disjoint. This is encoding,
  not repair: the verifier has not ruled, no verdict leaks, content stays
  verbatim and faces the same gate — and anything that is not the same name (a
  person, a concept, a dex number, an invention) maps nowhere and earns its
  IA-3 exactly as before. Reference-system translation ("144" → articuno) is
  deliberately excluded: that is a guess about intent, channel 3's business.
- **Safe to add:** one automatic re-ask on a decode failure when the endpoint
  did not enforce the grammar, with content-free feedback only — "the reply was
  not readable," never "the value was wrong." The verifier saw nothing, so
  nothing leaks. Counted separately (decode retries), so the first-attempt
  rate stays honest.

### 2. Naming — repair deterministically, by falling to the grounded shape

The grammar already carries the key affordance: a `fact` claim may *name* the
fact without asserting its value, and the kernel then reads the certified value
itself — the grounded shape (`src/harness/schema.ts`). That makes one repair
purely deterministic:

- **Built — strip-assertion resubmit** (`--repair` on the coverage runs, on by
  default in `session:trace`, `--no-repair` to file the first-attempt denial).
  On a denial whose violations are *all* IA-2/fact-mismatch, the system (not
  the model) strips the `asserted` values and re-runs the entire gate once; the
  claims fall to their name-only shape and the kernel reads the certified
  values. The model's proposal still chose the entity and the fact — the
  *intent* is its own — but the value now comes from the registry. The player
  gets the true answer instead of a denial; the mis-recall stays on the books
  (the run is marked `repaired`, the coverage map names post-repair outcomes
  apart); no verdict ever reaches the model. On-target by construction, because
  the repaired claim is the same entity and fact the model chose. Any other
  violation in the denial — a fabricated entity beside the mismatch, a gated
  recommendation — falls closed to the denial exactly as before, and a
  membership's `asserted` is never stripped (there the assertion *is* the
  claim). Capped structurally at one repair.
- **Not repairable here:** IA-3/fabricated-entity. The named thing does not
  exist, and any nearest-neighbour guess would be the *system* fabricating an
  interpretation. That either stays a denial or moves to channel 3.

### 3. Meaning — recover through the person, on the ladder that already exists

Ambiguity is repaired by asking, never by inferring — and the machinery is
already the propose/confirm ladder and the pack's own clarifying questions:

- **Built:** scope escalation (`src/session/session.ts`) — a draft needing an
  unestablished dimension goes back to gathering and costs a question, not a
  denial. Deliberately redundant with the kernel (which would refuse anyway);
  it is UX recovery, in code, ahead of the seam.
- **Built:** the visitor's retry button re-runs an abstained exchange; the
  confirm ladder prices interpretation into recorded witnesses; consent on the
  attested page is the act path's recovery point — and the seam re-runs *in
  full* at consent, so commit never trusts the probe (lesson #8).
- **Open option:** an IA-3 denial on a near-miss name could fall to a
  clarifying proposal ("did you mean X?") — recovery via confirmation, where a
  human's yes commits it, exactly as scope candidates work today.

### 4. Permission — terminal, always

An authorization denial (IA-5 gated advice, IA-7 consent, scope-window
violations) is never fed back, never rephrased around, never softened by any
recovery channel. You do not hand an agent the reason it was refused permission
and let it try other words. This is the floor the other three channels stand
on, and it is what "fail closed" means at the recovery layer.

## The accounting rule that makes any of it safe

Whatever recovers, the run must stay honest about it:

- **Full re-verify, never a delta.** A repaired draft re-enters the entire
  gate from the top — a recovery that re-checks only the flagged item is
  lesson #2's trap (a confirmation commits the challenged mappings, not
  completeness) rebuilt one layer up.
- **Two numbers, never one.** First-attempt and post-recovery rates are
  reported apart, like enforcement and usefulness are — a recovery that is
  worth having survives being visible.
- **Caps, not loops.** Every recovery channel is bounded (the ladder's
  `MAX_LADDER_TURNS` is the pattern); an unbounded retry is a search.

## The enterprise one-liner

Content denials may be recovered — deterministically where the grammar's
grounded shapes allow it, through a human where meaning is at stake, freely at
the transport layer — under caps and separate accounting, with full
re-verification. **Authorization denials are terminal.** That sentence is the
whole doctrine, and every mechanism above is an instance of it.
