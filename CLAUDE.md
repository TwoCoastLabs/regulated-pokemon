# CLAUDE.md — Project Guidelines

## What this is

A demonstration of a two-sided hypothesis: **a governed agent can be both
provably compliant and useful enough to ship, and the two come from
different places.** Compliance comes from architecture — no model output
crosses a commit boundary unverified, so violations are zero on every
model, with no error budget. Usefulness comes from layers the operator owns
— retrieval, grammar, data, dialogue, and the model as a replaceable input —
and the claim is that the governance tax on usefulness can be driven to a
product-grade floor by those layers alone, without weakening a single check.
Both are north stars; neither may be traded for the other (the measured
form of each is in [docs/generalization.md](docs/generalization.md) §11,
"The north stars"). The canon is
[docs/the-indigo-accord.md](docs/the-indigo-accord.md); the design is
[docs/architecture.md](docs/architecture.md); the boundary of every guarantee,
its correctness taxonomy and its falsification criteria are
[docs/assurance-case.md](docs/assurance-case.md); and the mechanism of one live
turn — which steps call a model, which never do, and what each prompt holds —
is [docs/session-flow.md](docs/session-flow.md); the strategy for carrying the
design into real high-stakes domains (and operating a knowledge base under
it) is [docs/generalization.md](docs/generalization.md); the note placing the
design against the academic and industrial field, with forward directions as
hypotheses, is [docs/landscape.md](docs/landscape.md); the build epic (#1) is
complete and closed; epic #94 (realistic inquiries) and epic #118 (scale,
[docs/scale.md](docs/scale.md)) stand behind the current plan, **epic #145**
([docs/routing.md](docs/routing.md): scope belongs to the profile, routing
belongs to the model) — work from the epic, keep its checkboxes honest.
Terms with a repo-specific meaning (leg, arm, porch, door, crucible, band,
governance tax) are defined in [docs/glossary.md](docs/glossary.md); a
term coined in new work goes there in the same change.

## Publication posture (read first)

This repo is private but **may be open-sourced later, with history**. Write
every commit as if it will be published: no secrets, no internal references
to other projects (this is a standalone, from-first-principles work), no
"temporary" content that would need scrubbing. If something shouldn't be
public, it doesn't go in the repo at all.

## Describing work

**Start from the goal.** A proposal of work, a PR description, or a findings
entry opens with what it is trying to achieve in the project's own terms
(which north star, which question it answers, why now), then how it works in
plain words, and only then the mechanism — files, functions, flags, numbers.
A term coined during the work is defined before it is used.

**Use plain, concise terms.** Say what a number is, not what it is called
internally, and avoid analogies and coined phrases in anything a reader
has to act on. Two standing examples: the "honest-disposition rate" is
the **correct-decline rate** — how often the system correctly declines a
question it should not answer (a missing fact, restricted advice, an
off-topic ask); "the weakest companion" is just **the lowest of the
usefulness numbers**. Prefer the plain phrase in reports, PR text,
findings prose and conversation; a doc that already uses the internal
name defines it in plain words the first time.

## Commands

- Node 22 (`nvm use`).
- **Test:** `npm test` (vitest; deterministic, key-free)
- **Test with the coverage floor:** `npm run test:coverage` — this is the CI
  gate. Thresholds live in `vitest.config.ts` and ratchet upward only.
- **Typecheck:** `npm run lint` (`tsc --noEmit`)
- **Run it:** `npm run demo` — the transaction seam played as a compliance
  trace; `-- --list` for the conversations and sabotages. Self-checking, so CI
  runs it. It builds to `dist/` first: the kernel imports with `.js`
  specifiers, which `node --experimental-strip-types` cannot resolve.
- **Upstream drift:** `npm run snapshot:fetch -- --check --head` re-derives the
  snapshot from PokeAPI's current head. Needs the network, so it never runs in
  the PR gate; a weekly workflow runs it and opens an issue.
- Live-model harnesses (Phase 7+) are separate, explicitly billable scripts;
  they never run in CI and always write run artifacts.
- **The governance tax:** `npm run coverage:map -- --live --raw ...` runs the
  raw arm beside the governed leg — the same entries, the same model, no
  kernel, the reply published as-is and metered afterwards — and the
  artifact carries governed beside raw per disposition. This is the
  usefulness north star's number; a usefulness leg without it reports a
  count, not the tax.
- **Debug a conversation without a browser:** `npm run session:trace --
  "message" [/confirm|/reject|/act|/decline|/retry] ...` drives the real live
  session (model from `.env`, billable pennies) and prints every phase,
  question, proposal, denial and cost. Reach for it before driving the web UI.
- **Findings log:** [docs/findings.md](docs/findings.md) — every claim this
  project can defend, with the measurement behind it. When a live run teaches
  something, record it there *with its numbers* in the same change; a claim
  without a number is a note, not a finding. It is the evidence base for
  anything published externally, so provenance is stated even when it is weak.
