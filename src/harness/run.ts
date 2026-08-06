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
import { runTransaction, type Transaction } from "../kernel/transaction.js";
import { proposeAnswer, proposeScope } from "./advisor.js";
import { addUsage, emptyUsage, type ModelProvider, type Usage } from "./provider.js";
import { respondToProposal } from "./trainer.js";
import { COMMITTED_AT, ESTABLISHED_AT, LOCALE, type Scenario } from "./corpus.js";

export interface HarnessWorld {
  registry: CertifiedRegistry;
  pack: AccordPack;
}

/**
 * How a run ended, in the three shapes the metrics care about.
 *  - `answered`   the model reached a certified answer that survived the kernel.
 *  - `denied`     the model proposed something the kernel refused — the gate held.
 *  - `unresolved` scope never closed, or the model produced nothing usable — a
 *                 fail-closed abstention, never a partial release.
 */
export type RunStatus = "answered" | "denied" | "unresolved";

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
    answer = await proposeAnswer(provider, context, scenario.id, transactionId);
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
  });

  // Scope is already granted on this exact transcript, so the transaction can
  // only be answered or denied here — never a fresh clarification.
  const status: RunStatus = transaction.outcome.status === "answered" ? "answered" : "denied";
  const detail =
    status === "answered"
      ? "certified answer committed"
      : `refused: ${transaction.outcome.status === "denied" ? transaction.outcome.stage : "unexpected"} stage`;

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
