# The live session, end to end: where the model speaks and where it never does

This is the mechanism of one conversation turn in the live session
(`src/session/session.ts`), drawn so a cold reader can see which steps are
deterministic functions of the record and which are calls to a model — and
what each model call is shown, what grammar it must reply in, and what
happens to its reply. It sits beside [architecture.md](architecture.md)
(the shape) and [routing.md](routing.md) (the plan for the routing layer);
the diagrams here are the ones that plan reasons about.

One sentence holds the whole design: **the model may only propose, every
proposal is recorded, and nothing it proposes reaches a record without a
deterministic verification that reads the certified data itself.** A filed
transaction replays without any model present (IA-10) because every model
completion is in the record and every verification is a pure function of
the record, the snapshot and the pack.

## 1. One turn, as a sequence

```mermaid
sequenceDiagram
    autonumber
    participant T as Trainer
    participant D as Driver (session.ts)<br/>deterministic
    participant K as Kernel<br/>deterministic
    participant M as Model<br/>nondeterministic, untrusted

    T->>D: say("who's faster, pikachu or raichu?")
    D->>D: social cue? (regex) — no
    D->>K: resolveScope(pack, transcript)
    K-->>D: granted | clarify(asking, question) | refused
    alt clarify, no question armed yet
        D->>D: deterministic doors (switch-back, contradiction re-ask, drift, scope statement, listing cue)
        D->>M: proposeAnswer — discovery hop (no scope, grammar + optional retrieval block)
        M-->>D: JSON: asked (phrase → field | none), rosters, claims, route?
        D->>D: decode → taught / off-domain / needs-scope / unusable / clarifying
        opt the reply was a clarify nomination (clarify on)
            D->>D: options typed against dictionary + registry, chain cap checked
            D-->>T: the advisor's own question, options as clicks — the pick binds at linking
        end
        D->>K: resolveScope(required = only what those claims need)
        K-->>D: granted | clarify
        opt still clarify and the words carry long-tail scope wording
            D->>M: proposeScope — the ladder (plain JSON, no schema)
            M-->>D: {candidate, interpreting}
            D->>D: stale-interpretation guard, duplicate-card guard
            D-->>T: card (confirm / reject) — or the pack's own question
        end
        opt the pack's question is the move (clarify on)
            D->>M: phraseQuestion — the pack's line, the ask, the approved values
            M-->>D: {question} — held to one sentence, a question mark, no digit; else the pack's line
            D-->>T: question event armed for the dimension, the vocabulary's values as clicks
        end
    end
    alt granted
        D->>D: scope statement? listing follow-up? (deterministic)
        D->>M: proposeAnswer — answer hop (scope, retrieval block, gated grammar, routes)
        M-->>D: JSON: asked (phrase → field | none), rosters, claims, route?
        opt reply was only a nomination the executor refused
            D->>M: proposeAnswer again, route door closed
            M-->>D: JSON
        end
        D->>D: decode, schema-linking checks (claims ⊆ asked fields · a pick binds · none → boundary lesson · alias contradiction → question with the fields as options), route executor, guards (subject / set / direction / padding)
        D->>K: compileManifest + verify (facts, rosters, policy, disclosures)
        K-->>D: allowed | denied by article/rule
        opt denied only as IA-2 fact-mismatch
            D->>D: strip asserted values, re-run the gate once (repair, counted apart)
        end
        opt denied at the answer stage for anything else, once (feedback on)
            D->>M: proposeAnswer again — the denial named, in fixed wording; route door closed
            M-->>D: JSON
            D->>D: groom identically, gate once more (feedback retry, counted apart; first denial kept)
        end
        D-->>T: certified page + filed record, or an honest pass by name
    end
```

Everything on the driver and kernel lanes is a pure function of the
transcript, the pack and the snapshot. The model lane is the only source
of nondeterminism, and each of its replies is recorded verbatim in the
transaction (`completions`), which is why the record replays without it.

## 2. The driver's decision tree for one utterance

Two diagrams, because the tree has two halves that never meet: what happens
while scope is still being gathered, and what happens once it is granted.
Green is deterministic driver logic, indigo is the kernel, amber is a model
call.

**Before scope is granted — gathering.** The deterministic doors run first;
the model is asked only to learn the answer's *shape*, and the ladder only
when the trainer's words carry scope wording the vocabulary cannot read.

