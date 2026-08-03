/**
 * The transaction seam: one record of one governed exchange, from what the
 * trainer said to what the kernel let the Advisor commit.
 *
 * Every phase so far has proved its own article against its own fixtures and
 * stopped at its own edge. Nothing had ever run scope resolution and answer
 * compilation as one thing, which meant two questions had no answer anywhere:
 * whether the phases agree about what they hand each other, and what a denial
 * looks like to somebody who is not an `expect`.
 *
 * This is a **record, not an engine**. It calls the phases' own entry points
 * in order and writes down what each said; it holds no rule of its own, and
 * there is no verdict here that the kernel would not have reached without it.
 * In particular the stage verdicts sit side by side and are never fused into
 * one. Composing scope, render, confirmation and action into a single proof
 * identity is phase 5's work, and doing half of it here would leave phase 5
 * nothing to prove.
 *
 * Fail-closed is preserved exactly as each stage states it. A clarification is
 * a clarification and a denial is a denial: an unestablished scope produces a
 * question, not a violation, and nothing here smooths one into the other.
 */

import type {
  AnswerManifest,
  ScopeDimension,
  ScopeGrant,
  ScopeTranscript,
  Verdict,
  Violation,
} from "./contracts.js";
import { compileManifest, type ManifestContext, type ManifestDraft } from "./manifest.js";
import type { AccordPack } from "./pack.js";
import type { CertifiedRegistry } from "./registry.js";
import { resolveScope, type ScopeContext, type ScopeDerivation } from "./scope.js";
import { verdictOf } from "./violation.js";

/**
 * The propose step, as a type.
 *
 * A plan is whatever wants to claim something once scope exists — a scripted
 * demo answer today, a model in phase 7. It is handed the established context
 * because rosters are built from the registry, and it is trusted with nothing:
 * whatever it returns goes to {@link compileManifest}, which submits it to the
 * same verification a hostile manifest would face.
 */
export type AnswerPlan = (context: ManifestContext, transactionId: string) => ManifestDraft;

export interface TransactionInput {
  id: string;
  registry: CertifiedRegistry;
  pack: AccordPack;
  transcript: ScopeTranscript;
  /** RFC 3339, both supplied rather than read: a verdict is a pure function
   * of recorded inputs, and a clock is not one of them (IA-10). */
  establishedAt: string;
  committedAt: string;
  /** Dimensions this exchange needs. A ranking answer also needs a basis. */
  required?: readonly ScopeDimension[];
  plan: AnswerPlan;
}

/** One stage's ruling, kept under the stage that reached it. */
export interface StageVerdict {
  stage: "scope" | "answer";
  verdict: Verdict;
}

/**
 * How the exchange ended. Three states, and the middle one is why this is a
 * union rather than a verdict: not knowing the trainer's scope is a question
 * to ask, and reporting it as a refusal would be the fail-closed theatre the
 * controls exist to catch.
 */
export type TransactionOutcome =
  | { status: "answered" }
  | {
      status: "clarifying";
      asking: ScopeDimension;
      question: string;
      missing: readonly ScopeDimension[];
    }
  | { status: "denied"; stage: "scope" | "answer"; violations: readonly Violation[] };

export interface Transaction {
  id: string;
  snapshotId: string;
  packId: string;
  establishedAt: string;
  committedAt: string;
  /** The whole record the verdicts rest on, carried rather than referenced. */
  transcript: ScopeTranscript;
  /** What the record establishes, what it contradicts, and what it says that
   * binds nothing — including wording the vocabulary never covered. */
  derivation: ScopeDerivation;
  /** In stage order, one per stage that reached a ruling. Never fused. */
  verdicts: readonly StageVerdict[];
  grant?: ScopeGrant;
  manifest?: AnswerManifest;
  outcome: TransactionOutcome;
}

/**
 * Establish scope, plan an answer under it, and submit that answer for
 * certification — stopping at the first stage that cannot proceed.
 *
 * Stopping is not an optimisation. An answer compiled against scope that was
 * never established would be an answer to a question nobody asked, and its
 * verdict would be noise in the record rather than a second opinion.
 */
export function runTransaction(input: TransactionInput): Transaction {
  const scopeContext: ScopeContext = {
    pack: input.pack,
    at: input.establishedAt,
    ...(input.required === undefined ? {} : { required: input.required }),
  };
  const scope = resolveScope(scopeContext, input.transcript);

  const record = {
    id: input.id,
    snapshotId: input.registry.snapshot.id,
    packId: input.pack.id,
    establishedAt: input.establishedAt,
    committedAt: input.committedAt,
    transcript: input.transcript,
    derivation: scope.derivation,
  };

  if (scope.status === "clarify") {
    return {
      ...record,
      verdicts: [],
      outcome: {
        status: "clarifying",
        asking: scope.asking,
        question: scope.question,
        missing: scope.missing,
      },
    };
  }

  if (scope.status === "refused") {
    return {
      ...record,
      verdicts: [{ stage: "scope", verdict: verdictOf(scope.violations) }],
      outcome: { status: "denied", stage: "scope", violations: scope.violations },
    };
  }

  const scopeVerdict: StageVerdict = { stage: "scope", verdict: verdictOf([]) };
  const context: ManifestContext = {
    registry: input.registry,
    pack: input.pack,
    grant: scope.grant,
    at: input.committedAt,
  };

  // `compileManifest` submits its own output to `verifyManifest` before
  // returning it, so this resolution *is* the verification result. Re-running
  // the verifier here would check the same function's answer twice and prove
  // nothing the first call did not.
  const compiled = compileManifest(context, input.plan(context, input.id));
  if (!compiled.ok) {
    return {
      ...record,
      grant: scope.grant,
      verdicts: [scopeVerdict, { stage: "answer", verdict: verdictOf(compiled.violations) }],
      outcome: { status: "denied", stage: "answer", violations: compiled.violations },
    };
  }

  return {
    ...record,
    grant: scope.grant,
    manifest: compiled.value,
    verdicts: [scopeVerdict, { stage: "answer", verdict: verdictOf([]) }],
    outcome: { status: "answered" },
  };
}
