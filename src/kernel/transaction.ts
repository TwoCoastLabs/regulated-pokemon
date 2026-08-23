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
 * one. Where the answer proposes an act, the seam continues through the chain
 * phase 5 proved — render, attest, the trainer's confirmation, authorization —
 * calling that phase's entry points exactly as a transport would; the one
 * proof identity is still `verifyAction`'s, reached through `authorizeAction`,
 * never re-derived here.
 *
 * Fail-closed is preserved exactly as each stage states it. A clarification is
 * a clarification and a denial is a denial: an unestablished scope produces a
 * question, not a violation, and nothing here smooths one into the other.
 */

import { authorizeAction } from "./action.js";
import type {
  ActionGrant,
  AnswerManifest,
  Claim,
  ConfirmationEvent,
  RenderAffidavit,
  ScopeDimension,
  ScopeGrant,
  ScopeTranscript,
  Verdict,
  Violation,
} from "./contracts.js";
import type { DomElement } from "./dom.js";
import { compileManifest, type ManifestContext, type ManifestDraft } from "./manifest.js";
import type { AccordPack } from "./pack.js";
import { attestRender, planRender, type RenderPlan } from "./render.js";
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

/**
 * The transport half of the act path, injected exactly as the plan is.
 *
 * Neither function is trusted. The renderer is Article VI's untrusted half —
 * whatever page it returns is walked and attested from the DOM, never taken at
 * its word. The confirmation is the trainer's and only the trainer's: the seam
 * asks, records what came back, and lets `authorizeAction` judge it; a `null`
 * is the trainer declining, which ends the act and nothing else — the certified
 * answer stands, and nothing executes.
 *
 * The three moments are supplied, never clocked (IA-10), and they are the act
 * path's own: rendered, then authorised, then executed, each checked against
 * the confirmation's own timestamp by phase 5's ordering rules.
 */
export interface ActTransport {
  render: (pack: AccordPack, plan: RenderPlan) => DomElement;
  confirm: (artifact: DomElement, affidavit: RenderAffidavit) => ConfirmationEvent | null;
  renderedAt: string;
  authorizedAt: string;
  executedAt: string;
}

export interface TransactionInput {
  id: string;
  registry: CertifiedRegistry;
  pack: AccordPack;
  transcript: ScopeTranscript;
  /** RFC 3339, both supplied rather than read: a verdict is a pure function
   * of recorded inputs, and a clock is not one of them (IA-10). */
  establishedAt: string;
  committedAt: string;
  /**
   * The locale this exchange is presented in, assigned by the transport in the
   * same breath as the channel each utterance arrived on. Not something the
   * conversation, or the thing planning the answer, gets to move.
   */
  locale: string;
  /** Dimensions this exchange needs. A ranking answer also needs a basis. */
  required?: readonly ScopeDimension[];
  plan: AnswerPlan;
  /**
   * How the answer becomes a page and the page becomes consent, when the plan
   * proposes an act. Absent, an answer whose claims include an act is still
   * compiled, verified and committed — but the act itself never renders and
   * never executes, exactly as a transport that stops at "answered" behaves.
   */
  act?: ActTransport;
}

/** The stages a transaction can reach, in the order it reaches them. */
export type TransactionStage = "scope" | "answer" | "render" | "action";

/** One stage's ruling, kept under the stage that reached it. */
export interface StageVerdict {
  stage: TransactionStage;
  verdict: Verdict;
}

/**
 * How the exchange ended. The non-terminal states are why this is a union
 * rather than a verdict: not knowing the trainer's scope is a question to ask,
 * and a trainer declining an act is a choice honoured — reporting either as a
 * refusal would be the fail-closed theatre the controls exist to catch.
 *
 * `acted` is `answered` plus the whole phase-5 chain: the page attested, the
 * trainer's confirmation of that exact page, and a grant per act, each minted
 * by `authorizeAction` and so already submitted to `verifyAction`. `declined`
 * commits the answer and executes nothing.
 */
