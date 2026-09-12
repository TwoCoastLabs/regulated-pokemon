/**
 * One governed exchange, driven turn by turn against a model.
 *
 * The loop is small and deterministic: resolve scope, and while it is
 * incomplete ask the model to interpret the trainer's long-tail wording, let
 * the truthful trainer answer, and resolve again. Once scope is established,
 * ask the model for the answer and submit it through `runTransaction` — the
 * same seam the demo uses, so nothing about enforcement is re-implemented here.
 *
 * A `HarnessRun` is a record, not a verdict. It carries the whole transcript,
 * the transaction if one was reached, and — win or lose — the claims the model
 * *proposed*, so the metrics can tell a fabrication that was blocked from one
 * that was never attempted (the difference between real safety and vacuous
 * safety). Built only from recorded inputs and fixed timestamps, so a run is
 * itself replayable.
 */

import type { Claim, ScopeTranscript, TrainerScope } from "../kernel/contracts.js";
import type { ManifestContext } from "../kernel/manifest.js";
import type { AccordPack } from "../kernel/pack.js";
import type { CertifiedRegistry } from "../kernel/registry.js";
import { resolveScope, type ScopeContext } from "../kernel/scope.js";
import { runTransaction, type Transaction, type TransactionOutcome } from "../kernel/transaction.js";
import { renderAnswer } from "../render/reference.js";
import { proposeAnswer, proposeScope } from "./advisor.js";
import type { ExchangeLedger } from "../session/ledger.js";
import { addUsage, emptyUsage, type ModelProvider, type Usage } from "./provider.js";
import { respondToArtifact, respondToProposal } from "./trainer.js";
import {
  AUTHORIZED_AT,
  COMMITTED_AT,
  CONFIRMED_AT,
  ESTABLISHED_AT,
  EXECUTED_AT,
  LOCALE,
  RENDERED_AT,
  type Scenario,
} from "./corpus.js";

export interface HarnessWorld {
  registry: CertifiedRegistry;
  pack: AccordPack;
}

/**
 * How a run ended, in the four shapes the metrics care about.
 *  - `answered`   the model reached a certified answer that survived the kernel.
 *  - `acted`      the certified answer proposed an act, the trainer confirmed
 *                 the exact page, and the kernel authorised the whole chain.
 *  - `denied`     the model proposed something the kernel refused — the gate held.
 *  - `unresolved` scope never closed, the model produced nothing usable, or the
 *                 trainer declined the act it proposed — a fail-closed
 *                 abstention, never a partial release.
 */
export type RunStatus = "answered" | "acted" | "denied" | "unresolved";

export interface HarnessRun {
  scenarioId: string;
  providerId: string;
  /** Which sample this is, when a model is run over the corpus more than once. */
  repetition: number;
  status: RunStatus;
  /** One human line on why it ended this way. */
  detail: string;
  transcript: ScopeTranscript;
  /** Model calls made (scope proposals + the answer). */
  turns: number;
  /** Infrastructure failures, counted apart from the model declining to answer. */
  providerErrors: number;
  usage: Usage;
  transaction?: Transaction;
  grantScope?: TrainerScope;
  /** What the model tried to assert, kept even when the answer was denied. */
  proposedClaims?: readonly Claim[];
  /**
   * The driver's ledger for the exchanges this run drove (session/ledger.ts,
   * issue #158): every deterministic step in fixed wording, per exchange,
   * beside the kernel's record. Present for runs driven through the session
   * spine; the scenario corpus's harness runs carry none.
   */
  exchanges?: readonly ExchangeLedger[];
}

/** How many times the model may take a fresh run at establishing scope before
 * the exchange is abandoned as unresolved. Small on purpose: a real trainer's
 * patience is finite, and an unbounded loop is not a usefulness measurement. */
export const MAX_SCOPE_TURNS = 3;

/**
 * Which pass over the corpus this run belongs to.
 *
 * A live provider is nondeterministic even at temperature 0, so the same model
 * on the same scenario is sampled more than once and each sample is its own
 * run. The index is part of the transaction id, so two samples are two records
 * rather than one overwriting the other.
 */