```mermaid
flowchart TD
    classDef det fill:#e6f2ec,stroke:#2e7d5b,color:#16192b
    classDef model fill:#fbeedd,stroke:#b8761a,color:#16192b
    classDef kernel fill:#e3e5f7,stroke:#3b3fa8,color:#16192b
    classDef out fill:#ffffff,stroke:#5b6078,color:#16192b

    U[utterance]:::det --> S{social cue?}:::det
    S -- yes --> S1[social note, no model]:::out
    S -- no --> PK{advisor's question<br/>waiting?}:::det
    PK -- pick matches one option --> PB[pick bound for linking]:::det --> R[resolveScope]:::kernel
    PK -- fresh ask --> C3
    PK -- neither --> PR[restate once,<br/>then honest pass]:::out
    PK -- none waiting --> R
    R -- granted --> G[go to the granted half]:::out
    R -- clarify --> C1{switch-back or<br/>version contradiction?}:::det
    C1 -- yes --> Q1[pack question, version only]:::out
    C1 -- no --> C2{fresh ask over an<br/>armed question or card?}:::det
    C2 -- yes --> C3[set aside, reopen at the new ask]:::det --> R
    C2 -- no --> C4{bare listing cue?}:::det
    C4 -- served --> G
    C4 -- no --> M1[proposeAnswer<br/>discovery hop]:::model
    M1 -- lesson --> T1[lesson filed]:::out
    M1 -- nothing --> T2[redirect note]:::out
    M1 -- clarify nomination --> CL[options typed, chain capped:<br/>the advisor's own question]:::out
    M1 -- other claims --> R2[resolveScope, narrowed to<br/>what those claims need]:::kernel
    R2 -- granted --> G
    R2 -- clarify --> L{long-tail scope<br/>wording present?}:::det
    L -- no --> M6[phraseQuestion<br/>the pack's line reworded]:::model --> Q2[question armed,<br/>values as clicks;<br/>or card restated]:::out
    L -- yes --> M2[proposeScope<br/>the ladder]:::model
    M2 --> LG{fresh interpretation,<br/>not a duplicate?}:::det
    LG -- no --> M6
    LG -- yes --> CARD[card: confirm / reject]:::out
```

**After scope is granted — answering.** Two deterministic drafts can
pre-empt the model (the records boundary, a listing follow-up); otherwise
the model composes, the guards trim, the kernel rules, and one repair may
re-run the gate without a model.

```mermaid
flowchart TD
    classDef det fill:#e6f2ec,stroke:#2e7d5b,color:#16192b
    classDef model fill:#fbeedd,stroke:#b8761a,color:#16192b
    classDef kernel fill:#e3e5f7,stroke:#3b3fa8,color:#16192b
    classDef out fill:#ffffff,stroke:#5b6078,color:#16192b

    G[scope granted]:::kernel --> F{foreign version?}:::det
    F -- yes --> F1[boundary lesson filed]:::out
    F -- no --> P{statement of<br/>scope only?}:::det
    P -- yes --> P1[acknowledge, close]:::out
    P -- no --> B{listing follow-up?}:::det
    B -- yes --> B1[draft composed<br/>deterministically]:::det --> V
    B -- no --> M3[proposeAnswer<br/>answer hop]:::model
    M3 --> RF{only a nomination<br/>the executor refused?}:::det
    RF -- yes --> M4[proposeAnswer again,<br/>route door closed]:::model --> D
    RF -- no --> D[decode + schema linking:<br/>a pick binds; claims held to the asked fields,<br/>none → boundary lesson,<br/>alias contradiction → question with the fields as options]:::det
    D -- clarify nomination --> CL2[the advisor's own question,<br/>options typed, chain capped]:::out
    D --> E[route executor and guards:<br/>subject, set, direction, padding]:::det
    E --> V[compileManifest + verify]:::kernel
    V -- allowed --> OK[record filed, page rendered]:::out
    V -- denied, only fact mismatches --> REP[strip asserted values,<br/>gate once more]:::det --> V
    V -- denied otherwise, feedback on, once --> FB[proposeAnswer again,<br/>the denial named]:::model --> D
    V -- denied otherwise --> DN[record: denied by article and rule]:::out
```

There are exactly six amber nodes across the two halves; §3 lists what
each is shown. Note where the amber nodes sit: always *between* deterministic
checks, never adjacent to a record. A record is only ever written by the
kernel node or by a driver note that files nothing — the fifth node, the
feedback retry, re-enters the same decode and the same gate as the first,
so a loop can only end in a certified answer, an honest pass or a denial
by name; and the sixth, the phrase step, supplies wording alone — what the
question is about, what a reply may bind to and which values are offered
are the pack's, so a bad rewrite costs one call and the pack's own line.
The advisor's clarification (the two white `CL` nodes) is not a seventh
call: it is a reply the answer hop may give instead of claims, typed and
capped by the driver, and the trainer's pick is applied at the same
linking step every claim goes through.