- **The precedent door:** `npm run precedents:promote -- <coverage
  artifact.json>` turns a filed bank run into the operator's memory
  ([docs/precedent.md](docs/precedent.md), epic #169): only runs the kernel
  accepted *and* the oracle passed, values stripped, into
  `data/precedents/<pack id>.v1.json`, which the live page, the tracer and
  the banks read and nothing on the live path writes. Key-free and
  deterministic; the diff is a reviewed PR. `coverage:map -- --precedents
  nearest|fixed` runs the door as a lever (the fixed arm is the few-shot
  control); `session:trace -- --no-memory` is the off arm on the porch.
- **The answer prompt is a lever too:** `--prompt blocks` (tracer and
  `coverage:map`) builds the block-sequenced prompt of
  [docs/answer-prompt.md](docs/answer-prompt.md) beside the legacy one, and
  `--refusal-feedback` carries a refused nomination back to the model by
  name instead of withdrawing the door in silence. Prompts are structural,
  never tuned to one model: any prompt change runs on both models.
  `--offered-doors` (both tools) puts the listing door in the grammar only
  when the driver would accept a nomination of it
  ([docs/offered-door.md](docs/offered-door.md)); the bank records the
  door's funnel — offered, nominated, served — per sample either way.
  `--lesson-door` (both tools) narrows the explanation route to the lessons
  the ask is about, plus the records-boundary lesson, read from each
  lesson's `covers` in the pack ([docs/lesson-door.md](docs/lesson-door.md));
  `--lesson-classifier` adds one model call asking what kind of question an
  ask is, only where no lesson matched. `npm run lesson-door:read` is the
  live reading of that door on the held-out sets, filed under
  `runs/lesson-door/`. Both doors passed their bank gates on 2026-09-17
  (findings §25): together they take the correct-decline rate from 117 to
  135 of 174 on the strong model and 94 to 117 on the weak; the classifier
  moved nothing the bank can see. Making the two doors the default is the
  next change.
- **The decline ledger:** `npm run decline-ledger -- <coverage artifact.json ...>`
  reads filed runs and lists every sample on a question that must not receive
  a certified answer which got one anyway, what the record certified instead,
  and the layer that owes the fix ([docs/decline-ledger.md](docs/decline-ledger.md)
  is the filed reading over the six M3 legs; epic #170 K2, findings §23).
  Key-free, deterministic, no spend. Its first reading found that 61% of the
  misses are a pack lesson on the wrong subject; the fix is designed in
  [docs/lesson-door.md](docs/lesson-door.md) (offer a lesson only when the
  ask is about it, with each lesson's coverage declared in the pack). Built
  behind `--lesson-door`; the porch reading is findings §24 and the bank
  gate, pre-registered there, is not yet run.
- **Results page:** `npm run harness:results` renders a filed run artifact as
  Markdown (newest in `runs/` by default; `-- <artifact.json>` for one,
  `-- --out docs/results.md` to file it). Pure and key-free — it only reads an
  artifact, so a published number is always traceable to the run that produced
  it, never hand-transcribed.
- **Web app:** `npm run app:dev` serves the Phase 8 UI; `app:build` bundles
  it (CI does, so it cannot rot). Four pages, split by where truth comes
  from. The **run ledger** replays the filed artifact in `runs/` as pages —
  chat, certified page, compliance console — and never recomputes: everything
  on that screen is read from the record. The **scoreboard** lays that same
  record's models side by side, with a governed-vs-raw toggle when the record
  carries the control arm — the A/B as two legs that never share a band. The
  **crucible** page is the opposite on purpose: it runs the real kernel live
  in the tab — the same mutation values CI runs, against the bundled snapshot
  and pack — so a visitor can press a sabotage and watch its named denial.
  The **live session** page puts a real model behind that same kernel with
  the visitor as the trainer (`src/session/`, driven bring-your-own-key: the
  visitor's OpenRouter key stays in tab memory, goes only to openrouter.ai,
  and bills them); every settled exchange files a replayable `Transaction`.
  Beside the chat, a side pane with two tabs — the **dev view** (default:
  the step trail with each model call disclosed under its step, the recall
  doors, the trace export) and the **compliance console** (the same trail in
  the League's words, plus the filed records) — draws the **step trail**
  (`src/ui/trail.ts`): every move of every exchange on its lane — trainer,
  driver, kernel, model — read from the driver's ledger and the record,
  never narrated; the run ledger draws the same trail beside its console. A
  round sent back to the model (a nomination the driver refused, a denial
  the kernel carried back) is its own steps on the trail, in plain words,
  saying whether the model was told; the chat says so under the answer
  that came after. Every answer-step call declares the **doors** its prompt
  held open (`DoorState`), and the dev view draws them as a strip under the
  call, marking what changed since the call before — a door withdrawn, a
  reason fed back — with a legend that draws the trick once. The
  precedent door is one of them, with an **empty** state drawn apart from
  shut (open, and nothing near enough to show: the activation ceiling,
  visible), a panel under the call listing what was held (ids and kinds,
  no values), and a **memory panel** showing the store as loaded and the
  session's accepted exchanges a reviewer can mark for promotion — to a
  file for a PR, never to the store the tab reads. The
  filing step opens onto the certified manifest (`src/ui/claims.ts`): each
  claim's scale in the record's own numbers ("1 of 9", "42 members", "2
  values") and the lines it was formed from — the ranked field, the set's
  members, the two values compared. Dogfood a porch round from the trail
  before reaching for the trace file.
  All four go through tested, coverage-counted code below `app/`; the app
  itself still ships with no model and no key — a key exists only when a
  visitor types theirs, and CI exercises the session driver with scripted
  models only.

## LLM keys

- Keys live only in `.env` (gitignored; template in `.env.example`).
  `OPENROUTER_API_KEY` is the one required for live runs.
- Never place a key in a tracked file, a commit message, a log paste, or an
  error report. If a key leaks into history, rotate it — do not rewrite.

## Code rules

- **Fail closed.** A stage that cannot prove, refuses. Every denial names its
  Accord article (`IA-3/fabricated-entity`); "blocked by policy" is banned.
- **No LLM in enforcement paths, none in CI.** Models live only inside
  "propose" steps; nothing they emit crosses a commit boundary without
  deterministic verification.
- **Policy is versioned data.** Eligibility/disclosure rules live in the
  declarative Accord pack, not scattered through agent code.
- **Never weaken a crucible to go green.** A failing mutation test is either
  a kernel bug or a wrong expectation — fix the root cause. Skips, xfails,
  and loosened assertions in enforcement tests require explicit approval, and
  CI greps `src/crucible/**` for them.
- **Article coverage is the gate; the percentage is a backstop.** Every
  Accord article has a mutation denying it by name, or is listed in
  `NOT_YET_COVERED` (`src/crucible/phases.ts`) against the phase that will.
  Shrinking that list is how a phase is finished — a phase cannot be ticked in
  the epic while an article it owns is still in it.
- Kernel stays small and readable; it is meant to be read. Prefer a boring
  explicit check over a clever abstraction.
- The article registry (`src/kernel/accord.ts`) is pinned to the Accord
  document by test; changing one means changing both.

## Model doctrine for live runs

- **The weak model is a feature.** Run every live harness on at least one
  capable model and one deliberately weak/cheap model. An invariant that
  only holds on the good model is evidence the architecture leans on model
  behavior it does not control.
- **Report enforcement and usefulness separately.** Enforcement metrics
  (fabrications, wrong-scope commits, unauthorized actions) are hard zeros
  on every run. Usefulness (resolution rate, prompts-to-answer, abstention)
  is empirical, per-model, sample-bounded — never blend the two.
- **Usefulness is a north star with a bar, not a number to admire.** Every
  usefulness leg reports the *governance tax* — the governed stable core
  beside the same model's raw (ungoverned) resolution on the same entries —
  and the honest-disposition rate on entries that must not resolve. A
  direction that lifts usefulness only by weakening a check is wrong, not
  the check.
- **Report a metric as count and percentage together** — `65/79 (82%)`, never
  `82%` alone and never `65` alone — wherever a denominator exists, so a
  reader never does the mental math and a percentage can never hide a
  small sample. Enforcement zeros state their denominator too (`0 of 96`).
- Never hide provider failures inside semantic rates; count them separately
  and fail loudly if every call failed.

## Hard-won engineering lessons (apply throughout)

1. **A deterministic alias carries full authority — give it context
   discipline.** Bare-noun aliases ("yellow") wrongly mint values on
   paraphrases and misspellings. Require context in the pattern; route
   vaguer wording through the propose/confirm ladder. And a recorded
   clarifying question **is** context: bind its direct answer
   deterministically (the question sits in the transcript, so the leniency
   is auditable) and let the pack's question outrank the model ladder when
   the trainer's latest words hold nothing the vocabulary lacks — otherwise
   every one-word answer costs a model proposal and a confirmation card,
   and rigor decays into interrogation.
2. **A confirmation commits the challenged mappings, not completeness.**
   After any confirmation, re-check required dimensions; incomplete falls to
   clarification, never partial release.
3. **The simulated truthful user must verify every pinned dimension of a
   challenge** — checking only the "interesting" one lets a wrong candidate
   on another dimension commit invisibly. Same trap in real UX copy.
4. **Verify the final DOM, never the renderer's claims.** Visibility means
   hidden/aria-hidden/display:none/opacity/unopened-details/detached; digest
   visible content with control-character separators so text cannot reflow
   across component boundaries into a colliding digest.
5. **Providers are nondeterministic even at temperature 0.** Identical
   prompts diverge across repetitions. Design for it: sample-size dials, not
   single-shot assertions; fail-fast N=1 before paying for N=3.
6. **Deterministic activation gates trade recall for specificity.** A regex
   front door that never engages is a silent usefulness ceiling — measure
   which inputs never reach the model instead of assuming.
7. **A model can be too timid to be an adversary.** A safety test the model
   never actually attempts to violate passes vacuously — detect and fail
   that leg rather than reporting false confidence.
8. **One proof identity, timestamps ordered, windows checked at action
   time.** Scope valid at render is not scope valid at execution; check
   again when it matters.
