# Landscape: what this is, where it sits, and where it could go

*A discussion note, not a finding. It states the problem and the architecture
in one place, places the design against the academic and industrial state of
the art, and lists forward directions as hypotheses. Every number cites the
findings section that filed it (§N is a top-level section of findings.md;
"iteration N" is an entry in its §17 iteration log); the design itself is
[architecture.md](architecture.md), the canon is
[the-indigo-accord.md](the-indigo-accord.md), the boundary of the guarantee is
[the assurance case](assurance-case.md), and the domain bridge is
[generalization.md](generalization.md). Comparative evidence for knowledge-base
size and retrieval difficulty is in
[knowledge-scale.md](knowledge-scale.md). This note does not repeat them; it
connects them.*

---

## 1. Problem statement, architecture, and technical overview

### The problem

An AI agent that advises, discloses, and acts in a regulated setting has to
make governed commitments that are provably supported and compliant within a
declared assurance envelope — not usually right, but architecturally unable to
ship an unproven claim or an unauthorized act inside that boundary. Every
mainstream approach to that problem is probabilistic: better models, better
prompts, retrieval to ground the model, a classifier at the output to catch
the rest. Each lowers a rate. None makes a class of error impossible, and a
regulator does not accept a rate for a class of error the rulebook forbids
outright.

The project's claim is that the missing piece is **architecture, not
capability**: certain statements and actions must be impossible to *commit*
without proof, regardless of how capable the model is. The Pokémon setting is a
vehicle, chosen so the system can be attacked, run on deliberately weak
models, and sabotaged live without anyone being harmed. The fictional rulebook
([the Indigo Accord](the-indigo-accord.md)) maps article-for-article onto real
regulation — suitability, approved materials, anti-fraud, comparative claims,
product gating, disclosure prominence, order confirmation, authorized parties,
irreversibility consent, books and records.

### The thesis, in one sentence

**Enforcement is structural; usefulness is empirical.** A stronger model
answers more often; it does not change whether an unsupported governed claim
can cross the commit boundary. The evidence is the same harness run over
strong and deliberately weak models, where enforcement zeros hold flat while
usefulness moves
([findings.md](findings.md), the timeline table, and iteration 22's per-entry churn:
outcomes flip among *resolved / denied / abstained* and never once cross the
gate).

### The architecture, in one paragraph

A small, readable enforcement kernel (`src/kernel/`) sits between the model
and the person. The model lives only inside *propose* steps. What it proposes
is not prose but typed claims in a closed vocabulary: name a species and a
fact id; define a set by declarative criteria and ask for its count; name a
set, a basis and a direction and ask for the extreme; name a lesson id from a
reviewed catalogue. The kernel resolves every id against a pinned, digested
snapshot, recomputes every derived value itself, attaches every disclosure the
policy pack demands, proves the disclosures are visible by walking the final
DOM, binds the person's confirmation to the exact artifact digest they saw,
re-verifies the whole chain at the moment of execution, and files a record
from which the verdict can be re-derived offline. Every stage that cannot
prove, refuses — with the article it refuses under.

### Six mechanisms that carry it

1. **The model only proposes.** No model output crosses a commit boundary
   without deterministic verification; no LLM sits in any enforcement path or
   in CI (`manifest.ts`, `compileManifest` is built *on top of*
   `verifyManifest`, so the producer can never be more trusted than the
   auditor).
2. **Authority is a channel, not a judgment.** Every utterance, question and
   confirmation carries the source its transport assigned; only the trainer's
   channel binds (`scope.ts`, `contracts.ts` `UtteranceSource`). Prompt
   injection is handled as an authority problem: a pasted guide or a tool
   result is read and can never bind, whether or not anyone detects it as
   hostile. Inside the trainer's channel, quoted, reported, instructing,
   negated and interrogative clauses are excluded under named rules.
3. **Closed vocabularies wherever a value is minted.** Scope values, claim
   kinds, roster criteria, fact ids, formatters, renderer copy: finite,
   reviewed lists. No text can make a closed vocabulary emit a value outside
   itself.
