/**
 * Trainer-facing ceremony, read from the record (epic #94, slice 5; absorbs
 * epic #87 slice 6).
 *
 * The consent gradient prices ambiguity in "model calls and clicks", but the
 * ceremony number the maps reported was only calls-per-turn — the model's
 * cost, not the trainer's. What a trainer actually endures is in every
 * transcript, unsurfaced: the clarifying questions they were asked, the scope
 * cards they had to rule on, the act cards they had to consent to. This
 * module reads those from the record — never from a counter kept while
 * running, so a filed artifact from before this existed yields the same
 * numbers as a live run (the free-probe property the epic's slices lean on).
 *
 * What counts, and why:
 *
 *  - **questions** — recorded clarifying questions on the advisor's channel.
 *    A question on any other channel armed nothing (IA-8) and cost the
 *    trainer nothing to answer honestly, but it was still not the advisor
 *    asking; only the advisor's are the product's own friction.
 *  - **clarifications** — the advisor's *own* questions (docs/routing.md,
 *    R3b step 3): a `clarification` event on the advisor's channel, the
 *    model's nominated question with typed options. Counted apart from the
 *    pack's questions because they price different things — the pack's ask
 *    for scope, the model's for meaning — and R4's ceremony audit needs both
 *    numbers, not their sum.
 *  - **scopeCards** — confirmation events on the trainer's channel, whatever
 *    the decision. A rejected card was still a card endured; counting only
 *    the confirmed ones would price rigor at zero whenever the model guessed
 *    wrong.
 *  - **actCards** — the consent the act path required: one when the record
 *    carries the trainer's confirmation of the attested page. A declined act
 *    files no confirmation and is not counted here; the decline shows in the
 *    funnel, and inventing a card for it would be a counter, not a record.
 */

import type { ScopeEvent, ScopeTranscript } from "../kernel/contracts.js";
import type { Transaction } from "../kernel/transaction.js";
import type { HarnessRun } from "./run.js";

export interface Ceremony {
  /** The pack's clarifying questions put to the trainer, on the advisor's channel. */
  questions: number;
  /** The model's own clarifying questions, with typed options, on the
   * advisor's channel (R3b step 3). */
  clarifications: number;
  /** Scope confirmation cards the trainer ruled on — confirmed or rejected. */
  scopeCards: number;
  /** Act consent cards the trainer confirmed, read from the transaction. */
  actCards: number;
}

/** The ceremony inside one span of recorded events, plus the record's consent. */
export function ceremonyOfEvents(events: ScopeTranscript, transaction?: Transaction): Ceremony {
  const isAdvisorQuestion = (event: ScopeEvent): boolean => event.kind === "question" && event.source === "advisor";
  const isAdvisorClarification = (event: ScopeEvent): boolean => event.kind === "clarification" && event.source === "advisor";
  const isTrainerRuling = (event: ScopeEvent): boolean => event.kind === "confirmation" && event.source === "trainer";
  return {
    questions: events.filter(isAdvisorQuestion).length,
    clarifications: events.filter(isAdvisorClarification).length,
    scopeCards: events.filter(isTrainerRuling).length,
    actCards: transaction?.confirmation === undefined ? 0 : 1,
  };
}

/** One run's whole ceremony — the single-turn reading. */
export function ceremonyOf(run: HarnessRun): Ceremony {
  return ceremonyOfEvents(run.transcript, run.transaction);
}

export function addCeremony(a: Ceremony, b: Ceremony): Ceremony {
  return {
    questions: a.questions + b.questions,
    // Artifacts filed before the model could ask carry no field here; they
    // read as zero, which is what they were.
    clarifications: (a.clarifications ?? 0) + (b.clarifications ?? 0),
    scopeCards: a.scopeCards + b.scopeCards,
    actCards: a.actCards + b.actCards,
  };
}

export const NO_CEREMONY: Ceremony = { questions: 0, clarifications: 0, scopeCards: 0, actCards: 0 };
