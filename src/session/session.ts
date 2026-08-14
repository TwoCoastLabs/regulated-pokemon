/**
 * The live session: a real visitor as the trainer, a real model as the
 * Advisor, the same kernel as the gate.
 *
 * This is the harness loop (`runScenario`) with the scripted oracle removed.
 * Every trainer response — an answer to a clarifying question, the click that
 * confirms an interpretation, the consent to an act — comes from the person in
 * the tab, arrives as a recorded event on the trainer's channel, and binds
 * exactly as far as the kernel's ladder lets it. The model is trusted with
 * nothing here that it is not trusted with in the harness: it proposes, and
 * `runTransaction` — the same seam — decides what commits.
 *
 * Three disciplines this module owes the rest of the project:
 *
 *  - **Every settled exchange is a kernel record.** An answer, an act, a
 *    decline or a denial is filed as the `Transaction` the seam produced,
 *    with real recorded timestamps — so a live session's exchanges replay
 *    (IA-10) exactly as a harness run's do. Certified pages kept for display
 *    travel *beside* the record, never inside it.
 *  - **The pause is in the driver, not the kernel.** The seam's act path takes
 *    a synchronous `confirm`; a person is not synchronous. So the driver probes
 *    the seam once with a declining transport to surface the attested page,
 *    holds it for the visitor, and when they decide, runs the seam once more
 *    with their actual confirmation — the filed record is the kernel's own,
 *    reached through its own entry points, never assembled here.
 *  - **Failures are counted apart, never blended.** A provider outage is an
 *    infrastructure error; a model that produced nothing usable is an
 *    abstention; both are notes to the visitor and neither files a record —
 *    fail-closed is silence, not a fabricated verdict.
 *
 * The clock is injected and must be monotonic: the kernel orders the moments
 * it records (issued, rendered, confirmed, executed), and a wall clock that
 * repeats a millisecond would hand it a lie.
 */

import type { ConfirmationEvent, ScopeDimension, ScopeEvent, ScopeTranscript } from "../kernel/contracts.js";
import { type DomElement, walkArtifact } from "../kernel/dom.js";
import type { ManifestContext, ManifestDraft } from "../kernel/manifest.js";
import type { AccordPack } from "../kernel/pack.js";
import { planRender } from "../kernel/render.js";
import type { CertifiedRegistry } from "../kernel/registry.js";
import { REQUIRED_DIMENSIONS, resolveScope, type ScopeContext } from "../kernel/scope.js";
import { runTransaction, type Transaction } from "../kernel/transaction.js";
import { renderAnswer } from "../render/reference.js";
import { proposalDigest, proposeAnswer, proposeScope } from "../harness/advisor.js";
import { addUsage, emptyUsage, type ModelProvider, type Usage } from "../harness/provider.js";

/** The certified world the session runs against — the same two values the
 * harness calls `HarnessWorld`, named here so the browser bundle never
 * touches the harness modules that read from disk. */
export interface SessionWorld {
  registry: CertifiedRegistry;
  pack: AccordPack;
}

export interface SessionDeps {
  world: SessionWorld;
  provider: ModelProvider;
  /** RFC 3339, strictly increasing across calls. The transport owns time. */
  now: () => string;
  locale?: string;
}

export type ScopeProposal = Extract<ScopeEvent, { kind: "proposal" }>;

/**
 * What the session is waiting for.
 *
 *  - `gathering`        the visitor's words, to open or continue an exchange.
 *  - `asking`           an answer to the pack's own clarifying question — the
 *                       deterministic fallback when the model cannot help.
 *  - `confirming-scope` the visitor's verdict on the model's interpretation:
 *                       the propose/confirm ladder, with a person on the end.
 *  - `confirming-act`   consent to the acts on the attested page — the one
 *                       moment IA-7 exists for.
 */
export type SessionPhase =
  | { kind: "gathering" }
  | { kind: "asking"; dimension: ScopeDimension; question: string }
  | { kind: "confirming-scope"; proposal: ScopeProposal }
  | { kind: "confirming-act"; artifact: DomElement };

/** A line the driver owes the visitor that no record carries: abstentions and
 * infrastructure failures, counted apart from everything the kernel says. */
export interface SessionNote {
  at: string;
  text: string;
  tone: "abstention" | "error";
}