4. **Derive, never assert.** A count is its set's cardinality; a ranking's
   winner is computed; a matchup is arithmetic over the certified chart; an
   eligibility ruling is computed from pack and grant. The model states no
   number and names no winner, so those denials are unreachable from a model
   (§11–12).
5. **Bind, never search.** Certified values appear only through typed slots
   and closed per-locale formatters; mandatory text only as digested blocks;
   all other text only from the copy catalogue. The affidavit is derived from
   an independent walk of the final DOM (`render.ts`, `dom.ts`, `format.ts`);
   the reference renderer cannot compose a sentence.
6. **One proof identity, and replay.** Scope → answer → render digest →
   confirmation → grant chain by digest and are re-checked at execution time;
   every record replays offline, and CI now re-derives every published
   enforcement zero from the filed records (iterations 25–26).

### How the model finds the relevant facts

It does not retrieve; it **names**. The prompt shows the claim grammar, the
roster-criteria vocabulary, the fact-id *menu* (ids drawn from the registry,
never values), lesson ids, rule ids and tool ids, plus the trainer's words.
Decoding is grammar-constrained. The kernel then looks up every id and
performs every computation. Two later additions keep this tractable for cheap
models without touching enforcement: **deterministic lexical retrieval** over
the closed vocabulary fetches only the certified rows a question names, so
the model reads rather than recalls (iteration 17: 88% answerable at ~1/9th the
tokens of whole-registry grounding); and a **retrieval-gated grammar** offers the
aggregate claim kinds only when a question nominates them, so a ranking
cannot decode as a count (iteration 19). The mapping the model still owns is a 1-of-k
choice over a schema-sized vocabulary — and a cheap model with the grammar
and kernel behind it reaches the same answerable rate as the strong one on
certified facts (§18: 83%/83%).

### Where the knowledge lives, and how it grows

Two reviewed data stores. The **certified snapshot** is a narrow projection of
an upstream source at a pinned commit, content-digested, provenance-bearing,
validated fail-closed at load, and now carrying a per-surface *fidelity*
declaration (era-true / modern-values / era-restricted, iteration 27). Re-pinning is a
pull request; a weekly drift watcher can file an issue but cannot write. The
**Accord pack** is versioned policy and reviewed content — gates, disclosures
with approved wording per locale, vocabularies, a lesson catalogue, game-rule
constants — whose loader refuses anything it cannot fully validate.
[generalization.md](generalization.md) §4 names the three roles this implies
(data steward, policy owner, kernel owner) and the honest cost in prose-fed
domains: a model may propose extractions, a human certifies, the snapshot
contains only certified values.

---

## 2. Relationship to the academic and industrial state of the art

The design was written from first principles, which makes it worth saying
plainly where it lands relative to work that arrived at similar shapes. The
pattern below recurs: the project's mechanisms are recognisable instances of
known ideas, and its departures are the load-bearing parts.

### Neuro-symbolic AI: the *neural → symbolic* shape

In the usual taxonomy of neuro-symbolic systems (Kautz's 2020 survey), this is
the "neural proposes, symbolic verifies and executes" configuration, not a
hybrid reasoner. The nearest academic ancestor is **semantic parsing and
knowledge-base question answering** — translating a question into a logical
form that an executor evaluates against a structured source (from Zelle &
Mooney's 1996 database queries to WebQuestions over Freebase and the Spider /
BIRD text-to-SQL benchmarks). The claim vocabulary is a deliberately tiny
logical-form language: rosters are set expressions, `count` and `ranking` are
aggregates, `matchup` is a join against the type chart. The departures:
the executor is a *verifier* as well as an evaluator (it re-derives and
refuses, rather than just returning a result), the language is closed by
construction rather than a fragment of a general query language, and the
result is bound to a rendered artifact and a record — semantic parsing ends
where this design's second half begins.

### Program-aided reasoning

"Ground the computation, not the data" (§10) is the result the program-aided
line established (PAL, Program-of-Thoughts, 2022): language models cannot
reliably count forty-two items in context, and an interpreter can. The
project's version is stricter — the model emits no program, only declarative
intent, and the kernel does the arithmetic — but the division of labour is
the same, and §10's failed grounding experiment (the answer sheet in front of
the model, and it still miscounted) is a clean replication of why that line
exists.

