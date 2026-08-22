# Lessons from the usefulness arc

*A design note, not a finding: it reads findings §§14–22 as one experiment and
names what that experiment taught. Every claim with a number behind it cites
the section that filed it; the numbers live there, not here.*

The arc, in one sentence: the defaults were swapped to deliberately cheap
open-weights models (§14), usefulness cratered in two distinct styles (§15),
and it was rebuilt layer by deterministic layer — retrieval (§17), gated
grammar (§19), strip-assertion repair (§20), canonical surface forms (§21) —
until the strong default held a measured 43-entry guaranteed core with zero
deterministic gaps on the smoke set (§22), while enforcement stayed a hard
zero on every model, every configuration, and every repetition throughout.
Six lessons, then the three directions they open.

## 1. A usefulness gap decomposes into named layers, each with a deterministic fix

"The cheap model is worse" turned out to be five different problems wearing
one topline: mis-recalled *values* (fixed by retrieval grounding, §17),
*shape* deflection (fixed by narrowing the grammar to each question's
nominated kinds, §19), wrong *surface forms* the decoder refused to read
(fixed by canonical folding, §21), recoverable mis-recall (recovered by
strip-assertion resubmit, §20), and true *content debt* (named per entry by
§22's stable-fail list). Not one fix touched the model, and not one touched
enforcement. The general form: when a governed agent underperforms, factor
the residual before buying capability — each factor belongs to a layer you
control, and the record of each miss says which.

## 2. The instrument is half the work, and bookkeeping — not vigilance — prevents overclaiming

Nearly every iteration was readable only because a previous one improved the
measurement: the gated-advice flag re-verified from records killed a phantom
enforcement escalation (§18); the `repaired` accounting kept a +4 topline
from being credited to a mechanism that had earned exactly +1 (§20); the
repetition band kept a topline *drop* from reading as a regression when the
mechanism had only added correct readings (§21). In each case the honest
number was not protected by care — it was the only number the instrument
would produce. That is fail-closed applied to evaluation itself, and it is
why the arc could run at speed without its claims decaying.

## 3. Nondeterminism is layered; decompose it or chase ghosts

Three separate noise sources, measured apart (§22): per-call sampling
(within-run bands of width 2–3 on 52), a slower between-run component that
exceeds it (same-config toplines a day apart differing by more than the
band), and provider transport (7 of the weak model's 16 flaky entries failed
*only* in repetitions carrying provider errors). Each demands a different
response — sample within one artifact, require a cross-run delta to clear
the band on both ends, and never let an availability window read as model
behaviour. A team that pools these into one rate will fix things that were
never broken and ship regressions that never show.

## 4. Enforcement and usefulness never once needed the same tool

Every usefulness gain came from propose-side scaffolding; every enforcement
guarantee came from the kernel — and across the arc's live samples the churn
itself proved bounded: outcomes flip between resolved, denied, and abstained,
never across the gate (§22). The operational consequence is the arc's
quietest but most valuable property: models, grounding, grammar, and repair
were all changed aggressively *without ever re-certifying safety*, because
safety was never delegated to anything being changed.

## 5. The records overruled the plans — and the working cadence fell out of that

Twice a planned slice died on contact with the filed records: the
clarify-ladder plan for fabricated entities dissolved when the violations
turned out to be spellings (§21), and the repair-uplift story shrank to one
attributable fix when the accounting was consulted (§20). The cadence that
survived: read the filed violations → name the failure class → build the
smallest deterministic mechanism that reads what the model *plainly said*
(never what it might have meant) → measure at known noise → record with
provenance. Every step is model-agnostic and leaves an artifact.

## 6. The weak model stress-tests the measurement more than the enforcement

The doctrine says the weak model is a feature because invariants that hold on
it are architectural. True — but on this arc its actual catches were
instrument failures, not near-breaches: the vacuous safety test (§19's
gate-provocation reading), the transport/semantics split (§22), the
deflection habit that made a pass look like a dodge (§18). The weak model is
less a second safety check than an adversary of your evaluation: it finds
the places where the harness would have flattered you.

## The three directions this opens

- **The enterprise framing** — lesson 5's cadence and lesson 1's taxonomy as
  an operating discipline: who owns each layer of the residual, what the
  band means as an SLO, what the artifact chain is evidence *of*. Taken
  first; written as [generalization.md](generalization.md) §11.
- **The measurement doctrine as a method note** — lessons 2, 3 and 6 as a
  standalone "how to evaluate a governed agent": banded toplines, decomposed
  noise, attribution accounting, first-attempt separation, and the vacuity
  checks that keep a safety pass from being a model too timid to test.
- **The critical pass** — what the arc has *not* demonstrated, stated as
  precisely as what it has: one domain, one reviewed bank, a cooperative
  scripted trainer, N=3 on a 52-entry smoke set, no adversarial user, no
  cross-session state. Every lesson above holds inside that boundary; the
  boundary is the next thing to push.