## 3. Every model call the live session can make

| # | purpose | when | prompt (see §4) | grammar | what the reply becomes | if the reply is bad |
|---|---|---|---|---|---|---|
| 1 | `answer` — discovery hop | scope not yet granted, no question armed, the deterministic doors stood down | answer prompt with **"Scope is NOT established yet"**; retrieval block when `retrieval` is on | `answerSchema` (`asked` over the data dictionary's fields + `none`; + `route` variants; filler kinds gated by the cue) | a lesson commits at once; anything else is read as *intent* and names the scope to establish | unreadable → fall to the version floor; empty → off-domain redirect |
| 2 | `scope` — the ladder | clarify, a question is not the better move, the words carry long-tail scope wording | scope prompt: the trainer's lines, the missing dimensions, the approved values | none (plain JSON asked; decoded by `decodeCandidate`) | an untrusted `proposal` event; binds only on the trainer's confirmation | malformed or stale → the pack's own question |
| 3 | `answer` — answer hop | scope granted, no deterministic draft | answer prompt with **"Scope is established: …"**; retrieval block; `previously` for anaphoric asks | as #1 | decoded draft → executor/guards → kernel | malformed → honest pass; token cap → truncation named |
| 4 | `answer` — route-door-closed retry | #1 or #3 replied with only a nomination the executor refused | same prompt, `routes` omitted | as #1 minus the route variants | as #3 | as #3 |
| 5 | `answer` — verifier-in-the-loop retry (R3b) | #3's groomed draft was denied at the answer stage for anything but the repair's all-fact-mismatch class — or the driver itself emptied the reply at linking (every claim off the ask or about no subject, where the model had written something: `driver/no-subject`, `driver/off-ask`; dogfood 2026-09-06) — `feedback` on, once per answer, on either hop | same prompt plus **"Your previous answer … was refused by the verifier, by name"** and one line per violation in fixed wording (`IA-3/fabricated-entity: "gym-badge" is not certified…`); `routes` omitted | as #4 | groomed identically to #3, gated once more; counted as `feedbackRetries`, the first denial kept in `feedbackDenials` | a second denial files as a denial |
| 6 | `phrase` — the pack's question reworded (R3b step 3) | the pack's fixed question is the move (no ladder, or the ladder fell through), `clarify` on, once per dimension per ask | the trainer's lines, the pack's own wording, the approved values; "put that question in your own words … state no fact, no value and no number" | `{"question": string}` | a `question` event armed for the same dimension, text the model's; the phase carries the vocabulary's values as clicks | not one sentence ending in `?`, a digit, too long → the pack's own line (`clarification.unphrased`) |

Calls #1 and #3 also admit, when `suggest` is on, a **suggest entry** — `{"kind": "suggest", "asks": [up to three short questions]}` — lifted out at decode and never a claim: the driver drops any that state a value (a digit, a certified id), the rest ride in the manifest's `suggestions` and render as the certified page's one labelled register (`data-unit="suggestions"`, items marked `data-suggestion`), which the walker attributes to the model, the affidavit swears visible, and the verifier holds to the record by equality. The kernel refuses a manifest whose suggestion states a value, so the register can carry a question and never a fact.

Calls #1 and #3 also admit, when `clarify` is on, one more reply shape beside claims and routes: the **clarify nomination** — `{"kind": "clarify", "about", "question", "options": [{"kind": "field", "label", "fieldId" | "none"} | {"kind": "entity", "label", "entityId"}]}`. It is not a call of its own: the driver validates every option (a dictionary id or `none`; a registry-certified subject), drops the rest, caps the chain at two per ask, and records the question as a `clarification` event with its typed options. The trainer's reply is read against the options (label, dictionary alias, subject name; a subject question answered with an unlisted certified subject is a pick too); one match binds — a field pick holds the next reply's claims to that field, a subject pick drops claims about any other certified subject — none restates once then passes honestly, and a fresh ask is drift. An alias contradiction (R3) takes the same shape with the two fields as options, driver-worded.

Not in the live session: `proposeRawAnswer`, the harness's ungoverned control arm (same question, same grammar, no kernel), which exists so a published number has its comparison leg.

What every call shares (`src/harness/openrouter.ts`): a fixed **system
persona** (`HONEST_PERSONA`; the adversarial persona is a harness setting
for red-team runs), `temperature: 0` — *requested and not relied upon*,
providers diverge at 0 — a `max_tokens` cap, and for the answer calls
`response_format: json_schema, strict: true` so the provider enforces the
grammar at decode time (folded per provider where one rejects a keyword,
e.g. `maxItems` for Google models, with the cap re-enforced by the
decoder).

## 4. The prompts, section by section

Both prompts are pure functions of recorded inputs (the pack, the
registry, the transcript slice, the scope, the door flags). No clock, no
environment, no hidden state — the same inputs always build the same
bytes, which is what makes a filed run reproducible.

### The answer prompt (`answerPrompt`, calls 1, 3, 4)

In order:

1. **The retrieval block** (when `retrieval` is on — the product default).
   `retrieveReference` lexically selects the species and moves the ask
   names and prints their certified rows: `charizard | 6 | fire,flying |
   … | 78 84 78 109 85 100`, the learnset, and any move rows. Facts only;
   never policy. The block says: *cite these; do not answer from memory.*
   Grounding changes what the model is asked, never what may commit — the
   kernel recomputes every value regardless.
2. **Scope status.** Discovery: "Scope is NOT established yet … a lesson
   can be certified right now; any other claim is read as intent … small
   talk gets no claims … when a built-in door fits, nominate it." Answer
   hop: "Scope is established: version=… region=… badges=…".
3. **Earlier words**, only for an anaphoric ask ("can you list at least
   10 for me?"), labelled as context, not the ask. Trainer channel only.
4. **The trainer's own words** — the current exchange's utterances,
   nothing else. Only the trainer speaks for the trainer (IA-8).
5. **The contract.** Answer what was asked and assert nothing unrequested
   (an unrequested claim is one more thing that can be wrong, and one
   wrong claim refuses the whole answer); omit rather than guess; at most
   twelve claims and four rosters; prefer the most specific claim kind.
6. **The shape**: one JSON object `{rosters, claims}`; the roster
   criteria vocabulary (`has-type`, `learns-move`, `rarity`,
   `stat-at-least`…; `{"all": []}` is the whole certified set).
7. **The claim catalogue**, one line per kind with its rule: `fact`
   (name it, the kernel reads the value), `count`, `gameRule`,
   `membership` (how to list), `comparison`, `ranking` (the system names
   the winner), `matchup` (direction follows the question, not the
   subject), `eligibility` (the rule itself is a useful answer),
   `explanation` (a reviewed lesson, last resort), `recommendation`,
   `action` (executes only on consent).
8. **The nominations**, when offered: the route catalogue (`listing`,
   `profile`) with each route's description and arguments — the door, not
   the work.
9. **The schema linking** (R3b, since 2026-09-05): before the claims, one
   `asked` entry per thing the trainer asked for — their phrase, the
   subject's id, and the certified field it names or the reserved `none`
   when the records certify no such field. The prompt says `none` is an
   honest answer, that linking a field which merely resembles the ask is
   not, and that a fact, comparison, ranking or matchup about an unlinked
   field is dropped.
10. **The closed lists**: lesson ids, rule ids with what they count, tool
   ids, and **the data dictionary** — every certified field by id with its
   everyday name and one line of description, grouped by the subject whose
   field it is (species, move, item, the type chart) — *ids and
   descriptions, never values*. The aliases are not shown: they are the
   driver's cross-check, not a hint. An id outside these is unrepresentable
   in the grammar and refused by the kernel if it somehow arrives.

What is deliberately **not** in the prompt: any fact value, any count,
any policy threshold. The prompt describes a contract; the content the
model asserts is still its own, so the usefulness number measures the
model and the enforcement number measures the kernel.

### The scope prompt (`scopePrompt`, call 2)

Short by design: the trainer's lines, "Still unestablished: version,
…", the instruction to propose one approved value per dimension *from the
trainer's own words*, quoting the exact wording it is reading in
`interpreting`, and the approved values per dimension. The reply is a
`proposal` event that binds nothing until the trainer confirms it — and
the driver holds the model to its own label: an interpretation whose
substantive words are not in this exchange is stale and is discarded.

## 5. What is deterministic, listed

Every one of these reads only the record, the pack and the snapshot, and
is covered by offline tests with scripted models:

- scope resolution and every block rule (channel, quoted, reported,
  instruction, negation, question, unconfirmed, rejected, digest,
  unapproved, superseded); the profile and answer routes; contradiction
  → question
- the social register, the switch-back and contradiction re-ask, the
  drift door, the scope-statement acknowledgment, the catalogue bareness
  reading, the records boundary (the listing cue door and the deflected
  profile are gone — R3b step 5; their executors survive as nominations)
- decoding (shape only — a well-formed lie passes through to the kernel
  on purpose), the fold of self-comparisons, the claim budget
- the route executors and their guards; the wrong-set, direction and
  padded-lesson guards; the eligibility route
- clarification's driver half (`src/session/clarify.ts`): option
  validation against the dictionary and the registry, the pick matcher,
  the chain cap, the scope options; the phrased question's structural guard
  (`usableQuestion`); the bound pick applied at linking
- the manifest compile and every verification (facts against the
  snapshot, rosters recomputed, policy gates, mandatory disclosures,
  text closure, the render affidavit); the strip-assertion repair
- the suggestion register's two gates (`suggestionProblem`: no digit, no
  certified id; the driver's drop and the kernel's refusal), and the
  register's closure on the page (each mark held to the manifest by
  equality, inside the one labelled unit)