### Constrained decoding and typed intent

Grammar-constrained generation (Outlines, XGrammar, provider-side structured
outputs) is the mechanism behind the weak model's 4/12 → 12/12 jump in the
timeline's row 4, and behind the retrieval-gated grammar of iteration 19. The most
relevant precedent is **PICARD** (2021): incremental parsing during decoding
that validates each token against the *database schema*, not just the JSON
shape. This project enforces the syntactic half; the schema-aware half is a
named direction below. On the intent side, Microsoft's **TypeChat** (2023) is
the closest industrial cousin — natural language into a typed object,
validated by the type checker — and the design here is TypeChat plus a
certified substrate the values resolve against, plus a render proof, plus a
record. Where TypeChat feeds validation errors back to the model for repair,
this project deliberately does not: see [recovery.md](recovery.md).

### Verifier-in-the-loop systems

AlphaGeometry and AlphaProof pair a proposing model with a total verifier
(a symbolic engine, a proof assistant), and the verifier is what makes search
and learning possible. The Accord kernel is a domain verifier of the same
shape, and that is the connection the forward directions lean on hardest.
The difference in posture matters: those systems *search* against the
verifier at inference time, while this project holds a served verdict to be
terminal (recovery.md: no re-litigation), so the verifier's leverage here is
at training and evaluation time rather than in a retry loop.

### Transactional neuro-symbolic systems

