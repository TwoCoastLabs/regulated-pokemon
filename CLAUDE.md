# CLAUDE.md — Project Guidelines

## What this is

A demonstration that provable factuality and compliance for AI agents come
from architecture, not model capability. The canon is
[docs/the-indigo-accord.md](docs/the-indigo-accord.md); the design is
[docs/architecture.md](docs/architecture.md); the strategy for carrying the
design into real high-stakes domains (and operating a knowledge base under
it) is [docs/generalization.md](docs/generalization.md); the note placing the
design against the academic and industrial field, with forward directions as
hypotheses, is [docs/landscape.md](docs/landscape.md); the build epic (#1) is
complete and closed; epic #94 (realistic inquiries) and epic #118 (scale,
[docs/scale.md](docs/scale.md)) stand behind the current plan, **epic #145**
([docs/routing.md](docs/routing.md): scope belongs to the profile, routing
belongs to the model) — work from the epic, keep its checkboxes honest.

## Publication posture (read first)

This repo is private but **may be open-sourced later, with history**. Write
every commit as if it will be published: no secrets, no internal references
to other projects (this is a standalone, from-first-principles work), no
"temporary" content that would need scrubbing. If something shouldn't be
public, it doesn't go in the repo at all.

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
- **Debug a conversation without a browser:** `npm run session:trace --
  "message" [/confirm|/reject|/act|/decline|/retry] ...` drives the real live
  session (model from `.env`, billable pennies) and prints every phase,
  question, proposal, denial and cost. Reach for it before driving the web UI.
- **Findings log:** [docs/findings.md](docs/findings.md) — every claim this
  project can defend, with the measurement behind it. When a live run teaches
  something, record it there *with its numbers* in the same change; a claim
  without a number is a note, not a finding. It is the evidence base for
  anything published externally, so provenance is stated even when it is weak.
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
