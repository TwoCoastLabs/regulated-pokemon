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

import type { Claim, ConfirmationEvent, ScopeDimension, ScopeEvent, ScopeTranscript, UtteranceSource, Violation } from "../kernel/contracts.js";
import { type DomElement, walkArtifact } from "../kernel/dom.js";
import type { ManifestContext, ManifestDraft } from "../kernel/manifest.js";
import type { AccordPack } from "../kernel/pack.js";
import { planRender } from "../kernel/render.js";
import type { CertifiedRegistry } from "../kernel/registry.js";
import { restrictionsFor } from "../kernel/pack.js";
import { resolveScope, type ScopeContext, unmatchedClauses } from "../kernel/scope.js";
import { requiredDimensionsFor } from "../kernel/scope-deps.js";
import { runTransaction, type Transaction } from "../kernel/transaction.js";
import { renderAnswer } from "../render/reference.js";
import { proposalDigest, proposeAnswer, proposeScope } from "../harness/advisor.js";
import { NO_CLAIMS_REASON } from "../harness/decode.js";
import { MAX_ANSWER_CLAIMS } from "../harness/schema.js";
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
  /**
   * Hand the proposer the certified registry to compose from, instead of asking
   * it to recall (facts only, never policy — see {@link certifiedReference}).
   * Nothing downstream trusts a grounded answer any more for having been
   * grounded: the manifest gate recomputes every value regardless, so this
   * changes only what the model is *asked*, never what may commit. Off by
   * default — the session measures a model answering from its own knowledge
   * unless a caller opts in.
   */
  grounded?: boolean;
  /** Ground with only the rows each question needs (retrieval) rather than the
   * whole registry — grounding's usefulness without its token bill. Takes
   * precedence over {@link grounded}. */
  retrieval?: boolean;
  /** Narrow the answer grammar to the filler kinds each question nominates — the
   * shape-deflection fix (§19). Independent of grounding. */
  gatedGrammar?: boolean;
  /**
   * Strip-assertion resubmit (docs/recovery.md, channel 2): when a probe is
   * denied and *every* violation is IA-2/fact-mismatch — the model named the
   * right fact and mis-recalled its value — the driver strips the assertions
   * and re-runs the whole gate once, so the kernel reads the certified value
   * instead. Deterministic, no model call, no verdict fed back; the mis-recall
   * is still counted ({@link SessionState.repairs}). Off by default.
   */
  repair?: boolean;
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

/**
 * A line the driver owes the visitor that no record carries: abstentions and
 * infrastructure failures, counted apart from everything the kernel says.
 *
 * Two registers on purpose (found live, 2026-08-31: the page flattened every
 * note to one system-voiced sentence, and a novice read a decline with no
 * decline in it). `text` is what the Advisor says — first person, plain,
 * actionable. `detail` is the diagnostic line — fixed, countable wording
 * (the S1 discipline) for the trace, the machinery view and the counters —
 * never the thing a novice has to parse.
 */
