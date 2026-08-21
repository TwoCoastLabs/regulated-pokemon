# Beyond Kanto: generalizing the architecture

This project answers a question with a toy so the answer is checkable: **can an
AI agent be useful and *architecturally* unable to ship a wrong claim or an
unauthorized act?** The demo's two axes are the two halves of that sentence.
Usefulness is empirical — measured per model, per corpus, with error bars
(docs/findings.md). Non-fabrication is structural — enforced by construction
and demonstrated by failure injection, not by a benchmark.

The toy is Pokémon. The intended reader works in wealth management, banking,
healthcare, or safety-critical operations. This document is the bridge: an
audit of what in the built system generalizes, what has to be re-instantiated
per domain, what it costs to operate — and what honestly does not carry.

One sentence of orientation for that reader: everything below assumes an agent
whose job is **high-stakes claims and acts against a governed body of
knowledge** — advice, disclosures, transactions. For open-ended creative or
analytical work, this architecture is the wrong tool, and says so.

## 1. The portable core: invariants, not code

The audit's headline: the kernel's *shape* is domain-free, and its *types* are
deliberately not. What generalizes is a set of invariants that survived every
crucible mutation and live run this project has thrown at them:

1. **The model only proposes.** An LLM lives exclusively inside "propose"
   steps — interpret wording, draft a candidate answer, suggest a value.
   Nothing it emits crosses a commit boundary without deterministic
   verification. This is the load-bearing wall; every other invariant leans
   on it.
2. **Authority is a channel, not a judgment.** Every utterance carries the
   source the transport assigned it, and only the principal's channel can
   bind their intent. Prompt injection becomes an authority problem, not a
   detection problem: a pasted document or tool result is *read* and can
   never *bind*. No classifier decides what is "hostile."
3. **Closed vocabularies everywhere a value is minted.** Scope values, claim
   kinds, roster criteria, fact ids, formats, copy: each is a finite,
   reviewed list. There is no text anyone can compose that makes a closed
   vocabulary emit a value outside itself. Detection is a fallback; closure
   is the mechanism.
4. **Interpretation binds only through consent — priced by ambiguity.**
   Nothing personalized is released until the principal's material scope is
   established, and how a statement gets to bind depends on how ambiguous it
   is. The rule is a gradient, and each step up adds one more *recorded
   witness* rather than one more guess:

   ```
   what the trainer did                 how it binds              model  clicks
   ───────────────────────────────────────────────────────────────────────────
   "I'm playing Red and Blue"           deterministic match:        0      0
                                        value word + context word,
                                        straight from the sentence

   asked "Which version are you         answer route: the recorded  0      0
   playing — Red/Blue, or Yellow?",     question supplies the
   answered "Red"                       context the bare word lacks

   said "whichever is quickest"         propose/confirm: the model  1      1
                                        offers comparisonBasis =
                                        base-speed; only the yes —
                                        bound to that exact
                                        candidate by digest — binds

   picked "Red/Blue" from a dropdown    structured input: the
                                        closed vocabulary worn as   0      1
                                        a form control
   ───────────────────────────────────────────────────────────────────────────
   more ambiguity → one more witness in the record: first the question,
   then the shown-and-confirmed candidate. Never a silent model guess.
   ```

   The worked example is one conversation: *"what types are there?"* → the
   pack asks which version → *"Red"* binds with no model call and no card
   (the question is in the transcript, so the leniency is auditable) → *"the
   quickest one?"* → one proposal card, one yes, and the yes is cryptographic
   consent to that candidate, not vibes. Ambiguous wording costs exactly as
   much ceremony as it carries risk — and no more.
5. **Every claim is recomputed, never trusted.** A stated fact is re-resolved
   against the pinned knowledge base; a count *is* its certified set's
   cardinality; a ranking's winner is derived, not asserted. Where a value is
   derivable, the model is not even asked to state it — fabrication is
   prevented, not caught.
6. **What was shown is what was agreed to.** The final rendered artifact is
   walked independently of the renderer; certified values bind to typed
   slots, mandatory text to digest-pinned blocks, all remaining text to a
   reviewed catalogue (default-deny for prose). Consent names the digest of
   exactly that artifact, and an act re-verifies the whole chain at execution
   time.
7. **Fail closed means ask, not refuse.** A stage that cannot prove does not
   guess and does not stonewall; it asks one question, or abstains honestly.
   An empty answer is an abstention, never an empty certificate.
8. **Every denial names its rule.** `IA-5/restricted-species`, never "blocked
   by policy." A refusal that cannot be looked up cannot be audited, argued
   with, or fixed.
9. **Policy is versioned data; the record replays.** The rulebook is a
   reviewed, schema-versioned pack; every settled exchange files a record
   carrying the knowledge-base version, the pack id, the transcript, the
   grant, the artifact digest — and a verdict is reproducible from the record
   alone. Books-and-records is a property, not a promise.
10. **The evaluation is adversarial and two-sided.** Every rule has a
    failure-injection test that must be denied by name (a crucible), plus an
    untampered control (no fail-closed theater). Enforcement metrics are hard
    zeros on every run; usefulness is empirical and reported separately, on
    strong *and deliberately weak* models — an invariant that only holds on
    the good model is a model behavior, not an architecture.

These ten are the product. The Pokémon kernel is ~a few thousand lines that a
reviewer can actually read, which is itself part of the claim: the enforcement
core of a regulated agent can be small enough to audit line by line.

## 2. What a port re-instantiates (and why it is not a config file)