export interface SessionState {
  transcript: ScopeTranscript;
  /** Filed exchanges, in order. Each is the seam's own record and replays. */
  records: readonly Transaction[];
  /** Certified pages for display, by transaction id — beside the record. */
  pages: Readonly<Record<string, DomElement>>;
  notes: readonly SessionNote[];
  usage: Usage;
  providerErrors: number;
  phase: SessionPhase;
  /** Where the current exchange's words begin: the answer step is shown the
   * ask it is answering, not the whole session (scope still reads it all). */
  askStart: number;
  /** Ladder proposals spent on the current ask; a fresh utterance resets it. */
  ladderTurns: number;
  /**
   * Dimensions the current exchange must establish, when it needs more than
   * the default three. Set structurally, never lexically: a decoded draft
   * containing a ranking claim escalates `comparisonBasis` into the
   * requirement, so a basis is something the visitor confirmed, not something
   * the model chose in silence — and a miss falls closed, to a question.
   */
  required?: readonly ScopeDimension[];
  /** The exchange paused for consent, when there is one. */
  pending?: PendingAct;
}

/** Everything needed to finish an exchange the visitor is looking at. */
interface PendingAct {
  transactionId: string;
  establishedAt: string;
  committedAt: string;
  renderedAt: string;
  required?: readonly ScopeDimension[];
  draft: ManifestDraft;
  artifact: DomElement;
}

/** As in the harness: a real trainer's patience is finite, and an unbounded
 * ladder is not a conversation. After this many spent proposals the driver
 * falls back to the pack's own question and waits for words. */
export const MAX_LADDER_TURNS = 3;

const LOCALE = "en-US";

export function startSession(): SessionState {
  return {
    transcript: [],
    records: [],
    pages: {},
    notes: [],
    usage: emptyUsage(),
    providerErrors: 0,
    phase: { kind: "gathering" },
    askStart: 0,
    ladderTurns: 0,
  };
}

function note(state: SessionState, at: string, text: string, tone: SessionNote["tone"]): SessionState {
  return { ...state, notes: [...state.notes, { at, text, tone }] };
}

/** File a settled exchange and open the next one, with the default demands. */
function file(state: SessionState, record: Transaction, page?: DomElement): SessionState {
  const { pending: _pending, required: _required, ...rest } = state;
  return {
    ...rest,
    records: [...state.records, record],
    pages: page === undefined ? state.pages : { ...state.pages, [record.id]: page },
    phase: { kind: "gathering" },
    askStart: state.transcript.length,
    ladderTurns: 0,
  };
}

/** The visitor spoke. Their words join the record on the trainer's channel —
 * the transport (this driver) is what assigns it — and the exchange advances. */
export async function say(state: SessionState, text: string, deps: SessionDeps): Promise<SessionState> {
  const utterance: ScopeEvent = { kind: "utterance", at: deps.now(), source: "trainer", text };
  return drive({ ...state, transcript: [...state.transcript, utterance], ladderTurns: 0 }, deps);
}

/**
 * The visitor's verdict on the model's interpretation. Only this — a
 * confirmation naming the digest of the exact candidate they were shown —
 * can make a proposal bind; the driver appends it and lets the resolver rule.
 */
export async function decideScope(
  state: SessionState,
  decision: "confirm" | "reject",
  deps: SessionDeps,
): Promise<SessionState> {
  if (state.phase.kind !== "confirming-scope") return state;
  const proposal = state.phase.proposal;
  const confirmation: ScopeEvent = {
    kind: "confirmation",
    at: deps.now(),
    source: "trainer",
    proposalId: proposal.id,
    candidateDigest: proposalDigest(proposal),
    decision,
  };
  return drive({ ...state, transcript: [...state.transcript, confirmation] }, deps);
}

/**
 * Consent, or the withholding of it, on the exact page the visitor saw.
 *
 * The confirmation is built the way the truthful trainer builds one: from the
 * visitor's own walk of the artifact — its digest, the transaction it says it
 * is — never from the transport's paperwork. Then the seam runs once with that
 * answer in the transport, and whatever it rules is the filed record.
 */