export interface SessionNote {
  at: string;
  text: string;
  tone: "abstention" | "error";
  detail?: string;
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
  /** Strip-assertion repairs performed (docs/recovery.md, channel 2) — the
   * count that keeps a repaired mis-recall on the books: a filed answer that
   * followed a repair is a post-repair resolution, and the accounting rule is
   * that first-attempt and post-repair are never blended. */
  repairs: number;
  /** Degenerate-comparison folds performed at decode (recovery channel 2,
   * Center loop 2) — a self-pair folded to the fact it means. Counted for the
   * same reason repairs are: a folded resolution is never blended with a
   * first-shape one. */
  folds: number;
  /** Ladder proposals spent on the current ask; a fresh utterance resets it. */
  ladderTurns: number;
  /**
   * The namespace this session's transaction ids are minted under. The
   * default "session" serves one live tab; a harness running the same
   * conversation more than once names each pass (epic #94, slice 5), because
   * two samples are two records and an id they share would say otherwise.
   */
  idPrefix?: string;
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

export function startSession(idPrefix?: string): SessionState {
  return {
    ...(idPrefix === undefined ? {} : { idPrefix }),
    transcript: [],
    records: [],
    pages: {},
    notes: [],
    usage: emptyUsage(),
    providerErrors: 0,
    phase: { kind: "gathering" },
    askStart: 0,
    repairs: 0,
    folds: 0,
    ladderTurns: 0,
  };
}

function note(state: SessionState, at: string, text: string, tone: SessionNote["tone"], detail?: string): SessionState {
  return { ...state, notes: [...state.notes, { at, text, tone, ...(detail === undefined ? {} : { detail }) }] };
}

/**
 * Fall to the pack's clarifying question, and record it as evidence.
 *
 * The question event in the transcript does two jobs at once: it keeps the
 * conversation whole for the visitor (a history of answers with no questions
 * is not a conversation), and it arms the kernel's `answer` route — the
 * trainer's direct reply binds this one dimension without a proposal or a
 * card, because the recorded question is the context (see kernel/scope.ts).
 * Re-asking the question already on the phase (a retry after an error, say)
 * records nothing new — the visitor was asked once.
 */
function ask(state: SessionState, at: string, dimension: ScopeDimension, question: string): SessionState {
  const repeat = state.phase.kind === "asking" && state.phase.question === question;
  return {
    ...state,
    phase: { kind: "asking", dimension, question },
    transcript: repeat
      ? state.transcript
      : [...state.transcript, { kind: "question", at, source: "advisor", dimension, text: question }],
  };
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
 * Content that reached the session on a channel the trainer does not speak on —
 * a retrieved document, a tool result, a third party. It is *recorded* so the
 * transcript is complete and replayable, and it drives the session exactly as
 * a trainer utterance does, but the resolver reads only the trainer's channel
 * (IA-8), so it can never bind scope. This is how a transport that can label
 * its inputs (a paste handler, a retrieval step) keeps injected text inert by
 * construction rather than by detection.
 */
export async function hear(
  state: SessionState,
  source: Exclude<UtteranceSource, "trainer" | "advisor">,
  text: string,
  deps: SessionDeps,
): Promise<SessionState> {
  const utterance: ScopeEvent = { kind: "utterance", at: deps.now(), source, text };
  return drive({ ...state, transcript: [...state.transcript, utterance] }, deps);
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
async function drive(
  state: SessionState,
  deps: SessionDeps,
  /** A discovery draft whose named scope turned out to be already granted —
   * forwarded so the answer step can certify it instead of re-asking the
   * model. Only the immediate needs-scope → granted hop carries one: the
   * moment a question or a card intervenes, the words may change, and a
   * stale draft must not answer them. `routed` marks a draft a deterministic
   * route composed (the deflected profile): its ask was about an entity, not
   * scope, so there is no vague wording for the ladder to interpret — the
   * pack's own question outranks the model (hard-won lesson 1; observed
   * live 2026-08-30: the ladder read "tell me about Pikachu" and proposed
   * version=yellow from nothing, and the confirmed card died at the gate as
   * IA-2/scope-version-mismatch). */
  reuse?: Pick<ManifestDraft, "claims" | "rosters"> & { routed?: boolean },
): Promise<SessionState> {
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
    // A grant honestly established over a version these records do not
    // certify. The kernel would refuse every registry-derived answer by name
    // (IA-2/scope-version-mismatch) — correct, and a dead end for a trainer
    // who did exactly what the boundary lesson asked ("if you are playing
    // Yellow, say so"). Lessons still teach across the boundary (reviewed
    // text is the same for every trainer); everything else gets the boundary
    // lesson itself, deterministically — the promised plain telling, filed
    // as a record like any answer.
    if (outcome.grant.scope.version !== world.registry.document.scope.versionGroup) {
      return foreignVersion(state, deps);
    }
    return answer(state, deps, reuse);
  }

  // Clarify — and the pack's own question outranks the model. A question is
  // free, deterministic, and armed: the trainer's direct answer to it binds
  // without a proposal or a card. The ladder exists for wording the
  // vocabulary could not read at all, so it runs only when the trainer's
  // latest words actually contain some — anything else turned every missing
  // dimension into a model call and a confirmation, which is how one
  // catalogue question became an interrogation.
  const lastSaid = [...state.transcript]
    .reverse()
    .find((event): event is Extract<ScopeEvent, { kind: "utterance" }> => event.kind === "utterance" && event.source === "trainer");

  // Propose first, then gather only what the answer needs (epic #64, slice 2).
  // On the *first* clarify of an ask, the model is asked once with no grant:
  // a lesson commits immediately (the lazy half of IA-1 — "what's a badge?"
  // answered with no interrogation), and any other claim it proposes is read
  // as *intent*, telling us which scope to establish and — via
  // `requiredDimensionsFor` — only what that claim depends on. Casual or
  // off-topic words produce no claims and earn an honest redirect, not a
  // three-question ceremony that could only end in an abstention.
  const askedAlready = state.transcript
    .slice(state.askStart)
    .some((event) => event.kind === "question");
  // A listing follow-up short-circuits discovery entirely: the shape is not
  // the model's to learn — the set is the previous exchange's certified
  // roster, and the route composes the draft from the record. `routed` skips
  // the ladder for whatever scope the memberships require, so a missing
  // dimension costs the pack's own question, never a model interpretation.
  if (lastSaid !== undefined && !askedAlready && state.required === undefined) {
    const listed = listingClaims(world, state, lastSaid.text);
    if (listed !== undefined) {
      return drive({ ...state, required: requiredDimensionsFor(listed.claims) }, deps, { ...listed, routed: true });
    }
  }
  // Not during an escalation: a widened `required` means an answer was already
  // attempted and wants more scope, so the shape is known and a fresh discovery
  // would only re-ask the model what it just told us.
  if (lastSaid !== undefined && !askedAlready && state.required === undefined) {
    const attempt = await teachOrDiscover(state, deps);
    state = attempt.state;
    if (attempt.result === "taught") return state;
    if (attempt.result === "off-domain") return redirect(state, deps);
    // "needs-scope": gather exactly the dimensions the proposed claims depend
    // on. "unusable" (the model gave no readable shape): fall to a version
    // floor and let the answer-time escalation add anything more the eventual
    // answer turns out to need — never the fixed triple, never `region`.
    const nextRequired =
      attempt.result === "needs-scope" ? requiredDimensionsFor(attempt.claims) : (["version"] as const);
    // Hand the discovery draft along. If the narrowed requirement is already
    // granted by the transcript, the answer step certifies *this* draft — the
    // one that was responsive to the ask — instead of paying a second model
    // call for a fresh guess. Observed live (2026-08-30, findings): the
    // re-ask cost 17-55s and answered the wrong question beside a discovery
    // draft that had answered the right one.
    return drive(
      { ...state, required: nextRequired },
      deps,
      attempt.result === "needs-scope"
        ? { claims: attempt.claims, rosters: attempt.rosters, ...(attempt.routed === true ? { routed: true } : {}) }
        : undefined,
    );
  }

  // The ladder's inbox, minus answer-subject wording. A clause that names a
  // certified entity is about the *answer* ("tell me about Pikachu"), and a
  // ladder handed it will free-associate scope out of it — observed live
  // (2026-08-30): version=yellow proposed from the mascot, confirmed, and
  // denied at the gate as IA-2/scope-version-mismatch. Scope wording the
  // vocabulary cannot read ("the yellow one") names no entity and still
  // reaches the ladder; an entity-naming clause falls to the pack's own
  // question, which is free, deterministic and armed (hard-won lesson 1).
  const scopeishClauses =
    lastSaid === undefined
      ? []
      : unmatchedClauses(world.pack, lastSaid.text).filter((clause) => !namesCertifiedEntity(world.registry, clause));
  const freshLongTail = scopeishClauses.length > 0;
  if (reuse?.routed === true || !freshLongTail || state.ladderTurns >= MAX_LADDER_TURNS) {
    return ask(state, deps.now(), outcome.asking, outcome.question);
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
      "I couldn't reach the model just now, so let me simply ask:",
      "error",
      `the provider failed during scope resolution (${cause instanceof Error ? cause.message : String(cause)})`,
    );
    return ask(failed, deps.now(), outcome.asking, outcome.question);
  }

  const spent = { ...state, usage: addUsage(state.usage, step.usage), ladderTurns: state.ladderTurns + 1 };
  if (step.event === null) {
    // Nothing usable to propose: fall to the deterministic question rather
    // than burning the remaining budget on the same words.
    return ask(spent, deps.now(), outcome.asking, outcome.question);
  }

  return {
    ...spent,
    transcript: [...spent.transcript, step.event],
    phase: { kind: "confirming-scope", proposal: step.event },
  };
}

function nextTransactionId(state: SessionState): string {
  return `${state.idPrefix ?? "session"}-${state.records.length + 1}`;
}

/**
 * Advisory wording, stated as an explicit list rather than inferred. The gate
 * trades recall for specificity on purpose (a miss falls through to today's
 * behaviour, which is safe); what it may never do is fire on a plain factual
 * question and dress it in advice.
 */
const ADVISORY_WORDING =
  /\b(should|worth|recommend|advise|advice|catch|chase|hunt|pursue|go (?:for|get|after)|aim for|get one|team)\b/i;

/**
 * The deterministic eligibility route (epic #54, slice 2): when the ask names
 * a restricted species in an advisory frame, the pack itself can answer — the
 * governing rule, the threshold, the trainer's own standing — with no model in
 * the loop. Lexical matching gates *recall* here, never proof: this function
 * only nominates a claim, and the kernel derives and verifies everything in
 * it. A model that already answered about the species advice-wise
 * (recommendation, eligibility, act) is left alone; one that deflected into
 * adjacent facts, or produced nothing, gets the on-target answer appended.
 */
export function eligibilityClaims(
  world: SessionWorld,
  ask: string,
  proposed: readonly Claim[],
): readonly Claim[] {
  if (!ADVISORY_WORDING.test(ask)) return [];
  const lowered = ask.toLowerCase();

  const adviceAbout = new Set(
    proposed.flatMap((claim) =>
      claim.kind === "recommendation" || claim.kind === "eligibility" || claim.kind === "action"
        ? [claim.entityId]
        : [],
    ),
  );

  const claims: Claim[] = [];
  for (const species of world.registry.species) {
    if (restrictionsFor(world.pack, species).length === 0) continue;
    // Word-bounded, so "mew" never fires inside "mewtwo".
    if (!new RegExp(`\\b${species.id}\\b`, "i").test(lowered)) continue;
    if (adviceAbout.has(species.id)) continue;
    claims.push({ kind: "eligibility", entityId: species.id });
  }
  return claims;
}

/**
 * The trainer's earlier asks, offered to the answer step only when the
 * current words name nothing the front doors can read — no species, no type.
 * That is the anaphoric case ("can you list at least 10 for me?" — found
 * live, 2026-08-31: the model received it with no antecedent and could only
 * abstain); an ask that names its own subject keeps the single-ask prompt.
 * Trainer channel only, last three utterances, deterministic gate.
 */
function isAnaphoric(world: SessionWorld, ask: string): boolean {
  if (namesCertifiedEntity(world.registry, ask)) return false;
  const haystack = ` ${ask.toLowerCase()} `;
  return ![...world.registry.typeNames].some((type) => new RegExp(`\\b${type}\\b`).test(haystack));
}

function anaphorContext(world: SessionWorld, state: SessionState, ask: string): readonly string[] | undefined {
  if (state.askStart === 0) return undefined;
  if (!isAnaphoric(world, ask)) return undefined;
  const prior = state.transcript
    .slice(0, state.askStart)
    .flatMap((event) => (event.kind === "utterance" && event.source === "trainer" ? [event.text] : []))
    .slice(-3);
  return prior.length === 0 ? undefined : prior;
}

/**
 * The profile a specific-entity ask earns when the model deflects it to a
 * curriculum lesson.
 *
 * Observed live (2026-08-30, gemini-3.5-flash-lite): "tell me about Pikachu"
 * decoded to `explanation:what-is-pokemon` — the generic lesson, committed
 * grantless as taught, and the retry deflected identically. The discovery
 * prompt already forbids "a lesson that is merely adjacent"; a small model
 * ignores the sentence, so the driver reads the ask deterministically
 * instead: when the trainer named exactly one certified species and the
 * whole draft is lessons, the ask was about the entity, and the entity's
 * certified profile — types, the six base stats, the dex number — is the
 * on-target answer. Facts only, kernel-derived and kernel-verified; the
 * route composes a shape, never a value. One entity exactly: zero named
 * means the lesson may well be the ask ("what is a Pokémon?"), two means
 * the ask is a comparison the profile cannot speak for.
 *
 * Word-bounded with the hyphen fold ("Mr. Mime" finds mr-mime), the same
 * discipline as {@link eligibilityClaims} and the retrieval front door —
 * deterministic, so its misses are measurable (lesson 6), and it can only
 * *widen* what the kernel certifies, never bind scope or assert a value.
 */
export function deflectedProfileClaims(world: SessionWorld, ask: string, proposed: readonly Claim[]): readonly Claim[] {
  if (proposed.length === 0 || !proposed.every((claim) => claim.kind === "explanation")) return [];
  const haystack = ` ${ask.toLowerCase()} `;
  const names = (id: string): boolean =>
    new RegExp(`\\b${id.split("-").join("[\\s-]?")}\\b`).test(haystack);
  const named = world.registry.speciesIds.filter((id) => names(id));
  if (named.length !== 1) return [];
  const entityId = named[0]!;
  return [
    { kind: "fact", entityId, factId: "types" },
    { kind: "fact", entityId, factId: "pokedex-number" },
    { kind: "fact", entityId, factId: "base-hp" },
    { kind: "fact", entityId, factId: "base-attack" },
    { kind: "fact", entityId, factId: "base-defense" },
    { kind: "fact", entityId, factId: "base-speed" },
    { kind: "fact", entityId, factId: "base-special-attack" },
    { kind: "fact", entityId, factId: "base-special-defense" },
  ];
}

/** Whether a clause names any certified species — the same word-bounded,
 * hyphen-folded reading as {@link deflectedProfileClaims}, shared so the two
 * doors cannot drift. */
function namesCertifiedEntity(registry: CertifiedRegistry, clause: string): boolean {
  const haystack = ` ${clause.toLowerCase()} `;
  return registry.speciesIds.some((id) =>
    new RegExp(`\\b${id.split("-").join("[\\s-]?")}\\b`).test(haystack),
  );
}

/**
 * The redirect an off-domain opener earns instead of an interrogation.
 *
 * When the discovery call proposes no claims at all, nothing certified is even
 * relevant — the words are casual or off-topic. A three-question intake could
 * only end in an abstention, so the visitor gets an honest pointer at what the
 * Advisor can answer. Like an abstention, it files no record.
 */
function redirect(state: SessionState, deps: SessionDeps): SessionState {
  return note(
    { ...state, phase: { kind: "gathering" } },
    deps.now(),
    "I couldn't line that up with anything I can certify. I answer questions about specific " +
      "Pokémon, their moves and matchups, League eligibility, and how the game works — try one of those.",
    "abstention",
  );
}

/** Scope is granted: ask the model for the answer and put it to the seam. */
/**
 * One grantless discovery call: learn what the answer needs before gathering.
 *
 * A lessons-only draft is committed on the spot — the lazy half of IA-1, a text
 * that is the same for every trainer. Anything else is *not* committed here: a
 * draft with any personalized claim reports `needs-scope` and hands its claims
 * back, so the driver can establish exactly the dimensions those claims depend
 * on and no more. No claims at all is `off-domain`; a provider failure or an
 * unreadable reply is `unusable`, which falls to a version floor rather than a
 * refusal. Usage is kept in every case — a discovery call still happened.
 */
async function teachOrDiscover(
  state: SessionState,
  deps: SessionDeps,
  /** Only reviewed lessons may commit — the foreign-version path: any draft
   * that reads the registry falls out as needs-scope for the caller to
   * answer with the boundary lesson instead of a denial. */
  lessonsOnly = false,
): Promise<{
  state: SessionState;
  result: "taught" | "off-domain" | "needs-scope" | "unusable";
  claims: readonly Claim[];
  /** The decoded rosters beside the claims, so a needs-scope draft can be
   * reused whole once the scope it named turns out to be already granted. */
  rosters: Pick<ManifestDraft, "rosters">["rosters"];
  /** True when a deterministic route composed the claims (the deflected
   * profile) — the ladder is then skipped for the scope they require. */
  routed?: boolean;
}> {
  const { world, provider } = deps;
  const transactionId = nextTransactionId(state);
  const establishedAt = deps.now();
  const bare: ManifestContext = {
    registry: world.registry,
    pack: world.pack,
    locale: deps.locale ?? LOCALE,
    at: establishedAt,
  };

  const askWords = state.transcript
    .slice(state.askStart)
    .flatMap((event) => (event.kind === "utterance" && event.source === "trainer" ? [event.text] : []))
    .join(" ");
  const previously = anaphorContext(world, state, askWords);

  let step;
  try {
    step = await proposeAnswer({
      provider,
      context: bare,
      scenarioId: "session",
      transactionId,
      transcript: state.transcript.slice(state.askStart),
      ...(previously === undefined ? {} : { previously }),
      ...(deps.grounded === undefined ? {} : { grounded: deps.grounded }),
      ...(deps.retrieval === undefined ? {} : { retrieval: deps.retrieval }),
      ...(deps.gatedGrammar === undefined ? {} : { gatedGrammar: deps.gatedGrammar }),
    });
  } catch {
    // The question is still free: a failed discovery falls to the floor rather
    // than surfacing an error for a call the visitor never asked for. The
    // counter still moves — provider failures are never hidden in outcomes.
    return { state: { ...state, providerErrors: state.providerErrors + 1 }, result: "unusable", claims: [], rosters: [] };
  }

  const spent = { ...state, usage: addUsage(state.usage, step.usage) };
  if (!step.decode.ok) {
    // A well-formed reply with no claims is the model's own signal that nothing
    // certified is relevant — off-domain, and the visitor gets a redirect. Any
    // other decode failure is unreadable, not off-domain: it falls to the floor
    // and gathers scope, so a real question the model merely fumbled is not
    // waved away.
    return { state: spent, result: step.decode.reason === NO_CLAIMS_REASON ? "off-domain" : "unusable", claims: [], rosters: [] };
  }
  const draft = step.decode.draft;
  const spentFolded = { ...spent, folds: spent.folds + step.decode.folds };
  // A lesson-only draft for an ask that named one specific species is the
  // deflection this route exists for: the profile replaces the lesson and
  // goes through scope like any personalized answer would have.
  const profile = deflectedProfileClaims(world, askWords, draft.claims);
  if (profile.length > 0) {
    return { state: spentFolded, result: "needs-scope", claims: profile, rosters: [], routed: true };
  }
  // Under lessonsOnly, anything that reads the registry — a fact, a game
  // rule, any roster — is the caller's to answer, not this path's to commit:
  // the kernel would refuse it across the version boundary by name.
  if (lessonsOnly && (draft.claims.some((claim) => claim.kind !== "explanation") || draft.rosters.length > 0)) {
    return { state: spentFolded, result: "needs-scope", claims: draft.claims, rosters: draft.rosters };
  }
  // Commit grantless when nothing in the draft depends on scope — a lesson, a
  // game-rule constant, the same answer for every trainer (epic #64). Derived
  // from the one dependency table, so this never drifts from what the kernel's
  // own scope gate will allow grantless.
  if (requiredDimensionsFor(draft.claims).length === 0) {
    return { state: commit(spentFolded, deps, { transactionId, establishedAt, draft }), result: "taught", claims: draft.claims, rosters: draft.rosters };
  }
  return { state: spentFolded, result: "needs-scope", claims: draft.claims, rosters: draft.rosters };
}

/** Wording that asks for members to be enumerated. Word-bounded and paired
 * with the anaphoric gate, so "list Electric ones" (a subject of its own)
 * still goes to the model and only a bare "list some for me" takes the
 * deterministic road. */
const LISTING_CUE = /\b(list|name|show|give)\b/i;

/**
 * The listing a bare "can you list at least 10 for me?" earns — composed
 * from the record, not the model. Found live (2026-08-31): the follow-up
 * reached the model with its antecedent attached and the model still
 * passed; but the antecedent's set is not in the model's head, it is the
 * previous exchange's certified roster, filed in the session's own records.
 * The route reuses that roster verbatim, lists its first N members as
 * membership claims (each re-verified by the kernel like any claim), and
 * keeps the count beside the sample so the total is never mistaken for the
 * list. N comes from the trainer's own number, clamped to the claim budget.
 */
function listingClaims(world: SessionWorld, state: SessionState, ask: string): Pick<ManifestDraft, "claims" | "rosters"> | undefined {
  if (!LISTING_CUE.test(ask) || !isAnaphoric(world, ask)) return undefined;
  const prior = [...state.records].reverse().find((record) => (record.manifest?.rosters.length ?? 0) > 0);
  const roster = prior?.manifest?.rosters[0];
  if (roster === undefined || roster.memberIds.length === 0) return undefined;
  const asked = Number(/\d+/.exec(ask)?.[0]);
  const n = Math.min(Number.isFinite(asked) && asked > 0 ? asked : 10, MAX_ANSWER_CLAIMS - 1, roster.memberIds.length);
  return {
    rosters: [roster],
    claims: [
      ...roster.memberIds.slice(0, n).map((entityId) => ({ kind: "membership", rosterId: roster.id, entityId, asserted: true }) as const),
      { kind: "count", rosterId: roster.id },
    ],
  };
}

/** The reviewed block that owns the version boundary, when the pack carries
 * one. Named here, not in the kernel: which lesson explains the boundary is
 * curriculum, not enforcement. */
const BOUNDARY_LESSON = "red-blue-vs-yellow";

/**
 * The session for a trainer whose honest version these records do not
 * certify. Lessons still teach (reviewed text is the same for every trainer
 * — the kernel's own scoping of the version check); everything that reads
 * the registry gets the boundary lesson, deterministically, as a filed
 * record — the "plain telling" that lesson promises, instead of a denial
 * the trainer cannot act on. Off-domain words still earn the redirect.
 */
async function foreignVersion(state: SessionState, deps: SessionDeps): Promise<SessionState> {
  const attempt = await teachOrDiscover(state, deps, true);
  if (attempt.result === "taught") return attempt.state;
  if (attempt.result === "off-domain") return redirect(attempt.state, deps);
  return teachBoundary(attempt.state, deps);
}

function teachBoundary(state: SessionState, deps: SessionDeps): SessionState {
  if (!deps.world.pack.curriculum.some((lesson) => lesson.id === BOUNDARY_LESSON)) {
    // A pack without the boundary block falls to the honest note — never a
    // fabricated lesson, and never the bare denial this path exists to spare.
    return note(
      { ...state, phase: { kind: "gathering" } },
      deps.now(),
      "these records certify Red and Blue only — questions about your version's own facts are outside them, though the catalogue lessons still apply",
      "abstention",
    );
  }
  const transactionId = nextTransactionId(state);
  const establishedAt = deps.now();
  return commit(state, deps, {
    transactionId,
    establishedAt,
    draft: { transactionId, claims: [{ kind: "explanation", blockId: BOUNDARY_LESSON }], rosters: [] },
  });
}

async function answer(
  state: SessionState,
  deps: SessionDeps,
  reuse?: Pick<ManifestDraft, "claims" | "rosters">,
): Promise<SessionState> {
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

  const currentAsk = state.transcript
    .slice(state.askStart)
    .flatMap((event) => (event.kind === "utterance" && event.source === "trainer" ? [event.text] : []))
    .join(" ");
  // A bare listing follow-up is answered from the record it refers to — the
  // previous exchange's certified roster — never from a model's guess at the
  // antecedent (and the weak model, handed the antecedent, still passed).
  // The route outranks a model draft arriving on the discovery hop: for a
  // listing ask, the record is the authority on what "them" means.
  reuse = listingClaims(world, state, currentAsk) ?? reuse;

  let step;
  if (reuse !== undefined) {
    // The discovery call already proposed this draft for these exact words,
    // and the scope it named was already granted — re-asking the model would
    // only pay a second generation for a fresh guess at the same question
    // (observed live: slower and sometimes less responsive than the draft it
    // replaced). The kernel compiles and verifies the reused draft exactly
    // as it would a fresh one; nothing about what may commit changes. Folds
    // and usage were already counted when the draft was decoded.
    step = {
      usage: emptyUsage(),
      decode: { ok: true as const, draft: { transactionId, claims: reuse.claims, rosters: reuse.rosters }, folds: 0 },
    };
  } else {
    try {
      const currentWords = state.transcript
        .slice(state.askStart)
        .flatMap((event) => (event.kind === "utterance" && event.source === "trainer" ? [event.text] : []))
        .join(" ");
      const previously = anaphorContext(world, state, currentWords);
      step = await proposeAnswer({
        provider,
        context,
        scenarioId: "session",
        transactionId,
        // The ask being answered, not the whole session: scope reads the full
        // transcript, but the answer should be responsive to the current words.
        transcript: state.transcript.slice(state.askStart),
        ...(previously === undefined ? {} : { previously }),
        ...(deps.grounded === undefined ? {} : { grounded: deps.grounded }),
        ...(deps.retrieval === undefined ? {} : { retrieval: deps.retrieval }),
        ...(deps.gatedGrammar === undefined ? {} : { gatedGrammar: deps.gatedGrammar }),
      });
    } catch (cause) {
      return note(
        { ...state, providerErrors: state.providerErrors + 1, phase: { kind: "gathering" } },
        deps.now(),
        "I couldn't reach the model just now — nothing was lost on your side. Try that again in a moment.",
        "error",
        `the provider failed producing the answer (${cause instanceof Error ? cause.message : String(cause)})`,
      );
    }
  }

  const withUsage = {
    ...state,
    usage: addUsage(state.usage, step.usage),
    folds: state.folds + (step.decode.ok ? step.decode.folds : 0),
  };

  // The ask, as the trainer worded it — what the deterministic route reads.
  const ask = state.transcript
    .slice(state.askStart)
    .flatMap((event) => (event.kind === "utterance" && event.source === "trainer" ? [event.text] : []))
    .join(" ");

  let draft: ManifestDraft;
  if (!step.decode.ok) {
    // Before conceding an abstention, let the pack answer what it can: a
    // gated advisory ask has a deterministic, certified answer — the rule.
    const routed = eligibilityClaims(world, ask, []);
    if (routed.length === 0) {
      return note(
        { ...withUsage, phase: { kind: "gathering" } },
        deps.now(),
        "I don't have a certified answer for that one, so I'd rather pass than guess. " +
          "A specific Pokémon, a move, or a how-the-game-works question usually lands.",
        "abstention",
        `the model produced no usable answer (${step.decode.reason}) — nothing was committed`,
      );
    }
    draft = { transactionId, claims: routed, rosters: [] };
  } else {
    const decoded = step.decode.draft;
    // A model that deflected a gated advisory ask into adjacent facts gets the
    // on-target answer appended; one that addressed the species advice-wise —
    // including by proposing the gated advice the kernel will deny — is left
    // alone, so the route never softens a denial the gate has earned.
    const routed = eligibilityClaims(world, ask, decoded.claims);
    // The lesson deflection has the same backstop here as at discovery: a
    // scoped answer that is all lessons for an ask naming one species gets
    // the entity's profile instead — the model can deflect at either hop.
    const profile = deflectedProfileClaims(world, ask, decoded.claims);
    draft =
      profile.length > 0
        ? { ...decoded, claims: profile, rosters: [] }
        : routed.length === 0
          ? decoded
          : { ...decoded, claims: [...decoded.claims, ...routed] };
  }

  // The scope escalation, generalized (epic #64, slice 2). The proposed answer
  // may depend on a dimension the grant does not hold — a ranking with no basis
  // established, an eligibility ruling reached after only a version was asked.
  // The kernel would refuse such a draft by name (scope-dimension-missing, or
  // ranking-basis-not-established), so nothing rests on this branch; it exists
  // so the exchange gathers exactly what the drafted claims require and costs
  // the visitor a question rather than a denial. The trigger is the claims'
  // declared dependencies, never the wording; a miss costs a question, never a
  // wrongly scoped commit, which the manifest gate holds.
  const needed = requiredDimensionsFor(draft.claims);
  const unbound = needed.filter((dimension) => resolved.grant.scope[dimension] === undefined);
  if (unbound.length > 0) {
    return drive({ ...withUsage, required: needed }, deps);
  }

  return commit(withUsage, deps, { transactionId, establishedAt, draft });
}

/**
 * Put a draft to the seam and settle the exchange. One probe through the whole
 * transaction with a transport that declines: it compiles, verifies, renders
 * and attests — everything short of consent — so the page the visitor decides
 * on is already the attested one.
 */
function commit(
  state: SessionState,
  deps: SessionDeps,
  exchange: { transactionId: string; establishedAt: string; draft: ManifestDraft },
): SessionState {
  const { world } = deps;
  const { transactionId, establishedAt, draft } = exchange;

  /** One full pass through the seam — compile, verify, render, attest — with
   * fresh moments from the transport's clock. Called at most twice: the first
   * probe, and once more after a strip-assertion repair; the repaired draft
   * re-enters the *entire* gate, never a delta check. */
  const attempt = (planned: ManifestDraft): { record: Transaction; committedAt: string; renderedAt: string } => {
    const committedAt = deps.now();
    const renderedAt = deps.now();
    const record = runTransaction({
      id: transactionId,
      registry: world.registry,
      pack: world.pack,
      transcript: state.transcript,
      establishedAt,
      committedAt,
      locale: deps.locale ?? LOCALE,
      ...(state.required === undefined ? {} : { required: state.required }),
      plan: () => planned,
      act: {
        render: renderAnswer,
        confirm: () => null,
        renderedAt,
        authorizedAt: renderedAt,
        executedAt: renderedAt,
      },
    });
    return { record, committedAt, renderedAt };
  };

  let planned = draft;
  let ran = attempt(planned);

  // Strip-assertion resubmit (docs/recovery.md, channel 2). Only when every
  // violation is IA-2/fact-mismatch — the model named the right fact and
  // mis-recalled its value — the driver strips the assertions and runs the
  // whole gate once more; the kernel then reads the certified value, because
  // an omitted value defers to it and can never disagree. Deterministic, no
  // model call, no verdict fed back to the model; any other violation in the
  // denial (a fabricated entity, a gated recommendation) falls closed to the
  // denial exactly as before. Capped structurally at one repair — the second
  // outcome files whatever it is.
  if (ran.record.outcome.status === "denied" && deps.repair === true) {
    const stripped = stripAssertions(planned, ran.record.outcome.violations);
    if (stripped !== undefined) {
      planned = stripped;
      ran = attempt(planned);
      // The mis-recall stays on the books: whatever files below is a
      // post-repair outcome, and the accounting never blends the two.
      state = { ...state, repairs: state.repairs + 1 };
    }
  }

  const { record, committedAt, renderedAt } = ran;
  switch (record.outcome.status) {
    case "answered": {
      // No acts proposed: the probe is the exchange's record. The certified
      // page is rendered for display through the same planner the verifier
      // rules with — the record does not need it, the visitor does.
      return file(state, record, displayPage(deps.world, record));
    }
    case "declined": {
      // Acts proposed and attested; the decline is the probe's, not the
      // visitor's. Hold the page and wait for the person.
      const artifact = record.artifact;
      if (artifact === undefined) return file(state, record); // unreachable: declined carries its page
      return {
        ...state,
        phase: { kind: "confirming-act", artifact },
        pending: {
          transactionId,
          establishedAt,
          committedAt,
          renderedAt,
          ...(state.required === undefined ? {} : { required: state.required }),
          draft: planned,
          artifact,
        },
      };
    }
    default:
      // Denied at scope, answer or render — the named refusal is the record.
      return file(state, record, displayPage(deps.world, record));
  }
}

/**
 * The repaired draft, or `undefined` when the denial is not repairable.
 *
 * Repairable means *every* violation is IA-2/fact-mismatch and the draft
 * actually carries an asserted fact value to strip. All asserted fact values
 * are stripped, not just provably-offending ones: a name-only fact defers to
 * the certified value, so stripping a *correct* assertion changes nothing —
 * which is what makes the repair safe without matching violations to claims.
 * A membership's `asserted` is never stripped: there the assertion *is* the
 * claim, and removing it would leave nothing to verify.
 */
function stripAssertions(draft: ManifestDraft, violations: readonly Violation[]): ManifestDraft | undefined {
  if (violations.length === 0) return undefined;
  if (!violations.every((item) => item.article === "IA-2" && item.rule === "fact-mismatch")) return undefined;
  let stripped = false;
  const claims = draft.claims.map((claim) => {
    if (claim.kind !== "fact" || claim.asserted === undefined) return claim;
    stripped = true;
    const { asserted: _asserted, ...named } = claim;
    return named;
  });
  if (!stripped) return undefined;
  return { ...draft, claims };
}

/**
 * The committed answer as a page, for records the seam never rendered — a
 * question-only answer stops at "answered". Display beside the record, drawn
 * through the kernel's own planner; a plan that fails simply shows no page,
 * because a display convenience does not get to overrule a verifier.
 */
function displayPage(world: SessionWorld, record: Transaction): DomElement | undefined {
  if (record.artifact !== undefined) return record.artifact;
  // A manifest is all the planner needs — the grant is optional, exactly as it
  // is in the kernel. A grantless answer is the taught lesson (the lazy half of
  // IA-1), and it has a page to show like any other; requiring a grant here
  // left every teaching answer rendering as a bare provenance banner.
  if (record.manifest === undefined) return undefined;
  const context: ManifestContext = {
    registry: world.registry,
    pack: world.pack,
    ...(record.grant === undefined ? {} : { grant: record.grant }),
    locale: record.locale,
    at: record.committedAt,
  };
  const planned = planRender(context, record.manifest);
  if (!planned.ok) return undefined;
  return renderAnswer(world.pack, planned.value);
}