The type vocabulary is compiled in on purpose. `TrainerScope` has exactly four
dimensions; claims come in eleven kinds; roster criteria in five;
formatters in seven. Making those a configuration language would recreate the
thing this design exists to avoid — a policy engine expressive enough to hide
rules in, sitting in an enforcement path. The stated non-goal ("not a
framework") is a design decision, not a disclaimer: **this generalizes as a
reference architecture and a discipline checklist, not as an engine you
configure.** A port is a re-instantiation — a domain team writes its own small
closed vocabularies and keeps the invariants. What that team writes:

| Seam (here) | What it is generically | Wealth-management example |
|---|---|---|
| `TrainerScope` (version/region/badges/basis) | The principal's material profile — what must be known before anything personalized is released | Jurisdiction, account type, risk tolerance, accreditation status, investment objective |
| `CertifiedSnapshot` (151 species, 163 moves) | The pinned, digested knowledge base | Approved product master, current prospectuses, rate sheets, restricted lists |
| Fact registry (`base-speed`, `move-power`…) | The closed schema of resolvable facts | Fee schedule fields, performance figures as filed, product terms |
| Claim kinds (fact/count/membership/ranking/recommendation/action) | The speech acts the agent may commit | Quote a filed figure; state portfolio membership; compare by a named metric; recommend an eligible product; place an order |
| Roster criteria (has-type, stat-at-least…) | The closed predicate language for certified sets | "funds with expense ratio ≤ X", "products approved for retail in EU" |
| Accord pack (restrictions, exhibits, vocabulary, copy, display floors) | The rulebook as versioned data | Suitability gates, mandated risk warnings and their approved wording, KYC vocabulary, disclosure prominence floors |
| Formatters | The closed presentation registry | Currency/locale rendering, as-of-date formats, APR display rules |
| Reference renderer + walker | Untrusted UI + independent reading of the final screen | Your design system + the same walker discipline |

Two things about the table matter more than its rows. First, everything on the
left column is *small* — closed lists scale with the domain's schema, not with
its corpus; adding the thousandth product to the snapshot costs nothing in the
kernel. Second, the seams are already proven seams: the demo swapped models,
renderers, and transports across them without touching enforcement.

### Where a general-purpose policy engine fits — and why this kernel abstains

The obvious challenge to the paragraph above: mature policy engines exist
(OPA/Rego, Cedar, and their kin), compliance teams already write rules in
them, and they hot-reload without redeploying anything. Why hand-roll a
closed pack instead? The trade is real, so it deserves an honest ledger
rather than a slogan.

What an engine buys: **expressiveness without kernel changes** — a new rule
is a policy diff, not a type change; **authoring leverage** — a policy team
ships rules on its own cadence, which matters enormously in a product serving
many tenants with divergent rulebooks; **ecosystem** — testing harnesses,
IDE tooling, an evaluator hardened by wide use.

What it costs, specifically against this design's claims: a general-purpose
evaluator joins the **trusted computing base** of the enforcement path, and
the thing being audited is no longer a few hundred lines of typed loader but
an engine plus every policy expressible in it — rules can now *hide* (default
decisions, negation subtleties, precedence between packages) exactly where
this architecture promises they cannot. **Replay** acquires an engine-version
pin: a verdict is reproducible only under the evaluator that produced it.
The **in-browser crucible** — the same enforcement running live in a
visitor's tab — gets heavy or impossible. And **fail-closed validation
weakens**: this pack's loader refuses a rule that cites a nonexistent
article, a threshold nobody can meet, a disclosure with no approved text — a
Turing-flavored policy cannot be exhaustively validated at load, only tested.

The resolution is about *where each belongs*, not which is better. An engine
earns its place at the **act gateway of a product** — many tenants, fast-
moving rulebooks, a dedicated policy team, decisions of the shape "may this
tool call proceed, and under what obligations." This demo's kernel guards a
larger and quieter surface — what may be *said*, shown, and consented to,
recomputed from a pinned world — and its whole evidentiary posture rests on
the rulebook being small enough to read and closed enough to validate. For a
deployment that wants both: keep the pack as the reviewed source of truth and
**compile it** into the engine's language for runtime enforcement at the
gateway. Data stays closed, diffable, and load-validated; the engine becomes
an execution detail rather than the place where policy lives. What this
design declines on principle is only the inverse — authoring policy *in* the
open-ended language and calling the result reviewable.

## 3. Industry mappings

The Accord's ten articles were reverse-engineered from real obligations; each
carries its analog in the code (`src/kernel/accord.ts`). The mapping is not a
metaphor — it is the port plan.

**Wealth management / brokerage.** The nearest fit; the articles were drawn
from it. Scope = suitability/KYC (MiFID II, Reg BI); certified facts = approved
materials and the current prospectus; restricted species = complex-product and
accredited-investor gating; disclosures-must-be-seen = FCA fair-clear-not-
misleading prominence; confirm-then-act = order confirmation/e-sign;
replay = SEC 17a-4 books and records. The demo's third zero — acts execute only
against the exact confirmed page — is the property an order-placing assistant
must prove.

**Banking operations.** Scope = customer segment, product eligibility,
jurisdiction. Snapshot = rate sheets, fee schedules, terms. Acts = payments,
standing-order changes, limit increases — with IA-8's channel discipline doing
real work: a payee name arriving in an email body or an uploaded invoice is
*read, never binding* (authorized-party rules; social-engineering and BEC
controls become structure instead of training).

**Healthcare.** Snapshot = formulary, clinical guidelines as adopted by the
institution, interaction tables — *as adopted*, which is the operational point:
the kernel certifies against the institution's pinned, versioned adoption of a
guideline, not against "the literature." Scope = the patient context a
recommendation is material to; restrictions = contraindication and
credential gates (who may be advised toward what); disclosures = consent
language whose wording is digest-pinned (informed consent as an IA-9
composition); acts = orders, referrals. The teach-vs-certify boundary is
sharper here than anywhere: patient education text must be *selected from
reviewed content, never authored* — the same selected-not-authored pattern as
the demo's copy catalogue.

**Safety-critical operations (aviation, energy, defense support).** Snapshot =
the approved procedure library, platform limits, checklists — versioned like
flight documentation. Claims = "the procedure for X, as approved, is Y";
acts = step execution with confirm-on-exact-artifact; replay = incident
reconstruction from the filed record. The weak-model doctrine matters most
here: an agent whose safety depends on the model being smart is not safe, and
this architecture's zeros are *supposed* to hold with a bad model in the loop —
that is what the strong/weak A-B exists to show.

### The read-only wedge

The mappings above describe full deployments, but they share a common first
step worth naming, because it is where the industry is actually stuck. The
reported blocker for high-stakes agents — in banking and in asset-intensive
field operations alike — is not runaway agency; it is that teams cannot trust
the system in **basic, read-only Q&A**: stating facts about an account, a
product, a well, a procedure. That is the *cheapest* slice of this
architecture, and it is severable: a pack that disables the action and
recommendation claim kinds leaves an agent that can do exactly two things —
state certified facts, or honestly abstain. No consent ceremony, no act path,
no advisory license question; the enforcement surface shrinks to the claims,
display, authority, and replay articles, and the entire adoption cost
concentrates where it belongs, in the knowledge-base certification pipeline.

The read-only case has a characteristic hazard of its own, and it is usually
misdiagnosed as hallucination: **right fact, wrong entity.** Industrial
domains are dense with near-identical subjects — two wells on one pad, two
share classes of one fund, two patients with one surname — and a model that
retrieves a perfectly true value about the wrong one produces an answer that
is *accurate, confident, and lethal*. Recomputing values does not fix this;
the claim is internally true. Two disciplines in this design address it. The
floor: the subject of every certified claim is bound to a typed, visible slot
on the artifact — the answer is at least *visibly* about the entity it is
about, never silently. The full treatment: give the subject entity the same
consent gradient scope gets — deterministic binding when the principal names
an identifier (asset IDs are the best closed vocabularies in existence), the
answer-route when the system asked "which one?", and a one-click confirmation
only under genuine ambiguity. "Well 7-A, Bakersfield pad 3 — yes?" costs a
second; the alternative is a true fact about the wrong well read out to a
crew at 2am.

## 4. Operating the knowledge base

The user-facing question — "who maintains the facts, and how do decisions stay
defensible while the facts move?" — is answered in the demo by machinery that
already runs, and each piece names the role a real deployment staffs.

**What exists today, concretely.** The knowledge base is a *vendored snapshot*:
fetched from a designated upstream at a named commit, reduced to the closed
fact schema, content-digested, and carried with its provenance (source
repository, commit, license, notice). Nothing at runtime reads upstream. A
weekly workflow re-derives the snapshot from upstream's head and — on any
drift — opens an issue; it cannot edit the vendored bytes, because **re-pinning
is a reviewed act**, a pull request a human approves. The rulebook (pack) is
schema-versioned data whose loader fails closed on anything it cannot fully
validate — an unknown article, a threshold nobody can meet, a disclosure with
no approved text in an approved locale, a display floor that measures nothing.
Mandatory texts are digest-self-naming, so an id can never drift from its
words. Every filed record carries `snapshotId` and `packId`, so a decision
replays under the world it was made in, not the world of the audit.

**The roles this implies.** Three, cleanly separated by the seams:

- a **data steward** owns the snapshot: the designation of upstream authority,
  the fetch/reduction pipeline, the drift triage, the re-pin PRs. Their sign-
  off is a merge.
- a **policy owner** owns the pack: gates, mandated wording, vocabularies,
  prominence floors. Policy changes are diffs to data, reviewable by a
  compliance function that never reads kernel code — which is the point of
  policy-as-data.
- a **kernel owner** owns the invariants and the crucible, and is the only
  role whose changes need engineering review. The crucible greps for weakened
  enforcement tests; "never weaken a crucible to go green" is the operational
  rule that keeps this role honest.

**The certification pipeline — the honest hard part.** PokeAPI arrived as
structured data; the demo's reduction step is small. In target domains the
upstream is often *prose* — a prospectus, a clinical guideline, a procedure
manual — and the expensive step is turning prose into typed facts the registry
can resolve. The architecture's stance carries over exactly: **a model may
propose extractions; a human certifies them; the snapshot only ever contains
certified values.** That is the same propose/verify split, moved to authoring
time — and it changes the economics honestly: the marginal cost of this
architecture in a prose-fed domain is a curation function, not a bigger model.
Two mitigations keep it tractable: the fact schema is closed and small (you
certify *fields*, not documents), and provenance per fact (which document,
which page, which effective date) makes each certification itself auditable.

**Freshness is policy, and it already has a mechanism.** The demo's scope
grants carry validity windows — scope valid at issue is not scope valid
forever, and windows are re-checked at action time. The same versioned-window
pattern is how a real deployment expresses fact volatility: rate sheets might
be re-pinned daily on an automated fetch with steward review; a formulary
weekly; procedures per release board. The drift workflow generalizes to "the
watcher that files tickets"; what must not generalize away is that the watcher
cannot write. For domains where staleness is itself a hazard, the pack can
carry a maximum snapshot age the kernel enforces like any other gate: an
answer certified against an expired world is refused by name, which turns
"our data was stale" from a post-incident discovery into a denial at the
moment it mattered.

**Multi-source truth is a designation problem, not a merge problem.** Today
there is one snapshot and one authority, and that simplification is honest —
IA-8's deepest lesson is that *authority is designated, never inferred*. A
deployment with several sources (prices from A, terms from B, restrictions
from C) should keep one designated authority per fact family, recorded in the
snapshot's provenance, rather than reconcile conflicting sources at answer
time. Conflict resolution is an authoring-time, human-reviewed act; the kernel
should only ever see a world that has already decided who speaks for what.

**Incidents and audit.** The record is the whole of it: transcript (with the
questions asked, which are evidence), grant, manifest, artifact digest,
affidavit, confirmation, action grants, snapshot and pack ids. Replay
re-executes the decision and names the first divergence. The operational
consequence: an audit request is a query over filed artifacts, and a
regulator-facing number is rendered *from* a record, never recomputed — the
same discipline the demo's results page enforces on itself.

## 5. What does not carry (the honest ceilings)

- **Deterministic language understanding does not scale linguistically.**
  Token matching over closed vocabularies is the demo's front door, not its
  plan. It goes silent outside whitespace languages and past small
  vocabularies; the architecture survives because misses fall closed to a
  question, a confirmed proposal, or a form control. A port should expect the
  deterministic front door to catch *less* than the demo's and lean on the
  ladder and structured input more. The measured quantity to watch is
  activation rate — a front door that never engages is a silent usefulness
  ceiling.
- **The last inch of the screen is not replayable.** Structure and text are
  digest-bound and replay bit-for-bit; pixels are not. The geometry affidavit
  (prominence, placement, occlusion as numbers against pack floors) runs live
  at the edge and only tightens; true what-you-see-is-what-you-sign is the
  platform's job, and folding pixels into the evidence digest would poison
  replay rather than strengthen display. State this ceiling in any deployment
  honestly; regulators have heard "the screen is proven" before, and it wasn't.
- **The agent certifies; it does not teach or charm — unless taught content is
  itself certified.** Free prose on a certified artifact is denied by
  construction, which means explanation, education, and bedside manner cannot
  be generated into the governed surface. The pattern that fits the
  architecture is *selected, not authored*: a reviewed, versioned catalogue of
  teaching content the model may choose from but never write. (The demo's
  newcomer questions currently abstain for exactly this reason; the catalogue
  is the designed next step.) The ungoverned chat pane may still charm — the
  sales-call/prospectus split — but nothing said there carries a certificate.
- **Recommendation-shaped answers carry a weaker certificate — and in several
  target domains they are a licensed activity, not merely a softer claim.**
  The kernel certifies an advised pick as *eligible*, never as *correct* —
  "a real, allowed product," not "the best one." The demo's coverage map
  reports advisory resolution apart from fact resolution for that reason, and
  any deployment's dashboard should inherit the split; summing them lets
  advice borrow a fact's guarantee. But the sharper point is legal, not
  epistemic: individualized investment advice, medical advice, and legal
  advice are activities a deployment must be *licensed to perform at all*
  (in the U.S.: investment-adviser registration, the practice of medicine,
  unauthorized-practice-of-law rules). That is an **operator-level gate,
  distinct from the user-level accreditation gate** the demo's IA-5 models:
  Article V asks "may *this trainer* be advised toward this thing?"; the
  operator gate asks "may *this deployment* advise anyone at all?". In the
  pack it is one line — an unlicensed deployment disables the recommendation
  claim kind, and every advisory question refuses by name instead of
  resolving — which converts "we accidentally gave investment advice" from a
  discovered liability into a versioned policy decision. The line the
  industry actually walks — *education* is permitted where *advice* is
  licensed — is exactly the split this taxonomy already draws: certified
  facts and selected-not-authored teaching content on one side, eligibility-
  checked recommendation on the other. (The demo's fiction quietly assumes
  the license: its Advisor speaks *as the League's own*. A real deployment
  must earn that sentence.)
- **This is priced for high stakes.** Scope establishment, confirmations, and
  consent-on-exact-artifact are friction. The demo's own iteration history
  shows the friction can be engineered down hard (a recorded question arms a
  bare answer; questions outrank the model ladder) — but a low-stakes chatbot
  does not need this kernel, and bolting it on would be theater. The design
  brief is the inverse: use it where a wrong claim or an unauthorized act is
  expensive enough that "the model is usually right" was never an acceptable
  answer.
- **Provider variance is an operating fact.** Identical prompts diverge at
  temperature 0; tail latency is wild; a provider can be too timid to test a
  gate. The harness disciplines — sample-size dials, fail-fast N=1 before
  N=3, provider failures counted apart from abstentions, adversary attack
  rates measured so a safety pass is never vacuous — are as much a part of the
  port as the kernel is.

## 6. An adoption path

The demo's own build order is the recommended pilot shape, compressed:

1. **Pick one workflow where a wrong claim is expensive** and one knowledge
   base that can be pinned. Resist starting with the hardest prose corpus;
   start where the facts are already fields.
2. **Write the closed vocabularies first** — scope dimensions, fact schema,
   claim kinds, the pack's gates and mandated texts. This is a compliance
   workshop output, not an engineering sprint; the artifact is reviewable
   data.
3. **Build the crucible before the agent.** Every article of your rulebook
   gets a failure injection that must be denied by name, plus the untampered
   control. If a rule cannot be given a crucible mutation, it is not yet a
   rule.
4. **Wire the pipeline with a scripted model**, deterministic and key-free in
   CI, then put real models behind the same seam — strong and deliberately
   weak. Enforcement zeros must hold on both before usefulness numbers mean
   anything.
5. **Evaluate with a disposition-tagged question bank**, not a pass rate:
   answerable / advisory / needs-data / needs-capability / should-refuse /
   off-domain, with honest abstention counted as a pass on the unanswerable
   buckets and every refusal expected by name. Iterate with small fail-fast
   probes and record what moved the needle; the coverage map's ceilings are
   the roadmap (which data to certify next, which claim kinds to add).
6. **Stand up the operating loop** — steward, policy owner, drift watcher,
   re-pin review — before go-live, because the first knowledge-base change,
   not the launch, is the real test of the design.

The one-line version, for the reader deciding whether to try this at home:
**the model makes it useful; the architecture makes it safe; the knowledge
base makes it true — and each of the three is owned, versioned, and tested by
a different mechanism, which is the entire trick.**

## 7. Composing with the stack you already have

An organization arriving at this design does not arrive empty-handed. It has
retrieval pipelines, agent frameworks, orchestration, often a vendor-built
knowledge graph — and a reasonable fear that a governance architecture means
tearing that down. It does not, and the reason is structural rather than
diplomatic: **everything upstream of the commit boundary is already untrusted
here.** The kernel never asks how an answer was proposed — recall, RAG,
graph-structured retrieval, a five-agent pipeline — it verifies typed claims
against the certified substrate at the moment they would reach a person. The
model seam and the ungoverned control arm are the existence proof: the same
models, the same propose path, differing only in whether the gate is present,
with only the gate deciding whether fabrication can commit.

So the adoption shape is a **gate, not a platform**: intercept the egress,
require answers in claim form, verify, render certified surfaces through
slots, file the record. The retrieval investment is untouched — in fact it
appreciates, because better retrieval raises the resolution rate while
enforcement stays pinned at zero. This is also how compliance infrastructure
has historically landed (inline XBRL atop existing reporting stacks; egress
proxies atop existing mail), and it is why the kernel's smallness and
neutrality are not modesty but the asset: the gate is the only part an
auditor must read, and it must not be entangled with any pipeline it governs.

Drawn out — with a graph-RAG pipeline standing in for whatever the
organization already runs — the topology is a gate *after* the stack, never
a wrapper *around* it:

```
user question
   │
   ▼
agent + existing retrieval          untrusted "propose" zone. Graph
  (graph-RAG communities,           communities, embeddings, traversals,
   embeddings, agent pipelines)     agent hops — all of it just helps the
   │                                model draft a better proposal
   ▼
proposed answer, as typed claims    the one integration cost: the agent
   │                                emits claims, not free prose
   ▼
KERNEL at the egress                verifies every claim against the
   │                                certified substrate; fail-closed;
   ▼                                names its denials; files the record
certified surface → user
```

Three consequences are visible in the picture. The kernel has **no
interface to the retrieval stack** — it never calls it, never imports its
types, doesn't know it exists; the two meet only at a typed claim, which is
what keeps the auditor's surface the kernel alone and the gate vendor-
neutral. The **only integration cost sits at the agent's output** — answers
in claim form — leaving every upstream component untouched. And the arrow
the diagram does *not* draw is the load-bearing one: verification points at
the certified substrate, never back at the retrieval stack's graph. The
propose side and the verify side never share a truth source.

**The one hard requirement composition cannot waive: a certified substrate.**
Verification is only as strong as what it verifies against, and the popular
graph pipelines build their knowledge graphs *with a model*, extracted from
unstructured text. Such a graph is a recall structure — genuinely useful for
finding things, unverified and unreproducible by construction. Point the
verifier at it and the guarantee silently downgrades from "true per the
certified source" to "faithful to an unverified graph": laundering, and it is
exactly what will be asked for. The composition that holds is **two-tier**:

- **The certified core** — the systems of record the organization already
  trusts and often already owes: price lists, product catalogues, adopted
  policy documents, regulatory filings. Pinned, checksummed, loaded
  fail-closed; the only tier claims verify against.
- **The recall layer** — everything else, graph-built or otherwise, serving
  navigation and proposal *upstream* of the gate, where it can help and can
  never attest. Lexical and semantic search gate recall; they never gate
  proof. The same asymmetry that governs the scope resolver governs the
  whole retrieval stack.

Two consequences keep the two-tier story honest. First, **certificates carry
a provenance grade**: an answer verified against the pinned catalogue names
that catalogue and its digest; anything else is visibly a different, weaker
artifact — one guarantee must never borrow another's clothes, which is the
same rule that keeps advisory resolution off the factual resolution line.
Second, **the claim is scoped to the governed egress**. A gate governs what
flows through it; a side channel — an agent mailing directly, an ungoverned
tool call — is outside the perimeter, and the honest statement of the
guarantee says so, exactly as this demo's guarantees are scoped to the
certified artifact and not the chat pane.

Where this sits against the knowledge-graph tradition: the certified core
*is* a knowledge graph — closed-world, strictly typed, shape-validated — and
"the model names a typed intent, the kernel derives the value" is the
semantic-parsing pattern that literature converged on. The departures are
deliberate and load-bearing: the graph is vendored rather than
model-extracted, the semantics are closed-world (which is what makes a
certified count possible at all), and grounding is replaced by verification
— a citation shows a source; this recomputes from one and refuses otherwise.
Composition, then, is not a compromise of the architecture. It is the
architecture: the propose side was never trusted, so it was never ours to
replace.

## 8. The boundary of the guarantee: what the law requires, and what it doesn't

The obvious objection to everything above: must *every* response really bind
to certified knowledge? There will always be general questions no
substrate anticipates, and an agent that refuses them all is buying its
guarantee with its usefulness — while the enterprise buys it with an
authoring burden that never ends. The tempting resolution is a **two-tier
surface**: certified answers visually attested, and everything else answered
from the model's own knowledge under a visible "not verified" label. Whether
that resolution survives contact with the law is a checkable question, and
the answer reshapes the design rather than merely permitting it.

*(What follows summarizes regulatory and case-law research current to
August 2026, verified against primary and reputable secondary sources; it is
an engineering-design input, not legal advice.)*

**No surveyed regulator requires per-response grounding.** Not the SEC, not
FINRA, not the CFPB or FTC, not the FCA, not the EU AI Act. The operative
standards are outcome- and process-shaped: communications must be *not
misleading* and *fair and balanced* ([FINRA 2210(d)](https://www.finra.org/rules-guidance/rulebooks/finra-rules/2210);
FTC Act §5; UDAP), *supervised* ([FINRA Regulatory Notice 24-09](https://www.finra.org/rules-guidance/notices/24-09):
rules are "technology neutral" and firms answer for AI output as their own),
*retained* (SEC 17a-4/204-2 — transcripts are business records), and
*substantiable on demand* (the [Marketing Rule](https://www.sec.gov/investment/marketing-faq):
fail to substantiate when asked and the claim is presumed baseless).
Grounding appears nowhere as a duty — it is the *mechanism* that makes those
duties cheap to prove, which is this architecture's actual legal role: the
filed transaction record is supervision, retention and substantiation in one
artifact.

Two regimes force grounding in effect, and where they do is instructive.
Pharmaceutical product communications carry strict misbranding liability
(FDCA §502(a)) — which is why medical-information departments answer only
from pre-approved response documents, an industry that already runs the
certified-core pattern by necessity. And FDA's [Clinical Decision Support
guidance](https://www.federalregister.gov/documents/2022/09/28/2022-20993/clinical-decision-support-software-guidance-for-industry-and-food-and-drug-administration-staff)
makes "independent review of the basis" the price of not being a regulated
medical device — the closest thing anywhere to an explicit
transparency-of-basis mandate. The pattern: the law reaches for grounding
exactly where the *content class* is dangerous, never as a blanket
per-response rule. The boundary is drawn by subject matter, not by surface.

**The labeled tier is lawful — one statute even codifies it.** California's
[AB 3030](https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=202320240AB3030)
(Health & Safety Code §1339.75) requires AI-generated patient communications
to carry a prominent disclaimer and a route to a human — *unless a licensed
provider reviewed the message*, in which case no label is owed. A reviewed
tier exempt, an unreviewed tier labeled: the two-tier surface, in statute.
The EU AI Act's [Article 50](https://artificialintelligenceact.eu/article/50/)
is the same shape at the horizontal level — chatbots must disclose their
nature, and a limited-risk chatbot that does so may lawfully be imperfect.

**But the label is a duty-satisfier, never a liability shield.** Every
adjudicated case and every doctrine surveyed lands the same way:

- **A disclosure can qualify a claim; it cannot cure one** (the FTC's
  net-impression doctrine, imported by the CFPB and state UDAP law). A
  banner reading "may be inaccurate" does not qualify a specific factual
  answer to a specific question — it contradicts it, and the specific answer
  *is* the net impression.
- **[Moffatt v. Air Canada](https://www.canlii.org/en/bc/bccrt/doc/2024/2024bccrt149/2024bccrt149.html)**
  (2024 BCCRT 149): the airline's chatbot invented a refund policy; the
  tribunal called the chatbot-as-separate-entity defense "a remarkable
  submission" and — the holding that matters most here — rejected the
  argument that the customer should have double-checked against the accurate
  page *on the same site*. Inconsistency between an operator's surfaces is
  the operator's negligence, not the user's diligence failure.
- **Substantive duties do not read the banner.** An in-substance
  recommendation triggers Reg BI on an objective test regardless of labels;
  the SEC holds fiduciary duty [non-waivable by hedge
  clause](https://www.sec.gov/files/rules/interp/2019/ia-5248.pdf); Utah's
  AI Policy Act states that generative AI "is not a defense" to consumer
  protection liability; Illinois now bans AI psychotherapy outright, labels
  irrelevant. The joint federal position is a sentence: *there is no AI
  exemption from the laws on the books.*
- The one disclaimer victory — *Walters v. OpenAI* (2025) — protected a
  general-purpose **vendor** from a **third party** over output the user
  elicited and disbelieved. It does not transfer to an operator aiming an
  agent at its own customers about its own domain, which is the posture of
  every deployment this document addresses.

**And the certified badge cuts the other way: it is itself a regulated
representation.** The Texas Attorney General's
[Pieces settlement](https://www.texasattorneygeneral.gov/news/releases/attorney-general-ken-paxton-reaches-settlement-first-its-kind-healthcare-generative-ai-investigation)
treated advertised hallucination rates as actionable claims; the SEC's
Delphia and Global Predictions actions did the same for claims about AI
systems. A surface that stamps "verified from official records" on a wrong
answer has converted a quality failure into an affirmative
misrepresentation. A certification mark is only an asset when every stamped
answer can be proved — which is what the replayable record is for, and why
the certified tier's threshold must never be diluted to cover more
questions.

Three design rules follow, and they are stronger than the two-tier proposal
they started from:

1. **The free tier needs a negative gate, not just a label.** The residual
   risk of an ungoverned tier is not its existence but what leaks through
   it: specific factual claims about the operator's own products and
   policies (*Moffatt*'s exact posture), in-substance advice in regulated
   categories, the substance of licensed activity. Those are claim-shaped,
   and claim-shaped content is what this kernel detects. Run the same
   detection at the free tier's egress with the opposite polarity: the
   unverified label is *earned by verified absence of governed claims*, not
   by hoping the model stayed general. Fail closed into routing or refusal
   when a governed claim is found.
2. **The tiers must never disagree.** *Moffatt* puts the burden of
   consistency between an operator's own surfaces on the operator. If the
   certified tier can answer a question, the free tier must route to it,
   never improvise its own version — a two-tier surface without this rule
   manufactures the exact liability it was built to avoid.
3. **Provenance grades stay visibly distinct** — the same rule §7 imposes on
   recall-layer answers. Certified, curriculum (reviewed prose), and
   unverified are three different artifacts; one must never borrow
   another's clothes, because the strongest mark is only worth what its
   weakest borrower makes it.

Read as a whole, the legal landscape is an endorsement of the architecture's
shape with a correction to its scope. The law does not ask for everything to
be certified; it asks the operator to own every word, supervise it, retain
it, and prove the claims it makes — including the claim implicit in a
verification badge. A governed core with a provably-general free tier
around it satisfies that at the minimum authoring cost: certification is
owed where content is governed and load-bearing, the negative gate polices
the boundary from the free side, and the transaction record turns each of
the law's process duties into a file the operator already has.

## 9. Scale: retrieval nominates, the kernel disposes

The curriculum mechanism as shipped is honest about its size. Eighteen
lessons ride in the answer grammar as an enum and in the prompt as a listed
vocabulary, and the model routes by reading the whole catalogue — a
1-of-18 classification, which is why even the weak model routes it
reliably. Three parts of that stop scaling together, somewhere in the low
hundreds of entries: the prompt listing (linear token cost per call), the
enum (providers cap schema size, and constrained decoding over a huge
alternation is expensive), and the choice itself (1-of-50,000 is not a
classification any model holds in its head). A real domain's approved
content library is the larger number, so the scale path has to be stated —
and it is the same asymmetry this design already lives by, applied one
level up: **search gates recall; it never gates proof.**

### The two-stage route

1. **A recall tier nominates a shortlist.** Lexical search, embeddings, a
   vendor graph pipeline — whatever the organization already runs (§7).
   Given the ask, it retrieves the top-k candidate entries from the
   catalogue. This tier is untrusted by construction and may be arbitrarily
   sophisticated, because the *only* thing it can influence is which
   reviewed texts are considered.
2. **The grammar narrows to the shortlist.** The answer schema is already
   built per call, from the pack; at scale it is built from the shortlist —
   the explanation claim's enum offers exactly those k ids, and the prompt
   shows each candidate's reviewed title and summary (pack data, so showing
   them adds no fabrication surface). The model's job returns to what it is
   measurably good at: 1-of-k, descriptions in hand, with abstention
   representable.
3. **Verification stays global.** The kernel checks the routed id against
   the *full* catalogue, exactly as today — existence, locale, digest — and
   the render walk holds the screen to the block's bytes. Nothing about the
   shortlist is trusted at commit time; the enum was a recall aid, not an
   authority.

### The interplay, stated as worst cases

The division of labor is what makes the composition safe to reason about:

- **Retrieval can fail by omission.** A shortlist that misses the right
  entry costs an abstention or a mis-route to an adjacent reviewed text — a
  usefulness failure, measured, never an integrity failure. The certified
  surface degrades toward silence, not toward invention.
- **Retrieval cannot fail by commission.** A wrong, stale, or even
  adversarial retriever can only nominate entries that exist in the
  reviewed catalogue. Poisoning the recall tier buys an attacker relevance
  mischief — showing the wrong approved text — and nothing else; the words
  on screen are still digest-pinned to what review approved. This is the
  precise sense in which the retrieval investment (§7) is composable: it
  appreciates the certified surface without ever being able to breach it.
- **The verifier cannot rescue recall.** The inverse limit is equally
  real: a perfect kernel over a bad retriever is a system that refuses or
  mis-teaches often. The guarantee was never "useful"; usefulness is
  bought upstream and measured.

Which dictates the measurement discipline: the headline routing number
splits in two, **recall@k of the shortlist stage** and **routing accuracy
given the shortlist**, instrumented separately — a retrieval miss looks
identical to a model failure unless the funnel says which door failed, and
a deterministic front door that never engages is a silent usefulness
ceiling (the scope resolver taught this once already). The mis-teach
oracle carries over unchanged, because it is per-question rather than
per-catalogue; production monitoring leans on the deflection metric, which
at scale watches the same two doors it watches today.

### The catalogue at scale

Load-time validation is linear digest work and stays cheap at any
plausible size. What changes is packaging and identity: one reviewed JSON
file becomes a content-addressed store of blocks, with the pack's identity
a digest over the manifest of digests — one root naming the exact reviewed
state of every entry, so a transaction still records a single pack
identity and replays against it. Versioning discipline is unchanged in
kind: an edit is a new version under review, and where an entry's prose
overlaps what the substrate certifies, it is pinned by test — the
what-is-type lesson's fifteen types held equal to the chart is the
miniature of a rule that matters far more at fifty thousand entries than
at ten.

The pattern is not curriculum-specific. Any closed vocabulary that
outgrows its grammar — fact ids over a product master of millions, entity
ids over a real catalogue — scales the same way: **per-call grammars are
recall-gated; the verifier is global.** The demo's 151 species let every
vocabulary ride whole in the schema; that is a convenience of the toy, not
a load-bearing assumption of the design.

And the cost that has no technical fix, stated plainly because it is the
honest half of the answer: **review is the dominant expense at scale.**
Eighteen lessons were read by a person before their digests were pinned;
fifty thousand entries mean authorship, approval workflow, re-review when the
world changes, and retirement — the knowledge-operations reality §4
already prices. The mechanism does not remove that cost; it is the reason
the cost buys something: every one of those reviewed texts becomes a
surface the model can reach and cannot alter.

## 10. What iteration actually cost

Sections 1–9 argue the scalability from the design. This one reports it from
the build log, because the design's central promise — that the enforcement
core converges while usefulness is bought incrementally and never trades
against safety — is a claim about *cost over time*, and this project ran
enough successive slices to measure the shape of that cost rather than assert
it. The honest summary in one line: **the kernel converged, the knowledge is
linear-forever but delegable, routing-by-prose hit its ceiling on schedule,
and the pinned enforcement zero is what made the whole treadmill safe to
run.**

### The slice gradient is the evidence

The useful thing to watch across a run of slices is not whether each landed
but *what kind of work each was.* Early slices were kernel surgery. The
scope-dependency table that made scope requirements derivable from committed
claims, and the propose-first ladder that priced ambiguity into recorded
witnesses, were both changes to enforcement structure — new invariants, new
crucible mutations, the load-bearing walls going up. Later slices were
increasingly *data plus one sentence of prompt.* A certified type count was a
single claim case over a set whose cardinality the kernel already owned. The
game-rule constants — party size, moves per Pokémon, box capacity — were a
reviewed table in the pack and a claim kind that reads it; and the last
*structural* work that surface needed was a one-line unification, deriving
"may this commit without a scope grant?" from the same dependency table that
already answered "what scope does this claim require?" After that line, "how
many Pokémon fit in a box?" was answerable with a table row and zero kernel
change.

That gradient is the convergence, made concrete: **claim kinds are speech
acts, not topics.** A domain has a small, closing set of things an agent can
*do with words* — state a fact, count a set, test membership, rank by a named
basis, describe a matchup, check eligibility, teach from reviewed prose, cite
a fixed rule, recommend an eligible pick, act on an exact artifact. This build
is at eleven and the curve has visibly flattened: new questions increasingly
reuse existing shapes, and the marginal question costs curation, not
engineering. The claim-kind vocabulary is the part that amortizes.

### Knowledge never amortizes — and that is the design working, not failing

The curriculum grew from ten lessons toward the high teens as *pure pack
data*: no kernel diff, no new invariant, each entry read by a person and
pinned by digest. That is the cost that has no technical fix (§9), and the
slice history prices it honestly — the engineering went to zero while the
authoring did not. The structural saving is only this, and it is enough:
closed lists scale with the domain's **schema**, not its **corpus**. The
eleventh claim kind was engineering; the ten-thousandth fact is a snapshot
row. What a builder feels as "continuous iteration to capture the questions"
is real and permanent, but it is a linear curation function that the §4
policy-owner and data-steward roles absorb — not a compounding engineering
burden that only the kernel owner can touch.

### Why the iteration was safe to run at speed

This is the load-bearing observation, and it is the one only a multi-slice run
can supply. In an ungoverned system every prompt tweak and every added entry
can regress safety, so iteration velocity is bounded by re-verifying
everything, every time. Here the failure asymmetry makes iteration a **one-way
ratchet**: a gap degrades to an honest abstention or a wrong-subject
*certified* answer, never to a fabrication or an unauthorized act. Across this
entire run of slices the enforcement metrics stayed hard zeros while
usefulness climbed, and at no point was one traded for the other — the eval
loop ratchets usefulness, the crucible pins enforcement, and the two never
share a dial. That decoupling *is* the scalability result: the
knowledge-engineering treadmill can be handed to a non-engineering curation
function precisely because their mistakes fall closed and cannot reach the
kernel.

### The ceilings the iteration surfaced (on schedule)

- **Routing by hand-tuned prompt prose does not scale, and the run proved it
  the hard way.** Tightening one claim's description to stop it answering out
  of shape worked; an earlier attempt to *name* an out-of-scope subject in a
  prompt to suppress deflection backfired, routing a related concept into the
  wrong reviewed lesson. English-per-claim is fine at eleven kinds and
  eighteen lessons; it is hopeless at a real catalogue. The designed answer is
  §9's two-stage route — retrieval nominates a shortlist, the per-call grammar
  narrows to it, verification stays global — and the deflection metric is the
  instrument that says when that threshold has arrived.
- **Subject deflection scales *with* the catalogue.** Every reviewed entry
  added is one more adjacent-but-wrong certified text a question can deflect
  into. It stays a usefulness number and never an integrity one — the answer
  is still reviewed, certified content — but it is the number to watch as the
  knowledge base grows, and per doctrine it is measured, not prompt-suppressed.
- **"Capture a significant portion of the possible questions" is the wrong
  target.** §8 is the reason: no surveyed regulator requires per-response
  grounding. The scalable posture is a governed core answering the
  claim-shaped questions, wrapped by a free tier whose "unverified" label is
  earned by a *negative* gate — verified absence of governed claims — not by
  aspiring to certify everything askable. The authoring burden is bounded by
  what is governed, not by what a user might type.

### The axis this run did not measure: multi-turn

The evaluation to date is single-turn, and that is the honest gap in the
scalability evidence. The *architecture* is multi-turn native — grants with
validity windows, a recorded question that arms a later bare answer, a
confirmation bound to an artifact digest are all conversation state — but
without dialogue evals there are no numbers on the failure modes that exist
only across turns: a grant gone stale between render and act (lesson 8: scope
valid at render is not scope valid at execution), a question's answer-route
binding the wrong later utterance, deflection compounding across a thread,
ceremony cost measured as prompts-to-answer over a whole task rather than one
exchange. The machinery already speaks this shape — the live session driver
drives scripted multi-turn conversations today — so it is an eval extension, a
`dialogue` bank entry with per-turn expectations, not new kernel work. It is
the next axis of eval growth to prioritize before widening the single-turn set
much further, because multi-turn is where the remaining interesting
enforcement cases most likely live.

The **instrument now exists** (`data/playability/dialogues.v1.json`, run with
`npm run coverage:map -- --dialogues`; see `docs/eval.md`): a `dialogue` entry
is one truthful trainer speaking a scripted sequence of turns into a single
session, each turn scored by the same oracle a single-turn question is, read
from the record that turn produced, plus a thread-level ceremony cost —
prompts-to-answer over the whole task — that a single-turn run cannot report.
It is proven key-free in CI, and the cross-turn enforcement zero (a turn that
commits gated advice part-way through a thread) holds by the same kernel the
single-turn path uses. What is still missing is the honest part: **numbers.**
A `dialogue` run over a real model has not been paid for, so this section's
"did not measure" stands as written until the two-model dialogue run lands its
figures in `docs/findings.md` — a claim without a number is a note, not a
finding.

## 11. The improvement loop: operating the governed agent as a discipline

§10 measured the *build* arc — the cost of standing the architecture up. A
second arc then ran on top of the finished kernel (findings §§14–22, distilled
in [lessons.md](lessons.md)): the defaults were swapped to deliberately cheap
open-weights models, usefulness cratered, and it was rebuilt layer by layer —
retrieval, grammar gating, deterministic repair, canonical decoding — without
one enforcement change and without one safety re-certification. The shape of
that arc is itself the operational product: a loop an organization can run,
staff, and audit. This section states it as one.

### The loop

1. **Run the banked eval under the current configuration and file the whole
   record** — transcripts, transactions, provenance, flags. The artifact is
   the unit of evidence; a topline is a view of it, never a substitute.
2. **Read the misses from the records, not the rates.** Every denial names
   its article; every abstention names its stage; every deflection is visible
   as certified-text-on-the-wrong-subject. A miss read from a record arrives
   pre-diagnosed.
3. **Classify each miss by the layer that owes the fix.** The arc's residual
   taxonomy: *content debt* (the certified world lacks the answer), a
   *retrieval gap* (the right rows were never offered), a *grammar gap* (the
   right shape was never nominated), a *surface-form gap* (the decoder
   refused a spelling of a certified name), a *recoverable mis-recall* (a
   named fact with a wrong value, repairable by falling to the grounded
   shape), a *meaning gap* (only a human may resolve it), or a *true model
   limit* — the residual of residuals, reached only after the others are
   excluded.
4. **Build the smallest deterministic mechanism at that layer.** Never a
   verdict fed back to the model; never a nearest-neighbour guess about
   intent (docs/recovery.md draws the line channel by channel).
5. **Re-measure at known noise.** Toplines carry bands; comparisons stay
   within one artifact where possible; a cross-run delta is a result only
   when it clears the band on both ends.
6. **Record with provenance and ratchet.** A claim without a number is a
   note; a number without an artifact is a press release.

### Why the loop distributes: every layer has a natural owner

The taxonomy in step 3 is not just diagnosis — it is a routing table for
work. Content debt is the knowledge steward's backlog (§4's curation
function; §22's stable-fail list *is* that backlog, named per entry).
Retrieval, grammar, decoder, and repair mechanisms belong to the platform
team, and each is ordinary deterministic software with ordinary tests.
Meaning gaps route to UX — the ladder, the confirmation card, the clarifying
question. Permission denials route to nobody, by design: they are the product
working. And the model itself becomes the one component *without* a backlog:
it is a commodity input, replaced rather than repaired. "The AI was wrong"
stops being a ticket category; each miss becomes a routed work item with an
owner, an artifact behind it, and a layer-appropriate fix in front of it.

### The SLO framing: a floor, a band, and a zero

The repetition instrument (§22) hands operations exactly the three numbers a
service contract needs. The **stable core** — entries that pass in every
repetition — is the floor the system actually guarantees, the number to put
in front of a customer. The **band** is the variance budget: same-config
toplines move inside it on sampling alone, so alerting below the band is
noise and regression means falling *out* of it. And **enforcement is not an
SLO at all** — it is an invariant, a zero verified per artifact with no error
budget, no majority vote across repetitions, and no trade against the other
two. This maps onto reliability practice enterprises already run (floors,
error budgets, hard invariants) — the governed agent drops into existing
operational muscle rather than demanding new kinds of trust.

### The procurement consequence

Because usefulness is rebuilt from layers the operator owns, model choice
becomes reversible and competitive. The arc's evidence: two default swaps, a
usefulness collapse, and a full recovery by architecture — with the cheap
open-weights strong model ending *above* the expensive closed one it
replaced, at a fraction of the price, and the enforcement zeros never
wavering across any of it. Capability rents at the propose step only. An
organization running this loop negotiates with model vendors from the
position that the guarantee, the evidence chain, and most of the usefulness
live in-house.

### The honest boundary

All of this is demonstrated inside one domain, one reviewed bank, a
cooperative scripted counterparty, and N=3 on a 52-entry smoke set
([lessons.md](lessons.md), third direction). The loop's *mechanics* — record
reading, layer routing, deterministic fixes, banded measurement — carry by
construction; its *rates* do not, and a port should expect to re-earn every
number in its own domain before quoting any of these.
