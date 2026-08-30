# Scale: the plan for surviving real-world size

This is the long-term plan for the axis [generalization.md](generalization.md)
§9 opens and this document finishes: what must change — and what must not —
for the architecture to survive a real domain's size. It is written under the
demo-is-the-forge principle: every mechanism here is named as its cheap-local
form (what the demo ships today, honest about 151 species) and its
costly-general form (what a catalogue of millions requires), and the forge
builds the general mechanism in the demo whenever a slice can prove it small.

The organizing fact is one the design already lives by: **the guarantee
scales by construction; what does not scale is everything that helps the
model be useful.** Verification is O(answer) — a manifest's claims against
pinned facts — and stays O(answer) at any catalogue size, provided derived
structures are data. What grows with the catalogue is recall: what the model
is shown, what the grammar offers, what a page can display, how many records
a sweep can re-execute. So the plan hardens one invariant across five axes:

> Nothing nondeterministic or unbounded ever gates proof. Smart retrieval
> nominates; recorded nomination replays; pinned indexes derive; the kernel
> disposes.

## The five axes

| Axis | Cheap-local (shipped) | Costly-general (must survive) |
|---|---|---|
| **1. Catalogue size** | 151 species in memory; `roster.ts` linear-filters; full vocabularies enumerated in grammar and prompt | 10⁵–10⁷ entries; grammar built per call from a nominated shortlist; membership derived from materialized indexes |
| **2. Retrieval** | O(N) lexical scan per question (`reference.ts`), capped rows | Inverted index as a pure function of the snapshot; a semantic tier admissible as a *recorded* propose step |
| **3. Answer surface** | Unbounded `claims` array (a repetition loop runs to the token cap); a roster implied whole in one view | Bounded grammar with counted caps; windowed rosters that swear their partiality |
| **4. Record volume** | `runs/` as JSON in git; the test suite re-executes every filed artifact | Content-addressed records; sampled replay in the PR gate, full sweep async |
| **5. World change rate** | One frozen snapshot per world; a weekly drift check opens an issue | Succession: versions live side by side, grants pin, replay resolves by pin |

Two asymmetries make the plan safe to reason about, both inherited from
generalization.md §9:

- **Recall can fail only by omission.** A capped, stale, or adversarial
  nomination costs an abstention or a mis-route to an adjacent certified
  entry — a usefulness failure, measured, never an integrity failure. The
  certified surface degrades toward silence, not toward invention.
- **Determinism is required at the commit boundary, not the recall tier.**
  A deterministic index is replayable by recomputation. A nondeterministic
  tier (embeddings, a vendor pipeline) becomes replayable by *recording*:
  the transaction files the nominated ids the way it files a model
  completion, and replay reads the record instead of recomputing. What the
  Accord actually demands of retrieval is not that it be lexical — it is
  that it be recorded and non-authoritative.

## The slices

Each slice ships its instrument, enforcement stays a hard zero on every run,
and no slice is finished while a crucible article it owes is uncovered —
the same discipline as every epic, one level up.

### S1 — The bounded grammar

`maxItems` on the answer grammar's `claims` and `rosters` (structured-output
providers enforce it at decode, so a repetition loop is unrepresentable
rather than discouraged); the claim budget stated in the prompt; a decode
failure on a completion that hit the token cap *names* the truncation
instead of reporting generic malformed JSON, in deterministic wording, so
the class is countable from notes and artifacts. The live session's dev
view gains toggles for `retrieval` and `gatedGrammar`, so both doors are
dogfooded per model.

*Gate:* the repetition-loop class is unrepresentable; cap-bound and
truncation counts appear in findings with numbers.

### S2 — The index shelf

Materialized indexes (type → members, condition → items, category →
members) derived at snapshot build time as their own digest-pinned
artifacts beside the snapshot. `buildRoster` reads the index; verification
recomputes-or-checks, so a mismatch is a build failure, never a runtime
judgment. This is "policy is versioned data" applied to structure: a
derived index adds zero trust surface.

*Gate:* a crucible mutation poisons the index and is refused by name; the
clean-path control re-passes.

### S3 — The recorded nomination

The `Transaction` carries the retrieval selection — tier, index version,
nominated ids — and replay reads the record, never recomputes. This is
what licenses a semantic tier later (live harness scripts only, billable,
never CI). The funnel is instrumented as §9 dictates: recall@k of the
nomination stage and routing accuracy given the shortlist, separately, so
a retrieval miss can never masquerade as a model failure.

*Gate:* a mutation shows an adversarial nomination buys nothing (uncertified
ids still deny under IA-3); the replay sweep is green over records with and
without nominations.

### S4 — The shortlist grammar

§9's two-stage route made real: the answer schema is built from the
nominated k instead of the full vocabulary, abstention representable
in-grammar. Measured on both models per the weak-model doctrine — 1-of-k
routing against today's 1-of-N — plus the provider schema-size ceiling
measured before it is hit.

*Gate:* usefulness at k≈20 is at least current on the realistic bank;
enforcement zeros hold; §9's low-hundreds enum cliff is retired with a
number.

### S5 — The windowed roster

Chunked (Merkle-style) roster digests, so one page of a large roster
verifies without hashing the world; the render affidavit swears partiality
— "showing i–j of n, ordered by ⟨confirmed basis⟩" rides in the attested
DOM. A partial display that does not disclose its bounds is the pagination
cousin of the hidden warning.

*Gate:* two mutations — a page presented without its bounds, and a page
ordered by an unconfirmed basis — each denied by name; the run ledger's
roster views paginate off the same mechanism.

### S6 — The record economy

Content-addressed `runs/`; the PR gate replays a deterministic sample plus
every artifact the diff touches; the weekly workflow (the drift-check
pattern) runs the full sweep. The `verify-runs` suite's timeout under load
is this axis's first symptom, already observed.

*Gate:* the timeout class is retired; sweep cadence documented; a published
number still traces to the artifact that produced it.

### S7 — The succession

Two snapshot versions live simultaneously: new grants mint on head, filed
records replay by their pinned version — the pack shelf already does
exactly this for packs; the mechanism extends to snapshots in the live
path. The pack gains a staleness rule: scope valid at grant is re-checked
at commit against the snapshot's certification window (hard-won lesson 8,
applied to data age).

*Gate:* an answer committed against a superseded snapshot denies by name;
a replayed old record still verifies against its pin, byte for byte.

## Sequencing

S1 lands immediately (it fixes an observed failure: a broad ask looped the
grammar to the token cap — 43 seconds to a truncation abstention). S2 → S3
→ S4 are a dependency chain: the shortlist grammar needs the nomination,
the nomination wants the indexes. S5 needs S2. S6 is independent and cheap
— early. S7 last.

This plan is the epic after #94: #94 proves usefulness at realistic
*shape*; this proves it at realistic *scale*. #94's remaining slices feed
it — the composition algebra (H5) is what makes S4's shortlist grammar
composable rather than enumerative, and the activation-ceiling instrument
is the recall@k meter before recall@k exists.

## Deliberately not built

Embeddings in CI (nondeterministic and billable — live harness scripts
only). A real database. Multi-tenant auth. A distributed kernel. Each is an
operational concern the architecture must *tolerate* — and, by the
asymmetries above, provably does — not a mechanism the forge must build.