export function decideAct(state: SessionState, decision: "confirm" | "decline", deps: SessionDeps): SessionState {
  if (state.phase.kind !== "confirming-act" || state.pending === undefined) return state;
  const pending = state.pending;

  let confirmation: ConfirmationEvent | null = null;
  if (decision === "confirm") {
    const seen = walkArtifact(pending.artifact);
    // A page that does not say which transaction it is cannot be consented to;
    // the kernel would refuse the grant anyway, so the driver declines it.
    if (seen.transactionId === undefined) confirmation = null;
    else
      confirmation = {
        id: `confirmation-${seen.transactionId}`,
        transactionId: seen.transactionId,
        source: "trainer",
        artifactDigest: seen.digest,
        confirmedAt: deps.now(),
      };
  }

  const moment = deps.now();
  const record = runTransaction({
    id: pending.transactionId,
    registry: deps.world.registry,
    pack: deps.world.pack,
    transcript: state.transcript,
    establishedAt: pending.establishedAt,
    committedAt: pending.committedAt,
    locale: deps.locale ?? LOCALE,
    ...(pending.required === undefined ? {} : { required: pending.required }),
    plan: () => pending.draft,
    act: {
      // The transport's job is delivery: the seam gets the exact page the
      // visitor was shown, not a fresh rendering of it.
      render: () => pending.artifact,
      confirm: () => confirmation,
      renderedAt: pending.renderedAt,
      authorizedAt: moment,
      executedAt: moment,
    },
  });
  return file(state, record, pending.artifact);
}

/** Re-run the current exchange after an abstention or a provider failure,
 * without making the visitor restate the ask. Only those pauses: an exchange
 * waiting on a person has nothing to retry. */
export async function retry(state: SessionState, deps: SessionDeps): Promise<SessionState> {
  if (state.phase.kind === "confirming-act") return state;
  return drive(state, deps);
}

/**
 * Advance the exchange as far as it can go without the visitor: resolve scope,
 * let the model propose an interpretation while its budget lasts, compile the
 * answer once scope is granted, and stop at whichever pause — a question, a
 * proposal, a page awaiting consent — needs a person next.
 */
async function drive(state: SessionState, deps: SessionDeps): Promise<SessionState> {
  const { world, provider } = deps;

  const scopeContext: ScopeContext = {
    pack: world.pack,
    at: deps.now(),
    ...(state.required === undefined ? {} : { required: state.required }),
  };
  const outcome = resolveScope(scopeContext, state.transcript);

  if (outcome.status === "refused") {
    // The record of the refusal is the seam's, reached through its own door.
    const at = deps.now();
    const record = runTransaction({
      id: nextTransactionId(state),
      registry: world.registry,
      pack: world.pack,
      transcript: state.transcript,
      establishedAt: at,
      committedAt: at,
      locale: deps.locale ?? LOCALE,
      ...(state.required === undefined ? {} : { required: state.required }),
      plan: () => {
        throw new Error("unreachable: a refused scope never plans an answer");
      },
    });
    return file(state, record);
  }

  if (outcome.status === "granted") {
    return answer(state, deps);
  }

  // Clarify. The model gets a bounded number of tries at interpreting the
  // long tail; past the budget, the pack's own question does the asking.
  if (state.ladderTurns >= MAX_LADDER_TURNS) {
    return {
      ...state,
      phase: { kind: "asking", dimension: outcome.asking, question: outcome.question },
    };
  }

  let step;
  try {
    step = await proposeScope({
      provider,
      pack: world.pack,
      scenarioId: "session",
      transcript: state.transcript,
      missing: outcome.missing,
      unmatched: outcome.derivation.unmatched,
      turn: state.transcript.length,
      at: deps.now(),
    });
  } catch (cause) {
    const failed = note(
      { ...state, providerErrors: state.providerErrors + 1 },
      deps.now(),
      `the provider failed during scope resolution (${cause instanceof Error ? cause.message : String(cause)})`,
      "error",
    );
    return { ...failed, phase: { kind: "asking", dimension: outcome.asking, question: outcome.question } };
  }

  const spent = { ...state, usage: addUsage(state.usage, step.usage), ladderTurns: state.ladderTurns + 1 };
  if (step.event === null) {
    // Nothing usable to propose: fall to the deterministic question rather
    // than burning the remaining budget on the same words.
    return {
      ...spent,
      phase: { kind: "asking", dimension: outcome.asking, question: outcome.question },
    };
  }

  return {
    ...spent,
    transcript: [...spent.transcript, step.event],
    phase: { kind: "confirming-scope", proposal: step.event },
  };
}

function nextTransactionId(state: SessionState): string {
  return `session-${state.records.length + 1}`;
}

