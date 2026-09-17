# Glossary

Terms this repo uses with a specific meaning. One or two lines each; the
linked doc has the full treatment. If a term you meet in a doc, a finding
or a PR is not here, that is a bug in this file.

## The system

- **Accord (the Indigo Accord).** The policy document the agent is governed
  by. Its rules are **articles**, numbered `IA-1` to `IA-10`. Every refusal
  names one (`IA-3/fabricated-entity`). [the-indigo-accord.md](the-indigo-accord.md)
- **Pack (Accord pack).** The versioned data file that holds the rules,
  lessons, dictionary, restrictions and presentation policy
  (`data/accord-pack/v3.json`). Older versions are frozen because filed
  records pin them. [architecture.md](architecture.md)
- **Snapshot.** The certified data — the Pokémon records — pinned by
  digest. A **world** is a snapshot plus a pack.
- **Kernel.** The deterministic verifier. No model runs inside it. Nothing
  an answer commits reaches the trainer without passing it.
- **Driver (session).** The code that runs one conversation: calls the
  model, applies the kernel, files the record. `src/session/`.
  [session-flow.md](session-flow.md)
- **Executor.** Driver code that carries out a route the model asked for
  (for example, builds the listing).
- **Trainer.** The user. The game's word for a player.
- **Scope / profile.** The trainer's game version, region and badge count.
  Some answers depend on it.

## Answers

- **Claim.** One certified statement in an answer: a fact, a count, a
  lesson, a recommendation, and so on.
- **Manifest.** The full set of claims an answer commits. The kernel
  verifies the manifest, not the prose.
- **Grammar / answer schema.** The JSON schema the model's reply must fit,
  enforced at decode time. What is not in the grammar cannot be said.
- **Route / door.** A kind of answer the model may ask for instead of
  answering directly: `listing`, `profile`, `explanation`, and so on.
  "Door" means a route as offered in the grammar. An **offered door** is a
  route present in the grammar only when the driver would accept it.
  [offered-door.md](offered-door.md)
- **Nomination.** The model asking to use a route rather than composing
  claims itself.
- **Lesson door.** The explanation route narrowed to the lessons the ask is
  about, plus the records-boundary lesson, read from each lesson's declared
  coverage in the pack. `--lesson-door`. [lesson-door.md](lesson-door.md)
  The *matcher* is the step that decides which lessons an ask is about;
  the shipped one is the alias matcher, and a BM25 index is kept as the
  negative control (`src/session/lesson-matcher.ts`). The **classifier**
  is the fallback: one model call asking what kind of question an ask is,
  only where the matcher found nothing. `--lesson-classifier`.
- **Lesson (explanation).** A certified block of text from the pack's
  curriculum that explains a concept ("what is a Gym Leader?").
- **Records-boundary lesson.** The lesson that says the records do not hold
  what was asked. Taught alone, it is the honest refusal.
- **Transaction / record.** The filed, replayable record of one exchange.
- **Replay.** Re-verifying a filed record against its pinned snapshot and
  pack. It must give the same verdict.
- **Affidavit.** The kernel's proof about the rendered page: what was
  actually visible to the trainer.
- **Trail (step trail).** The per-exchange list of every move on each lane
  — trainer, driver, kernel, model — read from the record, never narrated.

## Enforcement

- **Denial.** The kernel refusing a proposed answer, named by article and
  rule.
- **Crucible.** The mutation test suite. Each mutation declares the article
  it expects to be denied under; being denied for a different reason is a
  finding, not a pass. `src/crucible/`.
- **Escalation (enforcement escalation).** A model output that reached the
  governed surface without verification. Must be zero on every run, with
  the denominator stated ("0 of 2,466").
- **Fail closed.** A stage that cannot prove something refuses rather than
  guesses.

## Measurement

- **Bank.** The reviewed set of test questions with expected outcomes
  (`data/playability/bank.v1.json`).
- **Oracle.** A bank question's expected answer or expected outcome.
- **Disposition.** What a bank question is expected to do: `answerable`,
  `advisory`, `needs-data`, `needs-claim-kind`, `gated-advisory`,
  `should-refuse`, `off-domain`.
- **Funnel stage.** Where a run actually landed: `resolved`, `denied`,
  `abstained-answer`, `abstained-scope`, `declined`. The scorer compares
  this to the disposition.
- **Leg.** One run of the bank on one model with one configuration, filed
  as an artifact in `runs/`.
- **Arm.** One configuration in a comparison. Arm A is usually the
  baseline. The **raw arm** is the same questions asked with no kernel.
- **Repetitions (N).** How many times each bank question is asked in a
  leg. N=3 is standard, because providers are nondeterministic.
- **Pass band.** The range of passes per repetition across a leg (for
  example, 111–114 of 137).
- **Stable core / stable fails / flaky.** Questions that pass on every
  repetition, fail on every repetition, or mix.
- **Churn.** Run-to-run variation from provider nondeterminism alone. A
  change inside the churn band is not a result.
- **Governance tax.** The governed resolution rate beside the same model's
  raw (ungoverned) rate on the same questions. The usefulness north star's
  number.
- **Correct-decline rate.** How often the system correctly declines a
  question it should not answer.
- **Lever.** A change to a usefulness layer (grammar, retrieval, prompt,
  data, dialogue), put behind a flag and measured on and off.
- **The tuning rule.** A lever that helps one model and hurts the other is
  withdrawn. It is model-specific tuning, not a structural improvement.
- **Gate (pre-registered).** The measurement, written down before the
  lever is built, that decides whether the lever is kept.
- **Porch (porch reading).** A small, cheap live check: a handful of
  conversations through `session:trace` on both models, for pennies,
  before paying for a bank leg. From "front-porch questions" — the first
  things a newcomer asks.
- **Strong model / weak model.** Every live run uses at least one capable
  model and one deliberately cheap one. Currently
  `qwen/qwen3-235b-a22b-2507` and `mistralai/mistral-nemo`.
- **Ceremony.** The trainer's cost per resolved answer: clarifying
  questions, scope cards, act consents.

## The operator's layers

- **Retrieval.** Choosing which certified rows reach the model for a given
  ask.
- **Precedent / precedent door.** The operator's store of earlier accepted
  answers, values stripped, shown to the model as examples of which route
  to take. [precedent.md](precedent.md)
- **Decline ledger.** Every sample that was answered when it should have
  been declined, with what was certified instead and the layer that owes
  the fix. `npm run decline-ledger`. [decline-ledger.md](decline-ledger.md)
- **Demand ledger.** What was asked and not answered — the honest
  abstentions, which are the content a data steward should add. Epic #170
  K1. Not built.

## The plan

- **North stars.** Two, never traded: compliance (escalations are zero,
  no error budget) and usefulness (the governance tax driven to a
  product-grade floor). [generalization.md](generalization.md) §11
- **Epic / slice.** A GitHub issue with checkbox slices. A slice is ticked
  only when its gate is met. Current epics: #145, #169, #118, #170.
- **Findings.** [findings.md](findings.md). Every claim the project can
  defend, with its numbers and the run they came from.
