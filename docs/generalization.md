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
dimensions; claims come in exactly six kinds; roster criteria in five;
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