/** Scope is granted: ask the model for the answer and put it to the seam. */
async function answer(state: SessionState, deps: SessionDeps): Promise<SessionState> {
  const { world, provider } = deps;
  const transactionId = nextTransactionId(state);
  const establishedAt = deps.now();

  // Re-resolve at the established moment so the grant the answer compiles
  // under is the one the record will carry.
  const resolved = resolveScope(
    {
      pack: world.pack,
      at: establishedAt,
      ...(state.required === undefined ? {} : { required: state.required }),
    },
    state.transcript,
  );
  if (resolved.status !== "granted") return state; // just ruled granted; unreachable

  const context: ManifestContext = {
    registry: world.registry,
    pack: world.pack,
    grant: resolved.grant,
    locale: deps.locale ?? LOCALE,
    at: establishedAt,
  };

  let step;
  try {
    step = await proposeAnswer({
      provider,
      context,
      scenarioId: "session",
      transactionId,
      // The ask being answered, not the whole session: scope reads the full
      // transcript, but the answer should be responsive to the current words.
      transcript: state.transcript.slice(state.askStart),
    });
  } catch (cause) {
    return note(
      { ...state, providerErrors: state.providerErrors + 1, phase: { kind: "gathering" } },
      deps.now(),
      `the provider failed producing the answer (${cause instanceof Error ? cause.message : String(cause)})`,
      "error",
    );
  }

  const withUsage = { ...state, usage: addUsage(state.usage, step.usage) };
  if (!step.decode.ok) {
    return note(
      { ...withUsage, phase: { kind: "gathering" } },
      deps.now(),
      `the model produced no usable answer (${step.decode.reason}) — nothing was committed`,
      "abstention",
    );
  }

  const draft = step.decode.draft;

  // The structural escalation: the model wants to rank, and no basis was ever
  // established. The kernel would refuse the draft by name (IA-1/
  // ranking-basis-not-established — the same denial a mismatched basis gets),
  // so nothing rests on this branch; it exists so the exchange falls back to
  // the ladder and costs the visitor a question rather than a denial, now
  // required to establish the basis before any answer is compiled. The
  // trigger is the decoded claim's type, never the wording; a miss costs a
  // question — never a wrongly scoped commit, which the manifest gate holds.
  const wantsRanking = draft.claims.some((claim) => claim.kind === "ranking");
  if (wantsRanking && resolved.grant.scope.comparisonBasis === undefined) {
    return drive({ ...withUsage, required: [...REQUIRED_DIMENSIONS, "comparisonBasis"] }, deps);
  }

  const committedAt = deps.now();
  const renderedAt = deps.now();

  // One probe through the whole seam with a transport that declines: it
  // compiles, verifies, renders and attests — everything short of consent —
  // so the page the visitor decides on is already the attested one.
  const probe = runTransaction({
    id: transactionId,
    registry: world.registry,
    pack: world.pack,
    transcript: state.transcript,
    establishedAt,
    committedAt,
    locale: deps.locale ?? LOCALE,
    ...(state.required === undefined ? {} : { required: state.required }),
    plan: () => draft,
    act: {
      render: renderAnswer,
      confirm: () => null,
      renderedAt,
      authorizedAt: renderedAt,
      executedAt: renderedAt,
    },
  });

  switch (probe.outcome.status) {
    case "answered": {
      // No acts proposed: the probe is the exchange's record. The certified
      // page is rendered for display through the same planner the verifier
      // rules with — the record does not need it, the visitor does.
      return file(withUsage, probe, displayPage(deps.world, probe));
    }
    case "declined": {
      // Acts proposed and attested; the decline is the probe's, not the
      // visitor's. Hold the page and wait for the person.
      const artifact = probe.artifact;
      if (artifact === undefined) return file(withUsage, probe); // unreachable: declined carries its page
      return {
        ...withUsage,
        phase: { kind: "confirming-act", artifact },
        pending: {
          transactionId,
          establishedAt,
          committedAt,
          renderedAt,
          ...(state.required === undefined ? {} : { required: state.required }),
          draft,
          artifact,
        },
      };
    }
    default:
      // Denied at scope, answer or render — the named refusal is the record.
      return file(withUsage, probe, displayPage(deps.world, probe));
  }
}

/**
 * The committed answer as a page, for records the seam never rendered — a
 * question-only answer stops at "answered". Display beside the record, drawn
 * through the kernel's own planner; a plan that fails simply shows no page,
 * because a display convenience does not get to overrule a verifier.
 */
function displayPage(world: SessionWorld, record: Transaction): DomElement | undefined {
  if (record.artifact !== undefined) return record.artifact;
  if (record.manifest === undefined || record.grant === undefined) return undefined;
  const context: ManifestContext = {
    registry: world.registry,
    pack: world.pack,
    grant: record.grant,
    locale: record.locale,
    at: record.committedAt,
  };
  const planned = planRender(context, record.manifest);
  if (!planned.ok) return undefined;
  return renderAnswer(world.pack, planned.value);
}