export type TransactionOutcome =
  | { status: "answered" }
  | { status: "acted" }
  | { status: "declined" }
  | {
      status: "clarifying";
      asking: ScopeDimension;
      question: string;
      missing: readonly ScopeDimension[];
    }
  | { status: "denied"; stage: TransactionStage; violations: readonly Violation[] };

export interface Transaction {
  id: string;
  snapshotId: string;
  packId: string;
  /** The locale the answer was certified for presentation in. */
  locale: string;
  establishedAt: string;
  committedAt: string;
  /** The whole record the verdicts rest on, carried rather than referenced. */
  transcript: ScopeTranscript;
  /**
   * The dimensions this exchange required, recorded exactly as they were
   * supplied — absent when the caller took the default. Kept because scope
   * resolution reads it: whether the same transcript answers or asks depends on
   * what was required, so a replay that could not see it could not reproduce
   * the outcome (IA-10).
   */
  required?: readonly ScopeDimension[];
  /** What the record establishes, what it contradicts, and what it says that
   * binds nothing — including wording the vocabulary never covered. */
  derivation: ScopeDerivation;
  /** In stage order, one per stage that reached a ruling. Never fused. */
  verdicts: readonly StageVerdict[];
  grant?: ScopeGrant;
  manifest?: AnswerManifest;
  /**
   * The draft the answer stage refused, recorded exactly as submitted — when
   * compilation itself refuses, no manifest ever exists, and without the
   * draft the denial verdict cannot be re-derived from the record (IA-10;
   * epic #87 slice 2b — the first replay sweep found 176 such records).
   * Kept apart from `manifest` on purpose: a refused draft is hostile input
   * a replay re-compiles, never a certificate anything downstream may read
   * values from.
   */
  refused?: ManifestDraft;
  /**
   * The act path's record, present exactly when the exchange entered it. The
   * artifact and the confirmation are the two inputs a replay cannot re-derive
   * — the renderer is untrusted and the trainer is a person — so both travel
   * with the record; the affidavit and the grants are re-derived and compared.
   */
  artifact?: DomElement;
  affidavit?: RenderAffidavit;
  confirmation?: ConfirmationEvent;
  actionGrants?: readonly ActionGrant[];
  /** The act path's moments, recorded whenever it was entered — including when
   * it refused — so a replay knows to walk the same path (IA-10). */
  renderedAt?: string;
  authorizedAt?: string;
  executedAt?: string;
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
    locale: input.locale,
    establishedAt: input.establishedAt,
    committedAt: input.committedAt,
    transcript: input.transcript,
    ...(input.required === undefined ? {} : { required: input.required }),
    derivation: scope.derivation,
  };

  if (scope.status === "clarify") {
    // The lazy half of IA-1 before the question: material scope is demanded
    // when an answer depends on it, and a catalogue lesson depends on none of
    // it. The plan is put to the compiler with no grant at all — under which
    // every claim kind except `explanation` refuses by name
    // (IA-1/scope-not-established) — so the only thing that can commit here
    // is reviewed, impersonal teaching. Anything else falls to the question
    // exactly as before; nothing is smoothed, and the filed record shows no
    // grant because nothing personalized was released.
    const bare: ManifestContext = {
      registry: input.registry,
      pack: input.pack,
      locale: input.locale,
      at: input.committedAt,
    };
    const taught = compileManifest(bare, input.plan(bare, input.id));
    if (taught.ok) {
      return {
        ...record,
        manifest: taught.value,
        verdicts: [{ stage: "answer", verdict: verdictOf([]) }],
        outcome: { status: "answered" },
      };
    }
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
    locale: input.locale,
    at: input.committedAt,
  };

  // `compileManifest` submits its own output to `verifyManifest` before
  // returning it, so this resolution *is* the verification result. Re-running
  // the verifier here would check the same function's answer twice and prove
  // nothing the first call did not.
  const draft = input.plan(context, input.id);
  const compiled = compileManifest(context, draft);
  if (!compiled.ok) {
    return {
      ...record,
      grant: scope.grant,
      refused: draft,
      verdicts: [scopeVerdict, { stage: "answer", verdict: verdictOf(compiled.violations) }],
      outcome: { status: "denied", stage: "answer", violations: compiled.violations },
    };
  }

  const committed: Omit<Transaction, "outcome"> = {
    ...record,
    grant: scope.grant,
    manifest: compiled.value,
    verdicts: [scopeVerdict, { stage: "answer", verdict: verdictOf([]) }],
  };

  const acts = actionClaims(compiled.value);
  if (input.act === undefined || acts.length === 0) {
    return { ...committed, outcome: { status: "answered" } };
  }
  return runActPath(input.act, context, compiled.value, committed, acts);
}