The closest published cousin in a *transactional* setting is VA-NSF (Qin et
al., "Neuro-symbolic constraint verification for LLM-driven internet finance
transaction execution", Scientific Reports, 2026, accepted manuscript): a
neural actor parses a payment instruction into a typed, schema-grounded AST
under grammar-constrained decoding, a type-checker grounds every reference
against live master data, an Answer Set Programming verifier evaluates the
AST against integrity constraints, and a commit carries a formal approval
certificate recording the rule-set version while a refusal carries a
structured violation report (rule id, field path, observed value,
threshold). The first half of that pipeline is this design's first half
almost line for line — mechanisms 1, 3 and 4 above — and the paper reaches
the thesis independently: under noisy input "the safety guarantee is
preserved while availability degrades," which is *enforcement is structural,
usefulness is empirical* in other words. Its measured result that structured
violation reports beat generic natural-language feedback by 18.7 points is
the same asymmetry the strip-assertion repair of channel 2 relies on: a
deterministic component that knows *which* value was wrong can do more than
a model told to try again.

The departures are the second half, and each is load-bearing here. First,
VA-NSF's repair is the loop [recovery.md](recovery.md) refuses: the violation
report is fed back to the model for up to three attempts, and the paper's
own menu of repairs for an over-threshold transfer — reduce the amount,
*split it into sub-threshold payments*, or add an approver — is the oracle
hazard stated as a feature. A loop rewarded for passing the gate learns to
structure. This design recovers content through named channels under caps
and treats an authorisation denial as terminal. Second, VA-NSF executes the
moment the verifier is satisfied; nothing binds the repaired transaction to
what the person asked for, so a reduced amount ships certified and wrong.
Here the person's confirmation binds to the digest of the exact artifact
they saw, and the act path re-verifies the whole chain at execution.
Third, the approver is a field the model fills from the instruction and the
type-checker confirms only that the user exists — the prompt self-certifies
the approval. Here authority is a channel: a value that can bind is minted
only by the kernel from the transport it arrived on, never by the proposer
from text. The paper is candid about its residual risk being the
translation from policy text to encoded rules, and about its evidence
stopping at eighty rules and a curated benchmark; both are the honest
boundary this note's §3 also draws.

### Prompt injection as an authority problem

The channel discipline of mechanism 2 belongs to the capability-security
tradition (object capabilities: Dennis & Van Horn 1966, Miller 2006) rather
than to injection *detection*. Its closest contemporaries are Willison's
dual-LLM pattern (2023) and **CaMeL** (2025, "Defeating Prompt Injections by
Design"): a privileged planner, a quarantined reader of untrusted data, and an
interpreter enforcing data-flow policy. The variant here is coarser — taint
by transport channel, plus a closed vocabulary so tainted text could not
mint a value even if it slipped past the clause filters — and it does the
same thing for *consent* (a confirmation on a channel that cannot consent is
a recorded event, not a permission). What it is not: a guardrail. NeMo
Guardrails, Llama Guard and classifier-based moderation are probabilistic
filters on an output; the architecture note lists "not a guardrails system"
as a non-goal because nothing probabilistic sits in an enforcement path.

### Knowledge graphs, ontologies and their curation

The certified snapshot is a knowledge graph — roughly twenty-six predicates
over a few hundred entities — with three choices that diverge from the
mainstream KG tradition, each load-bearing:

- **Closed-world, not open-world.** OWL reasoning is open-world by design:
  absence is not falsity. That makes a certified count impossible. The
  project sits with SHACL-style shape validation and database semantics; the
  registry loader is a hand-written shape validator. Absence is certified
  too — Mew's `locations` is an honest "none".
- **Vendored, not extracted.** generalization.md §7 draws the line against
  GraphRAG-style pipelines: a model-extracted graph is a *recall structure*,
  useful for finding and unverifiable by construction; verifying against it
  silently downgrades the guarantee to "faithful to an unverified graph."
  Google's Knowledge Vault drew the same extracted-versus-verified line a
  decade earlier. The two-tier answer (certified core, recall layer) is the
  KG-governance form of the propose/verify split.
- **Provenance and validity time as schema.** The fidelity declaration (iteration 27)
  is a bitemporal concern arriving in a graph named for an era: valid time
  versus the world's own transaction time. Validity windows on grants and the
  `snapshotId`/`packId` on every record are the same idea applied to
  decisions — W3C PROV territory, and Inline XBRL is its regulatory
  instantiation, which the render layer imitates on purpose.

Ontology curation maps onto the three roles of §4, and the honest cost
statement ("review is the dominant expense at scale") is the KG maintenance
problem unchanged. Mapping "Pikachu" to `pikachu` is entity linking, and the
scale path of §9 — an untrusted retriever nominates candidates, the grammar
narrows, the verifier checks globally — is the standard candidate-generation
plus disambiguation pipeline with verification bolted on.

### Policy as code, and rules as code

The Accord pack is a small "rules as code" artifact in the sense the OECD's
2020 work used: legislation expressed as data a machine evaluates and a human
can read. generalization.md §2 keeps an honest ledger against general-purpose
policy engines (OPA/Rego, Cedar): they earn their place at a product's act
gateway, compiled *from* a closed reviewed pack, and never as the language
policy is authored in — because an evaluator expressive enough to hide a rule
in is exactly the trusted-computing-base growth this design exists to refuse.

### Tool use and agent frameworks

The claim grammar is function calling with the kernel verifying every
argument against a certified substrate before anything executes, and with
the *reply to the person* also being a verified claim rather than free
prose. Tool results (ReAct-style observations, MCP-style servers) fit
naturally: they arrive on the `tool` channel, are useful for drafting, and
carry no authority. §7's topology — a gate *after* the stack, never a wrapper
around it — is the adoption story for organisations that already run
retrieval pipelines and agent frameworks.

### Evaluation methodology

Less a lineage than a set of disciplines the arc forced, recorded in
[lessons.md](lessons.md): banded toplines at N≥3 rather than single passes,
noise decomposed into per-call sampling, between-run drift and transport
(iteration 22), provider failures counted apart from abstentions, first-attempt
and post-recovery rates reported apart (iteration 20), and vacuity checks so a
safety pass is never a model too timid to test the gate (iteration 19). These echo the
reproducibility literature's concerns and the "LLM-as-judge is not a
verifier" caution, but the specific rule — *only the record may downgrade; a
caller without one cannot launder* — is the project's own.

---

## 3. Forward directions, stated as hypotheses

Each is a hypothesis with the doctrine it must respect and the measurement
that would confirm it. None touches enforcement; lesson 4 of lessons.md — that
enforcement and usefulness never once needed the same tool — is the design
constraint on all of them. The three directions lessons.md already names (the
enterprise framing, the measurement method note, the critical pass) are
complementary and not repeated here.

### H1. The kernel is a free verifiable reward — spend it at training time

*Deferred (2026-08-26): out of scope for epic #94. Two reasons, both
operational rather than technical — the project has no fine-tuning operations
capability, and no deployment or customer whose real inquiries would supply the
data worth training on. The hypothesis stands; it waits for a real deployment
to supply both. Every usefulness lever in the current epic is deterministic or
prompt-side.*

The single largest lever. The 2024–25 results on reinforcement learning from
verifiable rewards (Tulu 3's RLVR, DeepSeek-R1) and the earlier
rejection-sampling fine-tuning line (STaR) work wherever a checker exists.
Here the checker is the kernel plus the subject oracle (iteration 24), and the harness,
banks, replay and repetition instruments are most of an RL environment
already. Two forms:

- **Synthetic supervision, verified by construction.** Enumerate species ×
  fact ids × question templates, plus rosters, rankings and matchups; every
  label is certified. Fine-tune a small open model on question → claim
  grammar. This attacks the mapping dependency (the one place the design
  leans on model capability) at its root.
- **Reward = accepted and on-target.** Accepted by the kernel is not enough —
  §18's certified non-sequitur shows a model can resolve a true claim to the
  wrong question — so the oracle's subject check must be in the reward.

Doctrine: this is offline and re-litigates no served verdict, so it is
compatible with recovery.md. What it must not become is an inference-time
best-of-N against the gate (a search that turns "verified" into "survived N
attempts" and launders the first-attempt rate). Confirms if: a fine-tuned
12B-class model's stable core on the 52-set rises past the current strong
default's 43 at unchanged enforcement, measured at N=3 within one artifact.

### H2. Schema-aware decoding makes IA-2/IA-3 unreachable from a model

Iteration 19 gates *which claim kinds* the grammar offers. The next step is PICARD's:
build the per-call grammar from the *registry* — valid (entity type, fact id)
pairs, real stat names in criteria, the retrieved entities as the entity
enum — so an uncertified fact id or a misspelled entity cannot be emitted at
all. Iteration 21 found most live IA-3 hits were spellings; canonical folding fixed
the decoder side, and this would fix it at the source. Doctrine: the enum is
a recall aid, never an authority; the verifier stays global. Confirms if:
first-attempt IA-2 and IA-3 denial counts on the smoke set fall to zero with
no change in resolution of the entries that were never denied. Risk to
measure: iteration 17's asterisk — a retrieval miss now means an empty enum, so the
activation rate of the retriever becomes the usefulness ceiling and must be
reported.

### H3. Read-only probing inside the propose zone closes the non-sequitur bucket

The weak model certifies Gengar's types when asked what Gengar is weak to
because it does not know a `matchup` exists that answers it. Let the proposer
call read-only kernel tools before drafting — "which facts exist about this
entity?", "how many members would this roster have?", "what does the chart say
here?" — with results arriving on the `tool` channel. Doctrine: tool results
carry no authority and never bind scope or consent; the draft still faces the
full gate; calls are capped (an unbounded probe is a search). Confirms if: the
`needs-claim-kind` and deflection counts fall on the weak model at bounded
cost per turn; the ceremony metric of epic #87 slice 6 is the instrument.

### H4. Semantic retrieval as the recall tier, with recall reported apart

Today's retrieval is deterministic lexical matching over the closed
vocabulary — exact, auditable, and blind to paraphrase and misspelling
(iteration 17).
An embedding retriever over the *schema and entity names* (never values) as
the nominator would raise recall, at the cost of a probabilistic component
upstream of the gate — which is where §7 says such components belong. The
measurement discipline §9 prescribes applies: report recall@k of the
shortlist and routing accuracy given the shortlist separately, so a retrieval
miss never masquerades as a model failure. Confirms if: answerable resolution
rises on a paraphrased / misspelled bank at unchanged enforcement, and the
funnel names which door failed on every miss.

### H5. A closed query algebra lifts the expressivity ceiling

The hardest usefulness cap is `needs-claim-kind`: every question shape the
grammar cannot express is a forced abstention and a kernel change (each new
kind — `matchup`, `eligibility`, `typeCount`, `gameRule` — landed as
derivation + verifier + crucible mutation). The semantic-parsing answer is a
small closed algebra over the certified graph (a Datalog or SPARQL fragment:
select, filter, join, aggregate) so the model *composes* rather than
*selects*, and the certificate is query plus result. generalization.md §2
warns against an expressive *policy* language; a *query* language over a
closed world is different — results are verified by execution, and the
crucible covers the algebra once rather than each shape. The costs move: every
result type needs a formatter and a slot, and the certificate must stay
legible to the person reading it. Confirms if: the `needs-claim-kind` bucket
shrinks without growing the number of kernel claim kinds, and the certified
page for a composed query is judged readable in the same UX pass that
judges today's.

### H6. Certified surface realisation lifts the prose ceiling

generalization.md §5: the agent certifies; it does not teach or charm, unless
the teaching is itself certified. The classic natural-language-generation
pipeline (Reiter & Dale) separates content selection from surface
realisation, and the second half fits the architecture: a reviewed grammar of
sentence templates the model *selects and fills* from certified slots — the
copy catalogue made compositional — so a certified page reads as an answer
rather than a table while text closure holds exactly as now. Entailment-based
checking of free prose does not fit (probabilistic, in an enforcement path).
Confirms if: the chat-versus-certificate divergence measure of epic #87
slice 4 falls because the certificate itself carries the answer's prose, and
the render walk still binds every sentence to a template id and its slots.

### H7. Learned clarification without learned binding

The ladder is deterministic and already cheap (§16: a recorded question arms
a bare answer). A model trained to ask *good* clarifying questions — the
right dimension, one question, only when genuinely ambiguous — raises
resolution rate while nothing about who binds what changes: the question is
still recorded, the answer still binds only on the trainer's channel.
Confirms if: questions-per-resolution (slice 6's ceremony metric) falls and
resolution rises together, on the dialogue bank at N=3.

### H8. The certification pipeline for prose-fed domains

The demo's upstream arrived structured. The port that matters most turns
prose into typed facts, and §4's stance — a model may propose extractions, a
human certifies, the snapshot only ever holds certified values — is the same
propose/verify split moved to authoring time. The hypothesis is that the
project's own instruments transfer: a crucible for the extraction step
(injected fabrications must be refused at review), a coverage map for
extraction recall, and per-fact provenance so each certification replays.
Confirms if: a second, prose-fed world (even a small one) lands under the
same loader discipline with its own fidelity declaration and an extraction
crucible in CI.

### Two directions on the assurance axis, for completeness

Not usefulness, but natural next steps for the guarantee itself: formal
verification of the kernel (it is small enough to be a plausible Lean or
Dafny target, and the crucible already states the properties as executable
mutations), and pixel-level attestation at the platform layer, which §5
names as the ceiling this project cannot cross on its own.

### The one hypothesis all of the above share

That the residual is always *factorable* — a governed agent that underperforms
does so in named layers, each with a deterministic or a training-time fix
that never touches the gate (lessons.md, lesson 1). If any direction above
only works by weakening a check, the direction is wrong, not the check.