- replay: a filed transaction re-verifies byte for byte with no model
- the driver's ledger (`src/session/ledger.ts`, issue #158): every step
  above, as the driver took it, recorded per exchange in fixed wording —
  lane, code, one line — beside the kernel's record and never inside it;
  a filed bank run carries it, the tracer prints it, and a scripted
  conversation writes the same ledger twice
- the step trail (`src/ui/trail.ts`, issue #158): the ledger and the
  record projected into one laned sequence per exchange, drawn in the live
  page's console and dev view (each model call's prompt and reply under the
  step it preceded) and beside the run ledger's console — reconstructed
  from the record alone, and labelled so, for runs filed before the ledger
  existed; every filed run in `runs/` renders without a missing step

And the nondeterministic list is §3's six rows. That asymmetry is the
architecture: usefulness lives in the amber nodes and is measured;
enforcement lives everywhere else and is proven.

## 6. What R3b changes in this picture

[routing.md](routing.md) R3b removes the deterministic *dispatch* doors
(listing cue, prior-roster, deflected-profile dispatch, boundary tokens)
and adds one thing to the answer grammar: the model must declare, per
phrase asked, which certified **field** it read the phrase as — from an
enum built from the domain's data dictionary — or `none`: *schema linking*,
in the text-to-SQL sense. The driver then
checks structure (claims inside the fields asked; `none` → the records'
boundary; an alias contradiction → ask) instead of English. The green
nodes lose their domain words; the kernel is untouched. *Landed
2026-09-05:* the dictionary, the `asked` mapping and the three checks
(`src/session/linking.ts`), the boundary tokens deleted, and the fifth
amber node — the verifier-in-the-loop retry. *Landed the same day, step
3:* the clarify nomination (the model may ask, with typed options; the
pick binds at linking), the alias contradiction as that same question, and
the sixth amber node — the pack's scope question in the model's words,
guarded structurally and falling back to the pack's line. *Step 4,
2026-09-06:* follow-up suggestions — the model's own questions on the
certified page, in one labelled register the affidavit attributes to it,
held to the record by equality and to the topic-not-value rule at two
gates. Still to land: the dispatch doors' deletion, one at a time with a
bank leg each (routing.md, sequencing step 5).

```mermaid
flowchart LR
    classDef det fill:#e6f2ec,stroke:#2e7d5b,color:#16192b
    classDef model fill:#fbeedd,stroke:#b8761a,color:#16192b
    classDef data fill:#e3e5f7,stroke:#3b3fa8,color:#16192b

    DICT[(data dictionary<br/>field ids · names · aliases · descriptions<br/>domain-owned)]:::data
    ASK[trainer's ask]:::det --> M[model nominates<br/>asked → field or null<br/>route · unavailable · claims]:::model
    DICT -- enum --> M
    M --> CHK[driver: structural checks<br/>claims ⊆ fields asked<br/>null → unavailable note<br/>alias contradiction → ask<br/>route → guarded executor]:::det
    DICT -- aliases --> CHK
    CHK --> K[kernel verifies · O answer]:::data
```

The full design — *schema-linked routing*, with the effort ledger and the
third-world plan that makes the onboarding claim measurable — is the R3b
section of [routing.md](routing.md).