/** The acts a certified answer proposes — the claims the chain is owed for. */
export function actionClaims(manifest: AnswerManifest): readonly Extract<Claim, { kind: "action" }>[] {
  return manifest.claims.filter((claim): claim is Extract<Claim, { kind: "action" }> => claim.kind === "action");
}

/**
 * The certified answer proposed an act, so the seam keeps going: plan the page,
 * let the untrusted renderer draw it, attest what it actually shows, put it to
 * the trainer, and — only on their confirmation — submit the whole chain to
 * `authorizeAction`, once per act. Every step is a phase-5 entry point; the
 * seam contributes order and record-keeping, no judgement of its own.
 */
function runActPath(
  act: ActTransport,
  context: ManifestContext,
  manifest: AnswerManifest,
  committed: Omit<Transaction, "outcome">,
  acts: readonly Extract<Claim, { kind: "action" }>[],
): Transaction {
  const base: Omit<Transaction, "outcome"> = {
    ...committed,
    renderedAt: act.renderedAt,
    authorizedAt: act.authorizedAt,
    executedAt: act.executedAt,
  };

  const planned = planRender(context, manifest);
  if (!planned.ok) {
    return {
      ...base,
      verdicts: [...committed.verdicts, { stage: "render", verdict: verdictOf(planned.violations) }],
      outcome: { status: "denied", stage: "render", violations: planned.violations },
    };
  }

  const artifact = act.render(context.pack, planned.value);
  const attested = attestRender(context, manifest, artifact, act.renderedAt);
  if (!attested.ok) {
    return {
      ...base,
      artifact,
      verdicts: [...committed.verdicts, { stage: "render", verdict: verdictOf(attested.violations) }],
      outcome: { status: "denied", stage: "render", violations: attested.violations },
    };
  }

  const confirmation = act.confirm(artifact, attested.value);
  if (confirmation === null) {
    // Not a denial and not dressed up as one: the trainer looked at the page
    // and said no. The certified answer stands; the act does not happen.
    return {
      ...base,
      artifact,
      affidavit: attested.value,
      outcome: { status: "declined" },
    };
  }

  const grants: ActionGrant[] = [];
  const violations: Violation[] = [];
  for (const claim of acts) {
    const authorized = authorizeAction(context, {
      manifest,
      artifact,
      affidavit: attested.value,
      confirmation,
      tool: claim.tool,
      entityId: claim.entityId,
      authorizedAt: act.authorizedAt,
      executedAt: act.executedAt,
    });
    if (authorized.ok) grants.push(authorized.value);
    else violations.push(...authorized.violations);
  }

  if (violations.length > 0) {
    return {
      ...base,
      artifact,
      affidavit: attested.value,
      confirmation,
      verdicts: [...committed.verdicts, { stage: "action", verdict: verdictOf(violations) }],
      outcome: { status: "denied", stage: "action", violations },
    };
  }

  return {
    ...base,
    artifact,
    affidavit: attested.value,
    confirmation,
    actionGrants: grants,
    verdicts: [...committed.verdicts, { stage: "action", verdict: verdictOf([]) }],
    outcome: { status: "acted" },
  };
}