export async function runScenario(
  world: HarnessWorld,
  scenario: Scenario,
  provider: ModelProvider,
  repetition = 0,
  grounded = false,
): Promise<HarnessRun> {
  const { registry, pack } = world;
  const scopeContext: ScopeContext = { pack, at: ESTABLISHED_AT, required: scenario.required };
  const suffix = repetition === 0 ? "" : `-r${repetition}`;
  const transactionId = `harness-${scenario.id}-${provider.id}${suffix}`;

  let transcript: ScopeTranscript = scenario.opening;
  let turns = 0;
  let providerErrors = 0;
  let usage: Usage = emptyUsage();

  const base = { scenarioId: scenario.id, providerId: provider.id, repetition };
  const abstain = (detail: string, grantScope?: TrainerScope): HarnessRun => ({
    ...base,
    status: "unresolved",
    detail,
    transcript,
    turns,
    providerErrors,
    usage,
    ...(grantScope === undefined ? {} : { grantScope }),
  });

  // --- establish scope ------------------------------------------------------
  for (let turn = 0; turn < MAX_SCOPE_TURNS; turn++) {
    const outcome = resolveScope(scopeContext, transcript);
    if (outcome.status !== "clarify") break;

    turns++;
    let step;
    try {
      step = await proposeScope({
        provider,
        pack,
        scenarioId: scenario.id,
        transcript,
        missing: outcome.missing,
        unmatched: outcome.derivation.unmatched,
        turn,
        at: ESTABLISHED_AT,
      });
    } catch {
      providerErrors++;
      return abstain("the provider failed during scope resolution");
    }
    usage = addUsage(usage, step.usage);
    if (step.event === null) return abstain("the model proposed nothing usable for scope");

    const confirmation = respondToProposal(step.event, scenario.groundTruth, ESTABLISHED_AT);
    transcript = [...transcript, step.event, confirmation];
  }

  const scope = resolveScope(scopeContext, transcript);
  if (scope.status !== "granted") return abstain("scope stayed incomplete after the turn budget");

  // --- compile an answer under it -------------------------------------------
  const context: ManifestContext = { registry, pack, grant: scope.grant, locale: LOCALE, at: COMMITTED_AT };
  const grantScope = scope.grant.scope;

  turns++;
  let answer;
  try {
    answer = await proposeAnswer({ provider, context, scenarioId: scenario.id, transactionId, transcript, grounded });
  } catch {
    providerErrors++;
    return abstain("the provider failed producing the answer", grantScope);
  }
  usage = addUsage(usage, answer.usage);
  if (!answer.decode.ok) return abstain(`no usable answer: ${answer.decode.reason}`, grantScope);

  const draft = answer.decode.draft;
  const transaction = runTransaction({
    id: transactionId,
    registry,
    pack,
    transcript,
    establishedAt: ESTABLISHED_AT,
    committedAt: COMMITTED_AT,
    locale: LOCALE,
    required: scenario.required,
    plan: () => draft,
    // The act path, wired for every scenario: whether an act is proposed is the
    // model's doing, and whether one is consented to is the trainer's. The
    // renderer is the reference one, honest; sabotaged pages are the crucible's
    // business, not the harness's.
    act: {
      render: renderAnswer,
      confirm: (artifact) => respondToArtifact(artifact, scenario.ask, CONFIRMED_AT),
      renderedAt: RENDERED_AT,
      authorizedAt: AUTHORIZED_AT,
      executedAt: EXECUTED_AT,
    },
  });

  // Scope is already granted on this exact transcript, so the transaction can
  // only end at the answer stage or beyond here — never a fresh clarification.
  const ended = (outcome: TransactionOutcome): { status: RunStatus; detail: string } => {
    switch (outcome.status) {
      case "answered":
        return { status: "answered", detail: "certified answer committed" };
      case "acted":
        return { status: "acted", detail: "confirmed act authorised against the page the trainer saw" };
      case "declined":
        // Fail-closed abstention: the answer stood, but the act the model
        // proposed was not the act the trainer consented to, so nothing ran.
        return { status: "unresolved", detail: "the trainer declined the proposed act" };
      case "denied":
        return { status: "denied", detail: `refused: ${outcome.stage} stage` };
      default:
        return { status: "unresolved", detail: `unexpected outcome: ${outcome.status}` };
    }
  };
  const { status, detail } = ended(transaction.outcome);

  return {
    ...base,
    status,
    detail,
    transcript,
    turns,
    providerErrors,
    usage,
    transaction,
    grantScope,
    proposedClaims: draft.claims,
  };
}
