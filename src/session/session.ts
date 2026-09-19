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

import type {
  Claim,
  ClarificationOption,
  ConfirmationEvent,
  ScopeCandidate,
  ScopeDimension,
  ScopeEvent,
  ScopeTranscript,
  UtteranceSource,
  Violation,
} from "../kernel/contracts.js";
import { type DomElement, walkArtifact } from "../kernel/dom.js";
import { type ManifestContext, type ManifestDraft, MAX_SUGGESTIONS, suggestionProblem } from "../kernel/manifest.js";
import type { AccordPack } from "../kernel/pack.js";
import { planRender } from "../kernel/render.js";
import type { CertifiedRegistry } from "../kernel/registry.js";
import { NO_FIELD, restrictionsFor } from "../kernel/pack.js";
import { type LessonMatcherId, type LessonOffer, lessonFoothold, lessonOffer } from "./lesson-matcher.js";
import { clauseTexts, deriveScope, resolveScope, type ScopeContext, unmatchedClauses } from "../kernel/scope.js";
import { requiredDimensionsFor } from "../kernel/scope-deps.js";
import { buildRoster } from "../kernel/roster.js";
import { runTransaction, type Transaction } from "../kernel/transaction.js";
import { renderAnswer } from "../render/reference.js";
import { denialCode } from "../kernel/violation.js";
import { type AnswerStep, classifyLessonAsk, type LessonAskKind, phraseQuestion, type PromptShape, proposalDigest, proposeAnswer, proposeScope, usableQuestion } from "../harness/advisor.js";
import { type AnswerDecode, NO_CLAIMS_REASON } from "../harness/decode.js";
import { MAX_ANSWER_CLAIMS, type NominableRoute } from "../harness/schema.js";
import { addUsage, emptyUsage, type ModelProvider, type Usage } from "../harness/provider.js";
import { retrievalSelection } from "../harness/reference.js";
import {
  DEFAULT_PRECEDENT_LEVERS,
  fixedPrecedents,
  followed,
  type HeldPrecedent,
  type HoldOut,
  type PrecedentLevers,
  type PrecedentStore,
  retrievePrecedents,
} from "../memory/precedent.js";
import { aliasContradiction, fieldsOfClaim, freshLinks, linkClaims } from "./linking.js";
import { canonicalId, certifies, MAX_CLARIFICATIONS, matchPick, scopeOptions, validOptions } from "./clarify.js";
import { closeLedger, type DriverStep, type ExchangeLedger, type LedgerCode, ledgerOf, step as ledgerEntry, type StepLane } from "./ledger.js";

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
  /**
   * The verifier-in-the-loop retry (docs/routing.md, R3b): when the answer
   * step's draft is denied at the answer stage for anything but the repair's
   * own class (an all-fact-mismatch denial), one more model call carries the
   * denial by name — fixed wording derived from the violations, never free
   * prose — and the second reply is groomed and verified exactly as the
   * first. A second denial files as it stands. Counted
   * ({@link SessionState.feedbackRetries}) and the first denial kept
   * ({@link SessionState.feedbackDenials}), so a post-feedback resolution is
   * never blended with a first-attempt one. Off by default.
   */
  feedback?: boolean;
  /**
   * Clarification (docs/routing.md, R3b step 3): the model may ask, the
   * trainer's pick binds. Three things turn on together — the answer grammar
   * offers a `clarify` nomination with typed options; an alias contradiction
   * becomes a question with the two fields as options instead of a stock
   * line; and the pack's fixed scope question is put to the model to phrase
   * in the light of the ask (one small call, the pack's line as fallback).
   * Every option is typed against the dictionary or the registry, a pick is
   * applied structurally at linking, at most {@link MAX_CLARIFICATIONS}
   * questions are asked per ask, and every question is a recorded event.
   * Counted ({@link SessionState.clarification}). Off by default — on in the
   * live page and the tracer, off in the banks until their leg.
   */
  clarify?: boolean;
  /**
   * Follow-up suggestions (docs/routing.md, R3b step 4): the model may offer
   * up to three questions the trainer might ask next, beside its claims.
   * Not claims — a suggestion asserts nothing — and shown on the certified
   * page in a register the pack labels as the Advisor's own, uncertified,
   * which the affidavit attributes to the model. Held to one rule at two
   * gates: a suggestion names a topic, never a value (no digit, no certified
   * id) — the driver drops offenders here ({@link SessionState.suggestions}
   * counts them) and the kernel refuses any that reach a manifest. Off by
   * default — on in the live page and the tracer, off in the banks until
   * their leg.
   */
  suggest?: boolean;
  /**
   * The precedent door (docs/precedent.md, epic #169 M1): the operator's
   * store of earlier accepted, on-target exchanges. Before an exchange's
   * first answer call the driver retrieves the nearest few for the ask and
   * every call of the exchange holds them as worked examples of which door
   * to take — ids and kinds, never a value. Nothing downstream reads them:
   * the draft they influence faces the whole gate, and the verdict never
   * depends on them. The store is read here and written nowhere on the
   * live path. Off by default.
   */
  precedents?: SessionPrecedents;
  /**
   * Which answer prompt the calls build (docs/answer-prompt.md, epic #169
   * M3): `legacy`, the prompt as it accreted, or `blocks`, the fixed block
   * sequence — the task and the reply shape first, the question next,
   * context only when present, each rule once. The same data and the same
   * grammar under both; the gate is untouched. `legacy` when absent, until
   * the measurement picks the default.
   */
  prompt?: PromptShape;
  /**
   * The refused nomination, fed back (docs/answer-prompt.md, M3): when the
   * model's whole reply was a nomination the driver refused, the retry's
   * prompt carries the refusal by name in the driver's fixed wording —
   * the way a kernel denial is carried back — instead of the door being
   * withdrawn in silence. Off by default: the silent withdrawal is the
   * measured behaviour until the arm with the number becomes the default.
   */
  refusalFeedback?: boolean;
  /**
   * The offered door (docs/offered-door.md, epic #118 S4a): the listing
   * route is in the answer grammar only when the executor's ask-only
   * checks would accept a nomination of it — the ask names no certified
   * subject, and names one type or is the bare catalogue ask. The same
   * check, moved from after the call to before it; the executor keeps
   * every check it has. Off by default until the legs pick the default:
   * every door is offered on every first call, as today.
   */
  offeredDoors?: boolean;
  /**
   * The lesson door (docs/lesson-door.md, epic #118 S4b): the explanation
   * route carries only the lessons whose declared coverage the ask names,
   * plus the records-boundary lesson, always — instead of the pack's whole
   * catalogue on every call. Read from the pack's `covers` data; a pack
   * that declares none offers everything, and the trail says so. Off by
   * default until the legs pick the default.
   */
  lessonDoor?: boolean;
  /** Which matcher the lesson door runs (src/session/lesson-matcher.ts):
   * the declared aliases, or the BM25 index over the lesson text. Read
   * only with the door on. */
  lessonMatcher?: LessonMatcherId;
  /**
   * The lesson door's fallback (docs/lesson-door.md, the classifier): when
   * the deterministic matcher offers the boundary alone, ask the model
   * what kind of question this is, once, and offer the lesson it names
   * beside the boundary. A model call on exactly the asks the
   * deterministic door could not place, so its lift and its cost are
   * read in isolation. Recorded as a step and on the trace; off by default.
   */
  lessonClassifier?: boolean;
  /**
   * Every ledger step, as the driver takes it — with the state as it stood
   * once the step was on it. Observation only: the driver never reads the
   * hook's return, and a session observed and a session unobserved file
   * identical records. The live page reads it to draw the exchange in
   * progress (the step trail growing, one plain line under the chat)
   * instead of a fixed "thinking" line until the whole exchange returns.
   * A step the driver takes on a branch it then abandons is reported too,
   * so a reader treats what it sees as in progress, not as filed.
   */
  onStep?: (step: DriverStep, state: SessionState) => void;
}

/** The one dependency the ledger wrapper needs — every helper that writes
 * a step takes it, so no step is taken unobserved. */
type StepSink = Pick<SessionDeps, "onStep">;

/**
 * The driver's one way of writing a step: the ledger's `step`, reported to
 * {@link SessionDeps.onStep} as it lands. Same signature as the ledger's,
 * with the sink after the state.
 */
function ledgerStep(state: SessionState, deps: StepSink, at: string, lane: StepLane, code: LedgerCode, text: string, count?: number, lines?: readonly string[]): SessionState {
  const next = ledgerEntry(state, at, lane, code, text, count, lines);
  deps.onStep?.(next.steps[next.steps.length - 1]!, next);
  return next;
}

/** What the session holds of the operator's memory. */
export interface SessionPrecedents {
  store: PrecedentStore;
  levers?: PrecedentLevers;
  /** What a bank run withholds, so a precedent never answers for the entry
   * it was made from (the hold-out rule, enforced in the retriever). */
  holdOut?: HoldOut;
  /** The fixed arm of the measurement: these precedents on every call,
   * whatever the ask — a few-shot effect read apart from a retrieval one. */
  fixed?: readonly string[];
}

/** The advisor's own clarifying question, as recorded. */
export type ClarificationEvent = Extract<ScopeEvent, { kind: "clarification" }>;

export type ScopeProposal = Extract<ScopeEvent, { kind: "proposal" }>;

/**
 * What the session is waiting for.
 *
 *  - `gathering`        the visitor's words, to open or continue an exchange.
 *  - `asking`           an answer to the pack's own clarifying question — the
 *                       deterministic fallback when the model cannot help.
 *                       `options` are the vocabulary's approved values, for
 *                       a page to offer as clicks; a click says the label.
 *  - `clarifying`       the visitor's pick among the typed options of the
 *                       advisor's own question (R3b step 3) — by click, or
 *                       by words matching an option's label or alias.
 *  - `confirming-scope` the visitor's verdict on the model's interpretation:
 *                       the propose/confirm ladder, with a person on the end.
 *  - `confirming-act`   consent to the acts on the attested page — the one
 *                       moment IA-7 exists for.
 */
export type SessionPhase =
  | { kind: "gathering" }
  | { kind: "asking"; dimension: ScopeDimension; question: string; options: readonly string[] }
  | { kind: "clarifying"; clarification: ClarificationEvent }
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
  tone: "abstention" | "error" | "social";
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
  /**
   * The listing doors' activation gauge (lesson 6: a deterministic front
   * door that never engages is a silent usefulness ceiling — and one that
   * stands down too often is a silently mistuned bareness dial). One tally
   * per outcome, so the stand-down rate is computable from the record:
   * `consulted` counts every time a listing door was reached (cue matched,
   * or a listing nomination arrived); `served` the deterministic answers it
   * gave; `stoodDown` the consultations the mint refused (not bare, a
   * qualified set, no prior roster); `guardDropped` the model-composed
   * catalogue claims the wrong-set guard removed. Findings read these when
   * a bareness word is next proposed: the dial gets tuned on data.
   */
  listingActivations: { consulted: number; served: number; stoodDown: number; guardDropped: number };
  /**
   * The listing door as an offer (docs/offered-door.md): `withheld` counts
   * the first calls the door was left out of the grammar on, because the
   * executor's ask-only checks would refuse it; `nominated` the whole-reply
   * listing nominations that arrived, served or refused. Offered over
   * nominated over served is the door's funnel, per run.
   */
  listingDoor: { withheld: number; nominated: number };
  /** The lesson door per exchange (docs/lesson-door.md): how many answer
   * calls had the catalogue narrowed, how many lessons the last narrowed
   * call offered (the boundary lesson included), and how many it withheld. */
  lessonDoor: {
    narrowed: number;
    offered: number;
    withheld: number;
    /** The exchange's offer, so every retry call carries the same set. */
    ids?: readonly string[];
    /** The classifier's reading on this exchange, when it was asked. */
    classified?: { kind: LessonAskKind; lessonId?: string; entity?: string; foothold?: readonly string[] } | "unusable";
  };
  /** Answer-step calls repeated once with the route door closed, because
   * the model's whole reply was a nomination the driver refused — the
   * schema-steering misuse rate, as a number (see {@link withRouteFallback}). */
  nominationRetries: number;
  /** Matchup directions corrected at the groom step (porch round five) — a
   * type-subject matchup whose decoded direction contradicts the ask's own
   * word order is flipped, deterministically, and counted here for the same
   * reason repairs and folds are: a corrected resolution is never blended
   * with a first-shape one. */
  flips: number;
  /** Verifier-in-the-loop retries taken (R3b) — one at most per answer. */
  feedbackRetries: number;
  /** The denial codes of every first attempt that earned a feedback retry,
   * in order — the first attempt stays on the books whatever the second
   * files, so the enforcement number keeps measuring first attempts. */
  feedbackDenials: readonly string[];
  /**
   * Schema linking's gauge (R3b): `mapped` counts replies that carried a
   * non-empty `asked`; `unlinked` those that carried none (a model that
   * links nothing is measurably not doing the work); `offTargetDropped` the
   * field-bearing claims dropped for being about a field the model did not
   * link; `contradictions` the alias cross-checks that turned into a
   * question. Findings read these the way they read the listing gauge.
   */
  linking: {
    mapped: number;
    unlinked: number;
    offTargetDropped: number;
    /** Alias contradictions the trainer was asked about (or told about, with the door shut). */
    contradictions: number;
    staleDropped: number;
    /** Alias contradictions answered by union — the reply covered the other
     * reading too, so nothing was asked (found live 2026-09-11; the levers
     * that keep the question rare, in docs/findings.md). */
    unions: number;
  };
  /**
   * Clarification's gauge (R3b step 3): `asked` counts the advisor's own
   * questions recorded (model-nominated and contradiction-born alike);
   * `picked` the replies that matched exactly one option; `ignored` the
   * replies that matched none and were asked again; `capped` the asks that
   * hit {@link MAX_CLARIFICATIONS} and fell to the honest pass; `phrased`
   * the pack questions the model reworded, `unphrased` the ones it could not
   * (the pack's line was asked). Findings read these the way they read the
   * linking gauge.
   */
  clarification: { asked: number; picked: number; ignored: number; capped: number; phrased: number; unphrased: number };
  /**
   * The suggestion register's gauge (R3b step 4): `offered` counts every
   * follow-up the model wrote, `kept` the ones that passed the
   * topic-not-value rule into a draft, `dropped` the ones it refused, and
   * `taken` the trainer utterances that were one of the previous answer's
   * suggestions, said back — the number that says whether a next step
   * offered is a next step taken.
   */
  suggestions: { offered: number; kept: number; dropped: number; taken: number; deadEnded: number };
  /**
   * The precedent door's gauge (docs/precedent.md): `held` counts the
   * exchanges whose calls held precedents, `empty` those where the door was
   * open and nothing scored above the threshold — lesson 6's silent
   * ceiling, as a number — `followed` the accepted answers that took a held
   * example's shape and `departed` those that took none. `lastHeld` is the
   * last exchange's held ids, for a harness to record per run.
   */
  memory: { held: number; empty: number; followed: number; departed: number; lastHeld: readonly string[] };
  /** The precedents the open exchange's calls hold, when the door is on and
   * engaged; cleared with the exchange, like `required`. */
  heldPrecedents?: readonly HeldPrecedent[];
  /** Ladder proposals spent on the current ask; a fresh utterance resets it. */
  ladderTurns: number;
  /**
   * The driver's ledger (ledger.ts, issue #158): every deterministic step of
   * the open exchange in fixed wording, and the closed exchanges' ledgers
   * in order. Beside the kernel's records, never inside them.
   */
  steps: readonly DriverStep[];
  exchanges: readonly ExchangeLedger[];
  /**
   * The option the trainer picked on the current exchange's clarification,
   * when they picked one. Applied at linking: a field pick holds every claim
   * to that field (or, for none, teaches the records' boundary); a subject
   * pick drops claims about any other certified subject. Cleared with the
   * exchange, like `required`.
   */
  bound?: ClarificationOption;
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

/** Question furniture: tokens the stale-interpretation guard never counts as
 * overlap, because they appear in nearly every ask ("what", "does", "tell")
 * and so prove nothing about *which* ask an interpretation is reading. Only
 * words of asking, auxiliaries and connective tissue belong here — never a
 * domain word: a false negative costs one deterministic question, a false
 * positive lets a card cite the wrong exchange. */
const INTERPRETATION_FURNITURE = new Set([
  "what", "whats", "which", "who", "whom", "whose", "how", "hows", "when", "where", "why",
  "does", "did", "done", "doing", "are", "was", "were", "been", "being", "have", "has", "had",
  "can", "could", "will", "would", "shall", "should", "may", "might", "must",
  "the", "and", "but", "for", "with", "without", "about", "into", "onto", "from",
  "that", "this", "these", "those", "there", "here",
  "you", "your", "yours", "they", "them", "their", "she", "her", "him", "his", "its",
  "tell", "say", "know", "mean", "please", "just", "want", "like",
]);

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
    flips: 0,
    feedbackRetries: 0,
    feedbackDenials: [],
    linking: { mapped: 0, unlinked: 0, offTargetDropped: 0, contradictions: 0, staleDropped: 0, unions: 0 },
    clarification: { asked: 0, picked: 0, ignored: 0, capped: 0, phrased: 0, unphrased: 0 },
    suggestions: { offered: 0, kept: 0, dropped: 0, taken: 0, deadEnded: 0 },
    memory: { held: 0, empty: 0, followed: 0, departed: 0, lastHeld: [] },
    listingActivations: { consulted: 0, served: 0, stoodDown: 0, guardDropped: 0 },
    listingDoor: { withheld: 0, nominated: 0 },
    lessonDoor: { narrowed: 0, offered: 0, withheld: 0 },
    nominationRetries: 0,
    ladderTurns: 0,
    steps: [],
    exchanges: [],
  };
}

function note(state: SessionState, deps: StepSink, at: string, text: string, tone: SessionNote["tone"], detail?: string): SessionState {
  // Every note is a step: the detail register is already the fixed wording.
  const noted = ledgerStep(state, deps, at, "driver", `note/${tone}`, detail ?? text);
  return { ...noted, notes: [...state.notes, { at, text, tone, ...(detail === undefined ? {} : { detail }) }] };
}

/** The open exchange's opening words — the trainer's first utterance since
 * the exchange began — for closing its ledger. */
function openingOf(state: SessionState): string {
  const first = state.transcript.slice(state.askStart).find((event) => event.kind === "utterance" && event.source === "trainer");
  return first?.kind === "utterance" ? first.text : "";
}

/** The ledger's one line for a carried-back round the provider dropped. */
const RETRY_FAILED = "the provider failed on the carried-back round — the first reply stands";

/** "N reason(s) were fed back to the model" — the retry step's suffix, so a
 * reader sees the difference from a door withdrawn in silence. */
function fedBack(count: number): string {
  return `${count} reason${count === 1 ? "" : "s"} ${count === 1 ? "was" : "were"} fed back to the model`;
}

/** One line on what a reply carried, for the ledger's model lane. */
function describeReply(step: AnswerStep): string {
  if (!step.decode.ok) return `no usable reply: ${step.decode.reason}`;
  const { draft, asked, route, clarify: asks, suggestions } = step.decode;
  const parts = [`${draft.claims.length} claim(s)`, `${asked.length} link(s)`];
  if (draft.rosters.length > 0) parts.push(`${draft.rosters.length} roster(s)`);
  if (route !== undefined) parts.push(`nominated ${route.routeId}`);
  if (asks !== undefined) parts.push("asked a clarification");
  if ((suggestions?.length ?? 0) > 0) parts.push(`${suggestions?.length} suggestion(s)`);
  return parts.join(", ");
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
/**
 * A live card outranks the bare question for its own dimension. Falling from
 * a card to `ask()` erases the card and re-asks in poorer form — found live
 * (porch round twelve, 2026-09-01): a terse trainer's turns oscillated
 * card → question → new card for the same candidate, three turns and no
 * answer. If the pending card already proposes a value for the dimension
 * being asked, the honest move is to point back at it.
 */
async function askOrRestateCard(state: SessionState, deps: SessionDeps, dimension: ScopeDimension, question: string): Promise<SessionState> {
  // Undecided means undecided: during a /confirm or /reject the phase still
  // reads confirming-scope while drive re-runs, and a decided card — above
  // all a just-rejected one — must fall to the question, never be restated.
  const decided =
    state.phase.kind === "confirming-scope" &&
    state.transcript.some(
      (event) =>
        event.kind === "confirmation" &&
        "proposalId" in event &&
        event.proposalId === (state.phase as Extract<SessionPhase, { kind: "confirming-scope" }>).proposal.id,
    );
  if (state.phase.kind === "confirming-scope" && !decided && state.phase.proposal.candidate[dimension] !== undefined) {
    return note(
      state,
      deps,
      deps.now(),
      "That card above is still waiting — /confirm it if it reads right, or /reject it and answer in your own words.",
      "social",
      "card outranks its own dimension's question — card restated",
    );
  }
  return askPhrased(state, deps, dimension, question);
}

/**
 * The pack's question, in the model's words when the door is open (R3b step
 * 3: "the version question stops sounding like a form"). The wording is all
 * the model supplies: the dimension the recorded question arms, the options
 * the trainer is offered and the terms a reply binds against are the pack's,
 * so the answer route reads a reply to the rewrite exactly as it reads one to
 * the fixed line. A question already armed for this dimension is not
 * rephrased — the trainer was asked once, and `ask` reads a repeat by its
 * text. Anything unusable, and any provider failure, asks the pack's line;
 * both outcomes are counted.
 */
async function askPhrased(state: SessionState, deps: SessionDeps, dimension: ScopeDimension, question: string): Promise<SessionState> {
  if (deps.clarify !== true) return ask(deps.world, state, deps, deps.now(), dimension, question);
  if (state.phase.kind === "asking" && state.phase.dimension === dimension) {
    return ask(deps.world, state, deps, deps.now(), dimension, state.phase.question);
  }
  const gauge = { ...state.clarification };
  try {
    const phrased = await phraseQuestion({
      provider: deps.provider,
      scenarioId: "session",
      transcript: state.transcript.slice(state.askStart),
      need: question,
      options: scopeOptions(deps.world.pack, dimension),
    });
    const spent = { ...state, usage: addUsage(state.usage, phrased.usage) };
    if (phrased.text !== null) {
      gauge.phrased += 1;
      return ask(deps.world, { ...spent, clarification: gauge }, deps, deps.now(), dimension, phrased.text);
    }
    gauge.unphrased += 1;
    return ask(deps.world, { ...spent, clarification: gauge }, deps, deps.now(), dimension, question);
  } catch {
    // The question is still free: a failed rewrite asks the pack's line, and
    // the failure is counted where every provider failure is.
    gauge.unphrased += 1;
    return ask(deps.world, { ...state, providerErrors: state.providerErrors + 1, clarification: gauge }, deps, deps.now(), dimension, question);
  }
}

function ask(world: SessionWorld, state: SessionState, deps: StepSink, at: string, dimension: ScopeDimension, question: string): SessionState {
  const repeat = state.phase.kind === "asking" && state.phase.question === question;
  // A repeat records no second question event — but when the trainer just
  // spoke and their words answered nothing, silence reads as a swallowed
  // turn (found live, porch round nine, 2026-09-01: a drifted ask earned
  // zero visible response). The restatement is a note, not a question: the
  // armed question is unchanged and the trainer was asked once.
  const last = state.transcript[state.transcript.length - 1];
  const reminded =
    repeat && last !== undefined && last.kind === "utterance" && last.source === "trainer"
      ? note(
          state,
          deps,
          at,
          `I still need that one answered first: ${question}`,
          "social",
          "unanswering reply while a question was armed — question restated",
        )
      : state;
  const asked = repeat ? reminded : ledgerStep(reminded, deps, at, "driver", "scope/asked", `the pack's question about ${dimension} was armed`);
  return {
    ...asked,
    phase: { kind: "asking", dimension, question, options: scopeOptions(world.pack, dimension) },
    transcript: repeat
      ? asked.transcript
      : [...asked.transcript, { kind: "question", at, source: "advisor", dimension, text: question }],
  };
}

/** File a settled exchange and open the next one, with the default demands.
 * The filing step is stamped by the driver's clock, as every step is — not
 * with the record's own `committedAt`, which the kernel drew before the
 * steps logged after the verdict (the memory reading) and so fell behind
 * them, a backwards clock the trail reads as no working time at all
 * (dogfood, 2026-09-20: no "took" line under an answer the precedent door
 * had read). The record keeps its commit moment; the ledger keeps its order. */
function file(state: SessionState, deps: StepSink & Pick<SessionDeps, "now">, record: Transaction, page?: DomElement): SessionState {
  const filed = ledgerStep(
    state,
    deps,
    deps.now(),
    "kernel",
    `record/${record.outcome.status}`,
    record.outcome.status === "denied"
      ? `denied: ${record.outcome.violations.map(denialCode).join(", ")}`
      : `${record.outcome.status}: ${record.manifest?.claims.length ?? 0} claim(s) certified`,
  );
  const { pending: _pending, required: _required, bound: _bound, ...rest } = closeLedger(filed, openingOf(state), record.outcome.status, record.id);
  return {
    ...rest,
    records: [...state.records, record],
    pages: page === undefined ? state.pages : { ...state.pages, [record.id]: page },
    phase: { kind: "gathering" },
    askStart: state.transcript.length,
    ladderTurns: 0,
  };
}

/** Close the exchange without filing a record: the terminal note's state
 * discipline mirrors {@link file}'s — pending and required dropped, ladder
 * budget reset — because the next ask must open fresh. Found live (porch
 * round twelve, 2026-09-01): a leaked narrowed `required` let the next ask
 * skip discovery and inherit the previous ask's scope demands. */
function closeExchange(state: SessionState): SessionState {
  const { pending: _pending, required: _required, bound: _bound, heldPrecedents: _held, ...rest } = state;
  return { ...rest, phase: { kind: "gathering" }, askStart: state.transcript.length, ladderTurns: 0 };
}

/** The visitor spoke. Their words join the record on the trainer's channel —
 * the transport (this driver) is what assigns it — and the exchange advances. */
export async function say(state: SessionState, text: string, deps: SessionDeps): Promise<SessionState> {
  const utterance: ScopeEvent = { kind: "utterance", at: deps.now(), source: "trainer", text };
  // A suggestion said back (R3b step 4) — by click or by typing it — is
  // counted as taken before anything reads it; it is then the trainer's own
  // ask like any other, and nothing downstream treats it differently.
  const offered = state.records[state.records.length - 1]?.manifest?.suggestions ?? [];
  const taken = offered.some((suggestion) => suggestion.trim().toLowerCase() === text.trim().toLowerCase());
  // A fresh ask closes the previous exchange's ledger (an exchange that
  // filed a record closed its own); the words are the first step of the new.
  const opened = state.phase.kind === "gathering" ? closeLedger(state, openingOf(state), "passed") : state;
  const next = ledgerStep(
    {
      ...opened,
      transcript: [...state.transcript, utterance],
      ladderTurns: 0,
      ...(taken ? { suggestions: { ...state.suggestions, taken: state.suggestions.taken + 1 } } : {}),
    },
    deps,
    utterance.at,
    "trainer",
    taken ? "trainer/took-suggestion" : "trainer/said",
    text,
  );
  // Social closes and the confidence question get their own words, before any
  // machinery runs (porch round five, 2026-09-01: "thanks!" and "are you
  // sure?" each re-ran the ladder and drew a stale card). Recorded like every
  // utterance — the transcript stays whole — but no model, no record, no
  // question: a pleasantry is not an ask. Never while an act awaits consent:
  // words beside a pending act are the act flow's business.
  if (state.phase.kind !== "confirming-act") {
    const social = socialReply(text);
    if (social !== undefined) {
      const open = state.phase.kind === "asking" || state.phase.kind === "clarifying" || state.phase.kind === "confirming-scope";
      // A pleasantry that answers nothing open is spent: the ask pointer
      // moves past it, so the next ask opens its own exchange under its
      // own words. Left in place, the ledger titled the exchange after a
      // greeting with the greeting (dogfood, 2026-09-20: "tell me about the
      // game" filed under "3hey"). While a question is open, the
      // pleasantry keeps it armed and the exchange keeps its ask.
      const settled = open ? { ...next, phase: state.phase } : { ...next, phase: { kind: "gathering" as const }, askStart: next.transcript.length };
      return note(settled, deps, deps.now(), social, "social");
    }
  }
  const driven = await drive(next, deps);
  // A suggestion the advisor offered and then could not answer is the worst
  // next step there is (found live, 2026-09-06: "what are Pokémon?" was the
  // model's own suggestion and dead-ended in a redirect). Counted: taken,
  // exchange closed, no record and nothing left open for the trainer.
  const deadEnded = taken && driven.records.length === state.records.length && driven.phase.kind === "gathering";
  return deadEnded ? { ...driven, suggestions: { ...driven.suggestions, deadEnded: driven.suggestions.deadEnded + 1 } } : driven;
}

/**
 * The reply a pure pleasantry or the confidence question earns — driver copy
 * in the notes register, never a record (nothing was asked that the records
 * answer). The gate is deliberately narrow: the whole utterance must be the
 * pleasantry, so "thanks, and what about Onix?" still drives the machinery.
 */
function socialReply(text: string): string | undefined {
  // Stray characters at either edge are not words: "3hey" (a key beside
  // the h, dogfood 2026-09-20) cost a model call and earned the boundary
  // redirect where "hey" earns a hello for free. Leniency here mints no
  // value — a social note has no authority and files no record — so the
  // context discipline the aliases need (lesson 1) does not apply; the
  // whole-utterance rule below still does.
  const bare = text
    .trim()
    .toLowerCase()
    .replace(/^[^a-z]+/, "")
    .replace(/[^a-z]+$/, "");
  if (/^(hi|hello|hey|yo|sup|howdy|good (morning|afternoon|evening)|yo whats up|whats up|hey there|hi there)[!?,. ]*$/.test(bare)) {
    return (
      "Hey! I'm the League's Advisor — ask me about any Pok\u00e9mon, a matchup, or how the game works, " +
      "and everything I answer is checked against the official records first."
    );
  }
  if (/^(thanks|thank you|thankyou|ty|thx|cool|nice|great|awesome|ok|okay|got it|perfect)[!. ]*$/.test(bare)) {
    return "You're welcome! Ask away whenever you're ready — a Pokémon, a matchup, or how the game works.";
  }
  if (/^(what data (do|are) you (use|using)|whats? your (data|source)s?|where (do|does) (your|the) (data|answers?|information) come from|how do you know( that| this)?)[?!. ]*$/.test(bare)) {
    return (
      "Everything comes from one certified snapshot of the official Pok\u00e9dex records (built from PokeAPI data, " +
      "used under its license), pinned and checked at load. Every answer is derived from that snapshot at the " +
      "moment of answering and verified before it reaches you — the provenance line under each answer names the " +
      "exact snapshot."
    );
  }
  if (/^(are you sure|you sure|really|is that right|for real)[?!. ]*$/.test(bare)) {
    return (
      "As sure as the records: every value on that page was read from the certified snapshot at the moment of " +
      "answering — nothing was recalled from memory, and the League refuses any answer it cannot verify. " +
      "The \u201cShow the machinery\u201d view has the full ruling."
    );
  }
  // The trust question, in any of its porch forms \u2014 "are you an AI?", "will
  // you make stuff up?" \u2014 deserves the honest architecture answer, not a
  // routed lesson about something else (found live, porch round twelve: it
  // drew the what-is-game lesson \u2014 a deflection to the wrong subject for the
  // one question this design exists to answer). Same whole-utterance
  // discipline as every social cue, allowing the natural compound ("are you
  // an AI? will you make stuff up?").
  if (new RegExp(`^${TRUST_CLAUSE}(?:[?!., ]+${TRUST_CLAUSE})*[?!,. ]*$`).test(bare)) {
    return (
      "I am an AI \u2014 with a rule that keeps me honest: I can only say what the League's certified records " +
      "verify. A model drafts each answer, and a deterministic checker proves every claim against the " +
      "certified snapshot before you see it; anything it cannot prove is refused by name rather than guessed. " +
      "So making things up isn't a failure I'm permitted \u2014 the \u201cShow the machinery\u201d view shows each ruling."
    );
  }
  return undefined;
}

/** One trust-question form, for the whole-utterance social gate above. */
const TRUST_CLAUSE =
  "(?:(?:are|r) you (?:an? )?(?:ai|bot|robot|llm|real(?: person)?)" +
  "|(?:will|would) you (?:make (?:stuff|things|it) up|lie(?: to me)?|hallucinate)" +
  "|do you (?:make (?:stuff|things) up|hallucinate|lie|ever lie)" +
  "|can i trust (?:you|this|that|your answers?)" +
  "|how do i know you(?:'re|r| are)? not (?:lying|making (?:stuff|things|it) up))";

/**
 * The trainer set their profile (epic #145, R2): typed scope from a form,
 * recorded on the trainer's channel as a `profile` event — evidence like any
 * utterance, replayable like any evidence, binding on the kernel's `profile`
 * route with no context word and no card. Only the transport assigns the
 * channel; the page's panel is the trainer's hand, so it records as trainer.
 *
 * When an exchange is open (a question armed, a card pending), the profile
 * is the answer and the exchange drives on; otherwise the setting is
 * acknowledged in the trainer's terms and nothing is asked. Values are
 * passed through as typed — an unapproved one is the kernel's to refuse by
 * name (IA-1/value-not-approved), never this function's to filter.
 */
export async function setProfile(state: SessionState, scope: ScopeCandidate, deps: SessionDeps): Promise<SessionState> {
  const event: ScopeEvent = { kind: "profile", at: deps.now(), source: "trainer", scope };
  const next = ledgerStep({ ...state, transcript: [...state.transcript, event] }, deps, event.at, "trainer", "trainer/profile", `profile set: ${Object.entries(scope).map(([key, value]) => `${key}=${String(value)}`).join(", ")}`);
  if (state.phase.kind === "asking" || state.phase.kind === "confirming-scope") return drive(next, deps);
  // A profile set while the advisor's own question waits is scope, not the
  // pick: acknowledged, and the question stays armed.
  return acknowledgeScope(deps.world, next, deps, state.phase.kind === "clarifying");
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
  const decided = ledgerStep(state, deps, confirmation.at, "trainer", `trainer/card-${decision}ed`, `the interpretation card was ${decision}ed`);
  return drive({ ...decided, transcript: [...state.transcript, confirmation] }, deps);
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
  // Spelled out, not templated: the registry caught `consent-declineed`
  // (review of #174) — a code the suffix reading had accepted in silence.
  state = ledgerStep(state, deps, moment, "trainer", decision === "confirm" ? "trainer/consent-confirmed" : "trainer/consent-declined", decision === "confirm" ? "consent given on the attested page" : "consent declined");
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
  return file(state, deps, record, pending.artifact);
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
   * stale draft must not answer them. `routed` marks a draft a nominated
   * route's executor composed (a profile, a listing): its ask was about an entity, not
   * scope, so there is no vague wording for the ladder to interpret — the
   * pack's own question outranks the model (hard-won lesson 1; observed
   * live 2026-08-30: the ladder read "tell me about Pikachu" and proposed
   * version=yellow from nothing, and the confirmed card died at the gate as
   * IA-2/scope-version-mismatch). */
  reuse?: Pick<ManifestDraft, "claims" | "rosters" | "suggestions"> & { routed?: boolean },
): Promise<SessionState> {
  const { world, provider } = deps;

  const lastSaid = [...state.transcript]
    .reverse()
    .find((event): event is Extract<ScopeEvent, { kind: "utterance" }> => event.kind === "utterance" && event.source === "trainer");
  const justSaid = lastSaid !== undefined && lastSaid === state.transcript[state.transcript.length - 1];

  // The advisor's own question is waiting (R3b step 3). The trainer's words
  // are read against its typed options first — before scope, before any
  // door — because a pick binds the exchange: one matching option is the
  // pick, bound for the linking step and the exchange drives on with it; a
  // fresh ask naming a subject is drift and falls to the drift door below; a
  // reply matching nothing is asked again once, then the honest pass. The
  // counts make the dial readable: picked, ignored, capped.
  if (state.phase.kind === "clarifying" && justSaid && lastSaid !== undefined) {
    const clarification = state.phase.clarification;
    const pick = matchPick(world.pack, world.registry, clarification.options, lastSaid.text);
    if (pick !== undefined) {
      state = ledgerStep(
        {
          ...state,
          bound: pick,
          phase: { kind: "gathering" },
          clarification: { ...state.clarification, picked: state.clarification.picked + 1 },
        },
        deps,
        lastSaid.at,
        "trainer",
        "clarify/picked",
        `the reply picked "${pick.label}" (${pick.kind === "field" ? (pick.fieldId ?? "no field") : pick.entityId}) — bound for this exchange`,
      );
    } else if (looksLikeFreshAsk(world.registry, lastSaid.text)) {
      // Drift over the advisor's own question — reopened here, before scope
      // is read, because a granted scope would otherwise carry the new ask
      // straight to the answer step with the old exchange still open.
      return reopenAtFreshAsk(state, deps);
    } else {
      return unansweredClarification(state, deps, clarification);
    }
  }

  const scopeContext: ScopeContext = {
    pack: world.pack,
    at: deps.now(),
    ...(state.required === undefined ? {} : { required: state.required }),
  };
  const outcome = resolveScope(scopeContext, state.transcript);

  if (outcome.status === "refused") {
    // The record of the refusal is the seam's, reached through its own door.
    const at = deps.now();
    state = ledgerStep(state, deps, at, "kernel", "scope/refused", `scope refused: ${outcome.violations.map(denialCode).join(", ")}`);
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
    return file(state, deps, record);
  }

  if (outcome.status === "granted") {
    state = ledgerStep(
      state,
      deps,
      deps.now(),
      "kernel",
      "scope/granted",
      `scope granted: ${outcome.grant.bindings.map((binding) => `${binding.dimension}=${String(binding.value)}`).join(", ") || "from the defaults"}`,
    );
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
    // A statement of scope with no ask in it ("ok. I actually play Red",
    // or the "Red" that answers the re-asked question) has nothing for the
    // model to answer; sending it anyway earned the honest-pass abstention,
    // which reads as a refusal of a question never asked (found live,
    // 2026-09-04). It earns an acknowledgment and a closed exchange.
    if (reuse === undefined && scopeStatementOnly(world, state)) return acknowledgeScope(world, state, deps);
    return answer(state, deps, reuse);
  }

  // Clarify — and the pack's own question outranks the model. A question is
  // free, deterministic, and armed: the trainer's direct answer to it binds
  // without a proposal or a card. The ladder exists for wording the
  // vocabulary could not read at all, so it runs only when the trainer's
  // latest words actually contain some — anything else turned every missing
  // dimension into a model call and a confirmation, which is how one
  // catalogue question became an interrogation.

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
  // The switch-back signal outranks discovery: when the transcript's version
  // binds to a group these records do not certify and the trainer's latest
  // words carry a home-version token, the pack's question is the answer —
  // deterministic, before any model reads the ask (found live, 2026-09-01:
  // the check lived only behind the fully-granted branch, which a fresh ask
  // under the default required set never reaches, so the trapped trainer's
  // "let's go back to Red/blue" fell to the model and earned a redirect).
  if (lastSaid !== undefined && !askedAlready) {
    const versionOnly = resolveScope({ ...scopeContext, required: ["version"] }, state.transcript);
    if (
      versionOnly.status === "granted" &&
      versionOnly.grant.scope.version !== world.registry.document.scope.versionGroup
    ) {
      const question = versionMentioned(world, state, "home");
      // Narrowed to the one dimension being re-asked: the switch-back is not
      // a fresh intake, and the default required set would turn one question
      // into an interrogation (region next, badges after).
      if (question !== undefined) return ask(world, { ...state, required: ["version"] }, deps, deps.now(), "version", question);
    }
    // The correction: a direct statement contradicting a recorded answer
    // ("Yellow", then "ok. I actually play Red") is a fresh contradiction by
    // design (kernel/scope.ts), and the design says the trainer is asked
    // again — not that discovery reads the correction as an ask and the
    // model redirects it (found live, 2026-09-04: the trainer's correction
    // earned "I lost the thread of that one"). Same narrowed re-ask.
    if (versionOnly.status === "clarify" && versionOnly.derivation.contradicted.includes("version")) {
      const question = versionMentioned(world, state, "any");
      if (question !== undefined) return ask(world, { ...state, required: ["version"] }, deps, deps.now(), "version", question);
    }
    // A statement of scope with no ask in it, before discovery can hand it
    // to the model as if it were one: a foreign version teaches the
    // boundary; anything else is acknowledged, never interrogated for the
    // dimensions no ask has yet needed.
    if (scopeStatementOnly(world, state)) {
      if (
        versionOnly.status === "granted" &&
        versionOnly.grant.scope.version !== world.registry.document.scope.versionGroup
      ) {
        return foreignVersion(state, deps);
      }
      return acknowledgeScope(world, state, deps);
    }
  }
  // A fresh ask over an armed question is a topic change, not an answer.
  // Found live (porch round nine, 2026-09-01): with the comparison-basis
  // question armed, "does pikachu evolve?" answered no dimension, named a
  // certified entity so the ladder's inbox filtered its clause, and the
  // repeat re-ask recorded nothing — the trainer's new question vanished
  // without a word on screen. The cue is deliberately narrow (ask-shaped
  // AND entity-naming, both required): a bare species name could yet be a
  // direct answer to some pack's question, and an ask-shaped clarification
  // ("what do you mean?") names no entity — both fall through to the
  // restated question below, never to a silent turn. Never over a pending
  // act: consent cards are the act flow's business, not drift's. The phase
  // is the gate (blocked on the trainer — a question armed or a card
  // pending), not a question event: a ladder-first exchange arms a card
  // without ever asking (found live, porch round eleven). And the utterance
  // must be the transcript's last word — a /confirm or /reject appends its
  // confirmation event after the words, and a decision is never drift.
  if (
    lastSaid !== undefined &&
    justSaid &&
    (state.phase.kind === "asking" || state.phase.kind === "confirming-scope") &&
    looksLikeFreshAsk(world.registry, lastSaid.text)
  ) {
    return reopenAtFreshAsk(state, deps);
  }
  // The listing cue door that stood here — "what/which … pokemon/types",
  // a listing verb — was the first dispatch door R3b deleted (2026-09-05).
  // Its executor survives as the `listing` nomination, with the same
  // guards; the ask's shape is the model's to name. Found on the first
  // schema-linking run: the cue read "what beats water types?" as a listing
  // and served the water roster before any model saw the question.
  // Not during an escalation: a widened `required` means an answer was already
  // attempted and wants more scope, so the shape is known and a fresh discovery
  // would only re-ask the model what it just told us.
  if (lastSaid !== undefined && !askedAlready && state.required === undefined) {
    const attempt = await teachOrDiscover(state, deps);
    state = attempt.state;
    if (attempt.result === "taught" || attempt.result === "closed") return state;
    if (attempt.result === "off-domain")
      return redirect(state, deps, pointsBack(world, state, lastSaid.text));
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
        ? {
            claims: attempt.claims,
            rosters: attempt.rosters,
            ...(attempt.suggestions === undefined ? {} : { suggestions: attempt.suggestions }),
            ...(attempt.routed === true ? { routed: true } : {}),
          }
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
      : unmatchedClauses(world.pack, lastSaid.text).filter((clause) => !namesCertifiedSubject(world.registry, clause));
  const freshLongTail = scopeishClauses.length > 0;
  // A bound pick is the trainer's answer to the advisor's question, not
  // scope wording: "Speed" reaches the ladder's inbox as an unmatched clause
  // and a ladder handed it would propose scope out of it (lesson 1).
  if (reuse?.routed === true || state.bound !== undefined || !freshLongTail || state.ladderTurns >= MAX_LADDER_TURNS) {
    return askOrRestateCard(state, deps, outcome.asking, outcome.question);
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
      deps,
      deps.now(),
      "I couldn't reach the model just now, so let me simply ask:",
      "error",
      `the provider failed during scope resolution (${cause instanceof Error ? cause.message : String(cause)})`,
    );
    return askOrRestateCard(failed, deps, outcome.asking, outcome.question);
  }

  const spent = { ...state, usage: addUsage(state.usage, step.usage), ladderTurns: state.ladderTurns + 1 };
  // A proposal must interpret *this* exchange's words. Found live (porch
  // round five, 2026-09-01): "whats the rarest pokemon?" drew a card
  // interpreting the previous, settled ask ("how much HP does snorlax
  // have?"), and every social close after it re-drew the same stale card —
  // three misattributed cards in a row. The model labels what it interpreted;
  // the driver holds it to the label.
  const freshWords = state.transcript
    .slice(state.askStart)
    .flatMap((event) => (event.kind === "utterance" && event.source === "trainer" ? [event.text.toLowerCase()] : []))
    .join(" ");
  // Overlap by content token, not verbatim: an interpretation may compress
  // the wording, but one that shares not a single substantive word with this
  // exchange is reading some other exchange. Substantive means not a
  // function word — found live (porch round nine, 2026-09-01): a card
  // interpreting the settled "what game should i start with?" survived the
  // guard because "what" also appeared in this exchange's "what does it
  // evolve into?". A question word is question furniture, not content; an
  // interpretation with no content tokens at all is likewise held stale —
  // it interprets nothing this guard can check.
  const interpretingTokens =
    step.event === null
      ? []
      : step.event.interpreting
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter((token) => token.length >= 3 && !INTERPRETATION_FURNITURE.has(token));
  const staleInterpretation =
    step.event !== null && !interpretingTokens.some((token) => freshWords.includes(token));
  if (step.event === null || staleInterpretation) {
    // Nothing usable to propose (or a proposal about words already settled):
    // fall to the deterministic question rather than burning the remaining
    // budget on the same words.
    return askOrRestateCard(spent, deps, outcome.asking, outcome.question);
  }

  // The same card twice is not an answer to anything. Found live (porch
  // round eleven, 2026-09-01): words that neither answered nor drifted drew
  // the identical candidate again — a second card, a spent turn, and the
  // trainer's actual words unacknowledged. The pending card keeps its
  // identity (its id is what a confirmation names); the trainer gets the
  // card restated instead of duplicated.
  if (
    state.phase.kind === "confirming-scope" &&
    JSON.stringify(state.phase.proposal.candidate) === JSON.stringify(step.event.candidate)
  ) {
    return note(
      { ...spent, phase: state.phase },
      deps,
      deps.now(),
      "That one's still waiting on you — /confirm the card above if it reads right, or /reject it.",
      "social",
      "identical card re-proposed while one was pending — card restated",
    );
  }

  // Stamped now, not with the event: the event's moment was taken before the
  // model was called, and a ledger step dated before its own call would read
  // as if the call came after it (the trail places calls under the first
  // step recorded after they began).
  const carded = ledgerStep(spent, deps, deps.now(), "model", "scope/card", `the model proposed an interpretation card: ${Object.entries(step.event.candidate).map(([key, value]) => `${key}=${String(value)}`).join(", ")}`);
  return {
    ...carded,
    transcript: [...carded.transcript, step.event],
    phase: { kind: "confirming-scope", proposal: step.event },
  };
}

/** The drift door's move: set the open exchange aside with a word on screen
 * and drive on with the trainer's latest utterance as a fresh ask. */
function reopenAtFreshAsk(state: SessionState, deps: SessionDeps): Promise<SessionState> {
  const aside = note(
    state,
    deps,
    deps.now(),
    "New question — I've set the earlier one aside. Ask it again any time.",
    "social",
    "topic change while a question was armed — exchange reopened at the new ask",
  );
  const { pending: _pending, required: _required, bound: _bound, ...reopened } = aside;
  return drive({ ...reopened, phase: { kind: "gathering" }, askStart: aside.transcript.length - 1, ladderTurns: 0 }, deps);
}

function nextTransactionId(state: SessionState): string {
  return `${state.idPrefix ?? "session"}-${state.records.length + 1}`;
}

/**
 * One answer-step call, and — when the model's whole reply was a nomination
 * the driver refused — one more with the route door closed.
 *
 * Found by the R1 bank run (2026-09-04): under the provider-enforced schema,
 * the measured strong model answered "What types is Charizard?" with a
 * listing nomination for the catalogue, two of two, while without structured
 * decoding it wrote the fact claim four of four. The schema's route variant
 * steers a shape, the door refuses it, and a refused nomination with nothing
 * beside it read as off-domain — fifteen answerable questions redirected at
 * turn one. The doors are the driver's offer, not the model's obligation: an
 * offer the model misuses is withdrawn for one call, and the reply the model
 * would have written without it is the one that goes through. The retry is
 * counted (`nominationRetries`) so the misuse rate is a number.
 */
async function withRouteFallback(
  world: SessionWorld,
  state: SessionState,
  deps: SessionDeps,
  call: (routes: readonly NominableRoute[] | undefined, feedback?: readonly string[], lessons?: readonly string[]) => Promise<AnswerStep>,
): Promise<{ state: SessionState; step: AnswerStep; usage: Usage; retried: boolean; refusedListing: boolean }> {
  // The offered door (docs/offered-door.md): with the lever on, the listing
  // door is in the grammar only when the executor's ask-only checks would
  // accept it — recorded as a step, so the trail and the tally read it.
  // On unless shut (`offeredDoors: false`, the off arm): the door passed its
  // pre-registered gate (findings §25), and two nights of dogfood after it
  // still paid a wasted first call nominating the listing on "tell me about
  // the game" and on every "compare" ask (§27) because the live page and
  // the tracer never turned it on.
  const withheld = deps.offeredDoors !== false ? listingAskCheck(world, openingAskOf(state)) : undefined;
  if (withheld !== undefined) {
    state = ledgerStep(
      { ...state, listingDoor: { ...state.listingDoor, withheld: state.listingDoor.withheld + 1 } },
      deps,
      deps.now(),
      "driver",
      "route/withheld",
      `the "listing" door was not offered: ${withheld} — the driver would have refused a nomination of it, so the grammar left it out`,
    );
  }
  // The lesson door (docs/lesson-door.md): with the lever on, the
  // explanation route carries only the lessons the ask is about, plus the
  // records' boundary — recorded as a step whether or not anything was
  // withheld, so a pack that declares no coverage is visible on the trail
  // rather than a door that silently never closed.
  let offer: LessonOffer | undefined;
  let classified: SessionState["lessonDoor"]["classified"];
  if (deps.lessonDoor === true) {
    const decision = await lessonDoorDecision(world, deps.provider, openingAskOf(state), { matcher: deps.lessonMatcher, classifier: deps.lessonClassifier === true });
    offer = decision.offer;
    classified = decision.classified;
    state = { ...state, usage: addUsage(state.usage, decision.usage), providerErrors: state.providerErrors + (decision.providerError ? 1 : 0) };
    if (decision.asked) {
      state = ledgerStep(state, deps, deps.now(), "model", "route/classified", describeClassification(classified));
    }
  }
  if (offer !== undefined) {
    state = ledgerStep(
      {
        ...state,
        lessonDoor: {
          narrowed: state.lessonDoor.narrowed + (offer.withheld.length > 0 ? 1 : 0),
          offered: offer.offered.length,
          withheld: offer.withheld.length,
          ids: offer.offered,
          ...(classified === undefined ? {} : { classified }),
        },
      },
      deps,
      deps.now(),
      "driver",
      "route/narrowed",
      offer.withheld.length === 0
        ? `every lesson was offered: ${offer.reason}`
        : `${offer.offered.length} of ${world.pack.curriculum.length} lessons offered (${offer.offered.map((id) => `"${id}"`).join(", ")}): ${offer.reason} — the other ${offer.withheld.length} were left out of the grammar`,
    );
  }
  const lessons = offer?.offered;
  const first = await call(withheld === undefined ? SESSION_ROUTES : SESSION_ROUTES.filter((route) => route.id !== "listing"), undefined, lessons);
  const decode = first.decode;
  // A clarification beside the refused nomination is something the reply
  // carried (R3b step 3): the model asked, and the question goes through —
  // found live 2026-09-05, when the listing nomination beside a clarify cost
  // a second call for the same question.
  const asksInstead = decode.ok && decode.clarify !== undefined && deps.clarify === true;
  const nomination = decode.ok && decode.route !== undefined && decode.draft.claims.length === 0 && !asksInstead ? decode.route : undefined;
  if (nomination?.routeId === "listing") state = { ...state, listingDoor: { ...state.listingDoor, nominated: state.listingDoor.nominated + 1 } };
  const executed = nomination === undefined ? undefined : executeRoute(world, state, nomination);
  if (nomination === undefined || executed === undefined || executed.ok) {
    return { state, step: first, usage: first.usage, retried: false, refusedListing: false };
  }
  // The nomination and its refusal are steps of their own, stamped between
  // the two calls: a trail reads "the model nominated, the driver refused,
  // the model was asked again" as three moves on three lanes, and the dev
  // view's first call lands under the nomination, the second under the
  // answer — not both under one step with a suffix.
  // Wording for a reader who does not know the code: a "door" is an offer
  // in the prompt to have the driver compose from the records instead of
  // the model writing claims; the model asked for one, the driver's check
  // on it failed, so the offer was removed for one call. Nothing about the
  // refusal is fed back — the reply the model would have written without
  // the offer is the one that goes through (measured: the R1 bank run).
  let stepped = ledgerStep(
    state,
    deps,
    deps.now(),
    "model",
    "model/nominated",
    `${describeReply(first)} — instead of answering, the model asked to use the "${nomination.routeId}" door`,
    undefined,
    explainNomination(nomination),
  );
  // Two policies, one measured against the other (docs/answer-prompt.md,
  // M3): withdrawn in silence, or the refusal carried back by name — one
  // line in the driver's fixed wording, the same code the emptied-reply
  // round uses for a refused route, so the record reads alike either way.
  const fedBack = deps.refusalFeedback === true;
  const reason = `driver/refused-route: the "${nomination.routeId}" door was refused — ${executed.reason}`;
  stepped = fedBack
    ? ledgerStep(
        stepped,
        deps,
        deps.now(),
        "driver",
        "route/refused-back",
        `the "${nomination.routeId}" door was refused: ${executed.reason} — the door was withdrawn for one call and the refusal was fed back to the model by name`,
        undefined,
        [reason],
      )
    : ledgerStep(
        stepped,
        deps,
        deps.now(),
        "driver",
        "route/withdrawn",
        `the "${nomination.routeId}" door was refused: ${executed.reason} — the door was withdrawn for one call and the model asked again; nothing about the refusal was sent to it`,
      );
  const again = await call(undefined, fedBack ? [reason, "Answer the question directly — as claims about what was asked, a lesson that squarely answers it, or no claims at all."] : undefined, lessons);
  return { state: stepped, step: again, usage: addUsage(first.usage, again.usage), retried: true, refusedListing: nomination.routeId === "listing" };
}

/** The model lane's suffix on a reply that followed a refused nomination:
 * which of the two policies the round ran under, in plain words. */
function afterNomination(deps: SessionDeps): string {
  return deps.refusalFeedback === true ? " — the reply with the door withdrawn and the refusal fed back" : " — the reply with the door withdrawn; nothing was fed back";
}

/**
 * The precedent door, consulted once per exchange before its first answer
 * call (docs/precedent.md). Deterministic: the store, the ask and the
 * levers fix what is held, so a run replays. Three steps it can write, in
 * fixed wording — held, empty (the door open and nothing near enough: the
 * activation ceiling, as a line), held-out (a harness's own precedents
 * withheld) — and the held precedents ride on the state for every call of
 * the exchange, retries included, so the prompt is otherwise identical
 * between a first call and a carried-back one.
 */
function consultMemory(state: SessionState, deps: SessionDeps, ask: string): SessionState {
  const memory = deps.precedents;
  if (memory === undefined) return state;
  const snapshotId = deps.world.registry.snapshot.id;
  const levers = memory.levers ?? DEFAULT_PRECEDENT_LEVERS;
  if (memory.fixed !== undefined) {
    const held = fixedPrecedents(memory.store, memory.fixed, snapshotId);
    return held.length === 0
      ? memoryEmpty(state, deps, "the fixed examples named none this world holds — nothing was shown", [])
      : memoryHeld(state, deps, held, `${held.length} fixed example(s) were shown — the same on every call, whatever the ask; none carried a value`, held.map((one) => `"${one.ask}"`));
  }
  // The row retriever's own selection breaks ties: a precedent about the
  // subject the ask names ranks first among equals.
  const selection = retrievalSelection(deps.world.registry, ask);
  const found = retrievePrecedents(memory.store, ask, {
    snapshotId,
    levers,
    ...(memory.holdOut === undefined ? {} : { holdOut: memory.holdOut }),
    entities: new Set([...selection.species, ...selection.moves, ...selection.items]),
  });
  let next = state;
  if (found.withheld.length > 0) {
    next = ledgerStep(
      next,
      deps,
      deps.now(),
      "driver",
      "memory/held-out",
      `${found.withheld.length} precedent(s) were withheld: ${found.withheld[0]!.reason}`,
      found.withheld.length,
      found.withheld.map((one) => `${one.id} — ${one.reason}`),
    );
  }
  if (found.held.length === 0) {
    const miss = found.nearestMiss;
    return miss === undefined
      ? memoryEmpty(next, deps, "no earlier ask shared a word with this one — nothing was shown", [])
      : memoryEmpty(next, deps, `no earlier ask was near enough to show (best overlap ${miss.score}, threshold ${levers.threshold})`, [`nearest: "${miss.ask}" — overlap ${miss.score}`]);
  }
  return memoryHeld(
    next,
    deps,
    found.held,
    `${found.held.length} earlier answered ask(s) were shown as examples of which door to take; none carried a value`,
    found.held.map((one) => `"${one.ask}" — overlap ${one.score}`),
  );
}

function memoryHeld(state: SessionState, deps: SessionDeps, held: readonly HeldPrecedent[], text: string, lines: readonly string[]): SessionState {
  const stepped = ledgerStep(state, deps, deps.now(), "driver", "memory/held", text, held.length, lines);
  return { ...stepped, memory: { ...state.memory, held: state.memory.held + 1, lastHeld: held.map((one) => one.id) }, heldPrecedents: held };
}

function memoryEmpty(state: SessionState, deps: SessionDeps, text: string, lines: readonly string[]): SessionState {
  const stepped = ledgerStep(state, deps, deps.now(), "driver", "memory/empty", text, undefined, lines);
  return { ...stepped, memory: { ...state.memory, empty: state.memory.empty + 1, lastHeld: [] }, heldPrecedents: [] };
}

/** The precedents an answer call holds — the open exchange's, on every call.
 * An empty list is passed as such: the door was open and engaged nothing,
 * and the call declares that (docs/precedent.md, the empty state), where a
 * shut door declares nothing. */
function precedentArg(state: SessionState): { precedents?: readonly HeldPrecedent[] } {
  return state.heldPrecedents === undefined ? {} : { precedents: state.heldPrecedents };
}

/**
 * The reading after the verdict (docs/precedent.md): whether the accepted
 * draft took a held example's shape — deterministic, by canonical shape,
 * with roster names and claim order ignored. The memory's effect, visible
 * per exchange; summed over a run, the number the fixed and nearest arms
 * are read by. Written only for a draft the kernel accepted.
 */
function readMemory(state: SessionState, deps: SessionDeps, draft: ManifestDraft): SessionState {
  const held = state.heldPrecedents;
  if (held === undefined || held.length === 0) return state;
  const match = followed(draft, held);
  if (match === undefined) {
    const stepped = ledgerStep(state, deps, deps.now(), "driver", "memory/departed", "the accepted answer took a shape none of the examples showed");
    return { ...stepped, memory: { ...state.memory, departed: state.memory.departed + 1 } };
  }
  const stepped = ledgerStep(state, deps, deps.now(), "driver", "memory/followed", `the accepted answer took the same shape as the example for "${match.ask}"`, undefined, [match.id]);
  return { ...stepped, memory: { ...state.memory, followed: state.memory.followed + 1 } };
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

/** Whether an off-domain reply to this ask should ask for the antecedent
 * by name: the ask names nothing, and there was an earlier ask for "it" to
 * point back at — a profile set first is not one. */
function pointsBack(world: SessionWorld, state: SessionState, ask: string): boolean {
  const earlier = state.transcript.slice(0, state.askStart).some((event) => event.kind === "utterance" && event.source === "trainer");
  // An ask points back only if it carries a word that does — "it", "this
  // one", "them". Found live (dogfood, 2026-09-06): "what are Pokémon?"
  // names no certified subject and so read as anaphoric, and the trainer
  // was told "I lost the thread" of a question with no thread in it.
  const tokens = ask.toLowerCase().split(/[^a-z0-9']+/);
  return earlier && isAnaphoric(world, ask) && tokens.some((token) => ANAPHORS.has(token));
}

/** Words that point back at something said or shown — English function
 * words, never a domain word (the gate holds this file). */
const ANAPHORS: ReadonlySet<string> = new Set([
  "it", "its", "it's", "this", "that", "these", "those", "they", "them", "their", "theirs",
  "he", "she", "him", "her", "his", "hers", "one", "ones", "same", "former", "latter", "more",
]);

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
 * What the previous certified answer was about, for an anaphoric ask —
 * "tell me more about this species" right after a page that showed
 * Bulbasaur (found live, dogfood 2026-09-06: the model was shown the
 * trainer's earlier words and not the answer they were reading, invented
 * Pikachu, and every fact fell as off the ask). The antecedent of "this"
 * is as often the advisor's last answer as the trainer's last sentence.
 * Read from the filed record — the certified subjects, never the model's
 * unverified reply — and offered as context, labelled as the answer's,
 * never as the trainer's words (IA-8). Species, moves and items only: a
 * type on a matchup page is a value, not a subject.
 */
function previousSubjects(world: SessionWorld, state: SessionState, ask: string): readonly string[] | undefined {
  if (!isAnaphoric(world, ask)) return undefined;
  const last = [...state.records].reverse().find((record) => record.manifest !== undefined);
  if (last?.manifest === undefined) return undefined;
  const ids = last.manifest.claims.flatMap((claim) => subjectsOfClaim(claim).map(canonicalId));
  const certified = [...new Set(ids)].filter(
    (id) => world.registry.speciesIds.includes(id) || world.registry.moveIds.includes(id) || world.registry.itemIds.includes(id),
  );
  return certified.length === 0 ? undefined : certified.slice(0, 12);
}

// The deflected-profile dispatch stood here from 2026-08-30 to 2026-09-06:
// when the trainer named exactly one species and the model's whole reply
// was lessons, the driver replaced the lesson with the species' nine-fact
// profile and sent it through scope. It was the substitution class by
// construction — true facts nobody asked for, chosen by the driver from the
// ask's words — and the second dispatch door R3b deleted (docs/routing.md,
// step 5). What it guarded against is now the model's to route and the
// linking's to hold: the profile survives as the `profile` nomination the
// model may make ({@link executeRoute}), a null link teaches the records'
// boundary, and a lesson the model composed for a named species is the
// lesson it composed — certified-true, and the bank's oracle scores it as
// the miss it is rather than the driver hiding it behind a profile.

/**
 * Lessons that rode in as padding, trimmed (porch round four, 2026-09-01:
 * "what beats water types?" answered the matchup with the red-vs-blue lesson
 * stapled on; "tell me more about Caterpie" opened with the what-is-pokemon
 * lesson before the facts). When a draft carries non-lesson claims AND the
 * ask names a certified species or type, the entity was the subject and a
 * generic lesson beside it is deflection residue — the certified page should
 * open with the answer, not a brochure. An ask that names nothing keeps its
 * lessons: they may be exactly what was wanted.
 */
function trimPaddedLessons(world: SessionWorld, ask: string, claims: readonly Claim[]): readonly Claim[] {
  const lessons = claims.filter((claim) => claim.kind === "explanation");
  if (lessons.length === 0 || lessons.length === claims.length) return claims;
  const haystack = ` ${ask.toLowerCase()} `;
  const namesType = [...world.registry.typeNames].some((type) => new RegExp(`\\b${type}\\b`).test(haystack));
  if (!namesType && !namesCertifiedEntity(world.registry, ask)) return claims;
  return claims.filter((claim) => claim.kind !== "explanation");
}

/**
 * The matchup direction, checked against the ask's own word order (porch
 * round five, 2026-09-01: "wat pokmon is gud agenst rock types?" certified
 * rock strong-against — what rock beats, for an ask about beating rock; the
 * prompt's direction rule held for clean wording and typos slipped it).
 * Deterministic and conservative: only when BOTH a direction cue and the
 * subject type are found does word order rule — cue before the type reads
 * "what is good against X" (X weak-to); type before the cue reads "what is X
 * good against" (X strong-against) — and only the weak-to/strong-against
 * pair ever flips. Counted like the other recovery channels: the kernel
 * still verifies whatever direction leaves here.
 */
const DIRECTION_CUE = /\b(good|gud|great|best|effective|strong|use|works?|beats?|counters?)\b/i;

function correctMatchupDirections(world: SessionWorld, ask: string, claims: readonly Claim[]): { claims: readonly Claim[]; flips: number } {
  let flips = 0;
  const lowered = ` ${ask.toLowerCase()} `;
  const corrected = claims.map((claim) => {
    if (claim.kind !== "matchup" || claim.subject.kind !== "type") return claim;
    if (claim.direction !== "weak-to" && claim.direction !== "strong-against") return claim;
    const typeMatch = new RegExp(`\\b${claim.subject.typeId}\\b`).exec(lowered);
    const cueMatch = DIRECTION_CUE.exec(lowered);
    if (typeMatch === null || cueMatch === null) return claim;
    const expected = cueMatch.index < typeMatch.index ? "weak-to" : "strong-against";
    if (claim.direction === expected) return claim;
    flips += 1;
    return { ...claim, direction: expected } as Claim;
  });
  return { claims: corrected, flips };
}

/** One species' certified profile — the shape the nominated `profile` route
 * composes (the deflection door that also composed it is gone; see the note
 * above {@link trimPaddedLessons}). */
function profileClaims(entityId: string): readonly Claim[] {
  return [
    { kind: "fact", entityId, factId: "types" },
    { kind: "fact", entityId, factId: "evolves-to" },
    { kind: "fact", entityId, factId: "pokedex-number" },
    { kind: "fact", entityId, factId: "base-hp" },
    { kind: "fact", entityId, factId: "base-attack" },
    { kind: "fact", entityId, factId: "base-defense" },
    { kind: "fact", entityId, factId: "base-speed" },
    { kind: "fact", entityId, factId: "base-special-attack" },
    { kind: "fact", entityId, factId: "base-special-defense" },
  ];
}

/** Whether a clause names any certified species — word-bounded, with the
 * hyphen fold ("Mr. Mime" finds mr-mime), the one reading every door that
 * asks "is a species named?" shares so they cannot drift. */
function namesCertifiedEntity(registry: CertifiedRegistry, clause: string): boolean {
  const haystack = ` ${clause.toLowerCase()} `;
  return registry.speciesIds.some((id) =>
    new RegExp(`\\b${id.split("-").join("[\\s-]?")}\\b`).test(haystack),
  );
}

/** Whether a clause names any certified subject — species, move or item, the
 * same word-bounded reading as {@link namesCertifiedEntity} but over every id
 * the registry certifies. The wider net serves the doors that ask "is this
 * about something we can answer?" (the drift door, the ladder's inbox); the
 * profile door keeps the species-only check, because only species have
 * profiles. Found live (porch round eleven, 2026-09-01): an item ask over a
 * pending card was read as scope-ish wording because the check knew only
 * species — a move or item ask deserves the same drift door a species ask
 * gets. (Item ids are empty in the standard world and live in the Center
 * world; a subject the registry does not certify still falls safely to the
 * restated card or question below.) */
function namesCertifiedSubject(registry: CertifiedRegistry, clause: string): boolean {
  const haystack = ` ${clause.toLowerCase()} `;
  const names = (ids: readonly string[]): boolean =>
    ids.some((id) => new RegExp(`\\b${id.split("-").join("[\\s-]?")}\\b`).test(haystack));
  return names(registry.speciesIds) || names(registry.moveIds) || names(registry.itemIds);
}

/** Words a question opens with — the ask-shape half of the topic-change cue. */
const ASK_OPENER = /^(what|whats|which|who|how|hows|when|where|why|does|do|did|is|are|can|could|will|would|should|tell|show|list|name|give)\b/i;

/** Whether an utterance reads as a fresh ask rather than an answer: it has a
 * question's shape (a question mark, or an interrogative opener) and it names
 * a certified subject. Both halves are required on purpose — see the
 * topic-change door in {@link drive} for what each half rules out. */
function looksLikeFreshAsk(registry: CertifiedRegistry, text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.includes("?") && !ASK_OPENER.test(trimmed)) return false;
  return namesCertifiedSubject(registry, trimmed);
}

/**
 * The redirect an off-domain opener earns instead of an interrogation.
 *
 * When the discovery call proposes no claims at all, nothing certified is even
 * relevant — the words are casual or off-topic. A three-question intake could
 * only end in an abstention, so the visitor gets an honest pointer at what the
 * Advisor can answer. Like an abstention, it files no record.
 */
function redirect(state: SessionState, deps: SessionDeps, anaphoric = false): SessionState {
  // A generic capability menu right after answered exchanges about a subject
  // reads as amnesia (found live, porch round twelve: "which evolution is
  // best?" straight after two Eevee answers drew the menu). When the ask
  // pointed back at something and the model still couldn't read it, the
  // honest, actionable line is to ask for the antecedent by name.
  const text = anaphoric
    ? "I lost the thread of that one — it seems to point back at something we discussed. Name the " +
      "Pokémon or move you mean and ask again in one line, and I'll answer what the records certify."
    : "I couldn't line that up with anything I can certify. I answer questions about specific " +
      "Pokémon, their moves and matchups, League eligibility, and how the game works — try one of those.";
  return note(
    closeExchange(state),
    deps,
    deps.now(),
    text,
    "abstention",
    ...(anaphoric ? ["discovery declined an anaphoric ask — antecedent re-requested"] : []),
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
  /** `closed`: the exchange ended in a note without a record — a linking
   * contradiction asked about, or an answer emptied of everything but facts
   * nobody asked for. */
  result: "taught" | "off-domain" | "needs-scope" | "unusable" | "closed";
  claims: readonly Claim[];
  /** The decoded rosters beside the claims, so a needs-scope draft can be
   * reused whole once the scope it named turns out to be already granted. */
  rosters: Pick<ManifestDraft, "rosters">["rosters"];
  /** The follow-ups that passed the guard, riding with the draft (R3b step 4). */
  suggestions?: readonly string[];
  /** True when a nominated route's executor composed the claims (a profile,
   * a listing) — the ladder is then skipped for the scope they require. */
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
  const about = previousSubjects(world, state, askWords);
  // The precedent door, once per exchange, before the first call.
  state = consultMemory(state, deps, askWords);

  let step: AnswerStep;
  let stepUsage: Usage;
  let retried = false;
  let refusedListing = false;
  try {
    ({ state, step, usage: stepUsage, retried, refusedListing } = await withRouteFallback(world, state, deps, (routes, feedback, lessons) =>
      proposeAnswer({
        provider,
        context: bare,
        scenarioId: "session",
        transactionId,
        transcript: state.transcript.slice(state.askStart),
        ...precedentArg(state),
        ...(previously === undefined ? {} : { previously }),
        ...(about === undefined ? {} : { previousSubjects: about }),
        ...(routes === undefined ? {} : { routes }),
        ...(feedback === undefined ? {} : { feedback }),
        ...(lessons === undefined ? {} : { lessons }),
        ...(deps.grounded === undefined ? {} : { grounded: deps.grounded }),
        ...(deps.retrieval === undefined ? {} : { retrieval: deps.retrieval }),
        ...(deps.gatedGrammar === undefined ? {} : { gatedGrammar: deps.gatedGrammar }),
        ...(deps.clarify === undefined ? {} : { clarify: deps.clarify }),
        ...(deps.suggest === undefined ? {} : { suggest: deps.suggest }),
        ...(deps.prompt === undefined ? {} : { prompt: deps.prompt }),
      }),
    ));
  } catch {
    // The question is still free: a failed discovery falls to the floor rather
    // than surfacing an error for a call the visitor never asked for. The
    // counter still moves — provider failures are never hidden in outcomes.
    return { state: { ...state, providerErrors: state.providerErrors + 1 }, result: "unusable", claims: [], rosters: [] };
  }

  let spent = ledgerStep(
    {
      ...state,
      usage: addUsage(state.usage, stepUsage),
      nominationRetries: state.nominationRetries + (retried ? 1 : 0),
    },
    deps,
    deps.now(),
    "model",
    "model/discovery",
    `${describeReply(step)}${retried ? afterNomination(deps) : ""}`,
  );
  if (refusedListing) spent = tallyListing(spent, "stoodDown");
  if (!step.decode.ok) {
    // A well-formed reply with no claims is the model's own signal that nothing
    // certified is relevant — off-domain, and the visitor gets a redirect. Any
    // other decode failure is unreadable, not off-domain: it falls to the floor
    // and gathers scope, so a real question the model merely fumbled is not
    // waved away.
    return { state: spent, result: step.decode.reason === NO_CLAIMS_REASON ? "off-domain" : "unusable", claims: [], rosters: [] };
  }
  // Narrowed once; the emptied-reply round below may replace it.
  let decode: Extract<AnswerDecode, { ok: true }> = step.decode;
  let spentFolded = { ...spent, folds: spent.folds + decode.folds };
  // The schema linking, read before anything else the reply carried (R3b):
  // the claims are held to the fields the model linked, an alias
  // contradiction becomes a question, and an ask linked to no field is the
  // records' boundary — taught as the pack's lesson, grantless, with the
  // trainer's own phrase named.
  let linked = applyLinking(world, spentFolded, deps, decode, deps.feedback === true);
  spentFolded = linked.state;
  if (linked.verdict === "retry") {
    // The driver emptied the discovery reply: the same one round the answer
    // hop takes, here before any scope is gathered.
    let again: AnswerStep | undefined;
    try {
      again = await proposeAnswer({
        provider,
        context: bare,
        scenarioId: "session",
        transactionId,
        transcript: state.transcript.slice(state.askStart),
        ...precedentArg(state),
        ...(previously === undefined ? {} : { previously }),
        ...(about === undefined ? {} : { previousSubjects: about }),
        feedback: linked.feedback ?? [],
        ...lessonsArg(world, state, deps),
        ...(deps.grounded === undefined ? {} : { grounded: deps.grounded }),
        ...(deps.retrieval === undefined ? {} : { retrieval: deps.retrieval }),
        ...(deps.gatedGrammar === undefined ? {} : { gatedGrammar: deps.gatedGrammar }),
        ...(deps.clarify === undefined ? {} : { clarify: deps.clarify }),
        ...(deps.suggest === undefined ? {} : { suggest: deps.suggest }),
        ...(deps.prompt === undefined ? {} : { prompt: deps.prompt }),
      });
    } catch {
      spentFolded = ledgerStep({ ...spentFolded, providerErrors: spentFolded.providerErrors + 1 }, deps, deps.now(), "model", "model/retry-failed", RETRY_FAILED);
    }
    spentFolded = {
      ...spentFolded,
      feedbackRetries: spentFolded.feedbackRetries + 1,
      feedbackDenials: [...spentFolded.feedbackDenials, ...(linked.feedback ?? []).filter((line) => line.startsWith("driver/")).map((line) => line.split(":")[0]!)],
    };
    if (again !== undefined) {
      spentFolded = ledgerStep(
        { ...spentFolded, usage: addUsage(spentFolded.usage, again.usage), folds: spentFolded.folds + (again.decode.ok ? again.decode.folds : 0) },
        deps,
        deps.now(),
        "model",
        "model/retry",
        `${describeReply(again)} — the reply after ${fedBack((linked.feedback ?? []).filter((line) => line.startsWith("driver/")).length)}`,
      );
      if (!again.decode.ok) {
        return { state: spentFolded, result: again.decode.reason === NO_CLAIMS_REASON ? "off-domain" : "unusable", claims: [], rosters: [] };
      }
      decode = again.decode;
    }
    linked = applyLinking(world, spentFolded, deps, decode, false);
    spentFolded = linked.state;
    if (linked.verdict === "retry") throw new Error("unreachable: an un-retryable linking asked to retry");
  }
  // "clarifying" leaves the exchange open on the advisor's question — the
  // caller returns the state as it stands, the trainer's pick drives it on.
  if (linked.verdict === "closed" || linked.verdict === "clarifying") return { state: spentFolded, result: "closed", claims: [], rosters: [] };
  if (linked.verdict === "off-domain") return { state: spentFolded, result: "off-domain", claims: [], rosters: [] };
  if (linked.verdict === "boundary") {
    return { state: teachRecordsBoundary(spentFolded, deps, transactionId, establishedAt), result: "taught", claims: [], rosters: [], routed: true };
  }
  // The follow-ups the model offered ride with whatever this hop composes
  // (R3b step 4), guarded once here; a route-composed or profile draft keeps
  // them too — the next step is about the subject, not the shape.
  const suggested = withSuggestions(world, spentFolded, deps, decode, { ...decode.draft, claims: linked.claims });
  spentFolded = suggested.state;
  const draft: ManifestDraft = suggested.draft;
  const carry = draft.suggestions === undefined ? {} : { suggestions: draft.suggestions };
  // A nomination outranks whatever else the reply carried: the model chose a
  // door, the door composes, the kernel judges. Invalid ones fall through to
  // exactly the flow a nomination-free reply takes.
  if (decode.route !== undefined) {
    const composed = executeRoute(world, state, decode.route);
    const isListing = decode.route.routeId === "listing";
    if (composed.ok) {
      const tallied = ledgerStep(
        isListing ? tallyListing(spentFolded, "served") : spentFolded,
        deps,
        deps.now(),
        "driver",
        "route/served",
        `the "${decode.route.routeId}" door composed ${composed.claims.length} claim(s) from the records`,
      );
      return { state: tallied, result: "needs-scope", claims: composed.claims, rosters: composed.rosters, ...carry, routed: true };
    }
    spentFolded = ledgerStep(spentFolded, deps, deps.now(), "driver", "route/refused", `the "${decode.route.routeId}" door was refused: ${composed.reason} — the claims beside it stand on their own`);
    if (isListing) spentFolded = tallyListing(spentFolded, "stoodDown");
    // A refused nomination with nothing beside it is the empty reply it
    // always was — off-domain, never an empty record.
    if (draft.claims.length === 0) {
      return { state: spentFolded, result: "off-domain", claims: [], rosters: [] };
    }
  }
  // (A lesson-only draft for an ask naming one species was, until R3b step
  // 5, replaced here by the species' profile. It is taught as the lesson the
  // model composed now; the profile is the model's to nominate above.)
  // Under lessonsOnly, anything that reads the registry — a fact, a game
  // rule, any roster — is the caller's to answer, not this path's to commit:
  // the kernel would refuse it across the version boundary by name.
  if (lessonsOnly && (draft.claims.some((claim) => claim.kind !== "explanation") || draft.rosters.length > 0)) {
    return { state: spentFolded, result: "needs-scope", claims: draft.claims, rosters: draft.rosters, ...carry };
  }
  // Commit grantless when nothing in the draft depends on scope — a lesson, a
  // game-rule constant, the same answer for every trainer (epic #64). Derived
  // from the one dependency table, so this never drifts from what the kernel's
  // own scope gate will allow grantless.
  if (requiredDimensionsFor(draft.claims).length === 0) {
    return { state: commit(spentFolded, deps, { transactionId, establishedAt, draft }), result: "taught", claims: draft.claims, rosters: draft.rosters, ...carry };
  }
  return { state: spentFolded, result: "needs-scope", claims: draft.claims, rosters: draft.rosters, ...carry };
}

/**
 * The follow-ups a reply offered, guarded into the draft (R3b step 4). Each
 * is held to the kernel's own topic-not-value rule before it can reach a
 * manifest — the gate downstream would refuse the whole answer for one bad
 * suggestion, and a dropped follow-up should never cost a certified answer —
 * deduplicated, and capped at {@link MAX_SUGGESTIONS}. Counted either way.
 * With the door shut, whatever a reply carried is stripped: the register
 * exists only where a page labels it.
 */
function withSuggestions(
  world: SessionWorld,
  state: SessionState,
  deps: SessionDeps,
  decode: Extract<AnswerDecode, { ok: true }>,
  draft: ManifestDraft,
): { state: SessionState; draft: ManifestDraft } {
  const { suggestions: _carried, ...bare } = draft;
  if (deps.suggest !== true) return { state, draft: bare };
  if (decode.suggestions === undefined) return { state, draft };
  const gauge = { ...state.suggestions, offered: state.suggestions.offered + decode.suggestions.length };
  const kept: string[] = [];
  for (const suggestion of decode.suggestions) {
    const duplicate = kept.some((entry) => entry.toLowerCase() === suggestion.toLowerCase());
    if (kept.length >= MAX_SUGGESTIONS || duplicate || suggestionProblem(world.registry, suggestion) !== undefined) {
      gauge.dropped += 1;
      continue;
    }
    kept.push(suggestion);
  }
  gauge.kept += kept.length;
  return { state: { ...state, suggestions: gauge }, draft: kept.length === 0 ? bare : { ...bare, suggestions: kept } };
}

/** The listing gauge, now over nominations alone: `consulted` counts every
 * listing nomination that reached the executor, `served` the ones it
 * composed, `stoodDown` the ones its guards refused, `guardDropped` the
 * model-composed catalogue claims the wrong-set guard removed. */
function tallyListing(state: SessionState, outcome: "served" | "stoodDown" | "guardDropped"): SessionState {
  const t = state.listingActivations;
  return {
    ...state,
    listingActivations: {
      ...t,
      consulted: outcome === "guardDropped" ? t.consulted : t.consulted + 1,
      [outcome]: t[outcome] + 1,
    },
  };
}

/** The most recent certified roster on file, when one exists. */
function priorRoster(state: SessionState) {
  const prior = [...state.records].reverse().find((record) => (record.manifest?.rosters.length ?? 0) > 0);
  return prior?.manifest?.rosters[0];
}

/** First N members of a roster as membership claims, the count kept beside
 * the sample — the composer both the cue door and a nomination share. */
function composeListing(
  roster: ReturnType<typeof priorRoster>,
  n: number,
): Pick<ManifestDraft, "claims" | "rosters"> | undefined {
  if (roster === undefined || roster.memberIds.length === 0) return undefined;
  const take = Math.min(Math.max(1, Math.floor(n)), MAX_ANSWER_CLAIMS - 1, roster.memberIds.length);
  return {
    rosters: [roster],
    claims: [
      ...roster.memberIds.slice(0, take).map((entityId) => ({ kind: "membership", rosterId: roster.id, entityId, asserted: true }) as const),
      { kind: "count", rosterId: roster.id },
    ],
  };
}

/**
 * Everything but the subject and the asking, removed. What survives is the
 * test of bareness: an ask whose leftovers are empty wants the catalogue
 * itself; any surviving word ("legendary", "fastest", "water") qualifies the
 * set, and a qualified set is the model's to compose — a wrong-subject
 * *certified* answer would be worse than the abstention it replaces, so this
 * gate trades recall for specificity on purpose (lesson 6) and its misses
 * cost only a model call.
 */
const LISTING_STOPWORDS =
  /\b(give|show|name|list|what|are|is|me|us|a|an|of|the|those|these|them|all|some|few|at|least|please|can|could|you|ok|okay|so|and|for|out|there|many|more|tell|about|gimme)\b|[^a-z\s]/g;

/**
 * The catalogue itself as a roster, for a bare listing ask with no filed
 * roster to reuse — "what are the Pokémon species?" asked before any count
 * has ever been certified (found live, 2026-08-31: two lessons, no roster,
 * and the follow-up fell to a redirect twice). The empty criteria list is
 * the kernel's own spelling of "every certified member".
 */
/** The set an ask's own qualifiers pick: one named type, a rarity word, or
 * the whole catalogue. Shared by the cue door and the nominated listing so a
 * nomination can never mint a broader set than the words asked for (porch
 * round six, 2026-09-01: "show me all the fire types" drew the all-species
 * listing through a catalogue-subject nomination — certified members, wrong
 * set). */
function qualifiedSet(world: SessionWorld, ask: string) {
  const haystack = ` ${ask.toLowerCase()} `;
  const typesNamed = [...world.registry.typeNames].filter((type) => new RegExp(`\\b${type}\\b`).test(haystack));
  if (typesNamed.length === 1) {
    const built = buildRoster(world.registry, `${typesNamed[0]}-pokemon`, { all: [{ kind: "has-type", type: typesNamed[0]! }] });
    return built.ok ? built.value : undefined;
  }
  if (typesNamed.length > 1) return undefined;
  const rarity = /\brarest\b|\blegendar(?:y|ies)\b/i.test(ask) ? "legendary" : /\bmythicals?\b/i.test(ask) ? "mythical" : undefined;
  if (rarity !== undefined) {
    const built = buildRoster(world.registry, `${rarity}-pokemon`, { all: [{ kind: "rarity", rarity }] });
    return built.ok ? built.value : undefined;
  }
  // The whole catalogue only for the bare ask — the same discipline as the
  // cue door, enforced here so a nomination cannot reach a set the words
  // did not pick ("which pokemon can learn fly?" is a learns-move ask, and
  // the model path composes learns-move rosters perfectly well itself).
  return bareCatalogueAsk(world, ask) ? mintCatalogue(world) : undefined;
}

/** The bareness test, shared by every catalogue door: after scope wording
 * (the vocabulary's business, not a set qualifier — "I'm playing Red and
 * Blue in Kanto" must not unbare the count that follows it), cue words,
 * stop-words, superlatives (a ranking's business) and every qualifier the
 * mints understand, nothing substantive may remain. */
function bareCatalogueAsk(world: SessionWorld, ask: string): boolean {
  const typeStripper = new RegExp(`\\b(${[...world.registry.typeNames].join("|")})\\b`, "g");
  const unmatched = unmatchedClauses(world.pack, ask).join(" ").toLowerCase();
  // A superlative is a ranking's business — which means the ask is a
  // ranking ask, not a bare one. Stripping it as noise (round seven) let
  // "which pokemon is the fastest?" read as bare and be served the previous
  // exchange's listing, certified, with no model call (dogfood 2026-09-04).
  // Read on the raw ask, not the unmatched remainder: since round ten
  // "fastest" binds comparisonBasis, so its clause is *matched* and would
  // vanish from the remainder — vocabulary growth blinding a door is the
  // class docs/routing.md R3 retires; until then the door stands down here.
  if (/\b(strongest|fastest|slowest|weakest|best|worst|highest|lowest|top)\b/.test(ask.toLowerCase())) return false;
  // An ask-parameter term (the comparison basis: "speed", "attack") is a
  // qualifier, not scope about the trainer — but it binds, so its clause
  // vanishes from the unmatched remainder and the bare one-word "speed"
  // read as the catalogue ask (found live 2026-09-05, weak model: "speed"
  // after a closed exchange was served ten species and a count). Read from
  // the vocabulary's own ask-parameter rules, never a word list here.
  const haystack = ` ${ask.toLowerCase()} `;
  const namesAskParameter = world.pack.vocabulary.dimensions
    .filter((rule) => rule.askParameter === true)
    .some((rule) => rule.terms.some((term) => term.tokens.some((token) => new RegExp(`\\b${token.split("-").join("[\\s-]?")}\\b`).test(haystack))));
  if (namesAskParameter) return false;
  const leftovers = unmatched
    .replace(/\bpok[eé]mons?\b|\bspecies\b|\btypes?\b/g, " ")
    .replace(/\brarest\b|\blegendar(?:y|ies)\b|\bmythicals?\b|\bwhich\b|\bwhats?\b|\benumerate\b/g, " ")
    .replace(/\b(who|how)\b/g, " ")
    .replace(typeStripper, " ")
    .replace(LISTING_STOPWORDS, " ")
    .trim();
  return leftovers === "";
}

/**
 * The wrong-set guard (porch round seven, 2026-09-01): the deterministic
 * doors were already held to the ask's own qualifiers, and then the model
 * composed the wrong set itself — an empty-criteria (whole-catalogue) roster
 * with memberships and a count, for "which pokemon can learn fly?". The
 * members were certified-true and the set was not the one the words picked.
 * When a draft's membership or count claims cite an empty-criteria roster
 * and the ask is not the bare catalogue ask, those claims are dropped — an
 * honest pass beats a certified wrong set. Typed and compound rosters are
 * untouched (their criteria carry the qualifiers), and route-composed
 * listings ride bare asks by construction.
 */
function dropWrongSetClaims(
  world: SessionWorld,
  ask: string,
  draft: Pick<ManifestDraft, "claims" | "rosters">,
): Pick<ManifestDraft, "claims" | "rosters"> {
  const catalogueIds = new Set(draft.rosters.filter((roster) => roster.criteria.all.length === 0).map((roster) => roster.id));
  if (catalogueIds.size === 0 || bareCatalogueAsk(world, ask)) return draft;
  const claims = draft.claims.filter(
    (claim) => !((claim.kind === "membership" || claim.kind === "count") && catalogueIds.has(claim.rosterId)),
  );
  if (claims.length === draft.claims.length) return draft;
  const cited = new Set(claims.flatMap((claim) => ("rosterId" in claim && typeof claim.rosterId === "string" ? [claim.rosterId] : [])));
  return { claims, rosters: draft.rosters.filter((roster) => cited.has(roster.id)) };
}

/** The whole certified species set as a roster — the kernel's own spelling
 * of "every member". */
function mintCatalogue(world: SessionWorld) {
  const built = buildRoster(world.registry, "all-species", { all: [] });
  return built.ok ? built.value : undefined;
}

/**
 * The doors the model may nominate instead of composing (epic #118, the
 * route-nomination step). Recognition, not composition: the weak model kept
 * failing the two-step build (resolve the subject, then compose roster and
 * memberships) while the 1-of-k choice is the thing it measurably holds. A
 * nomination is untrusted — {@link executeRoute} validates the id and every
 * argument, an unknown or malformed one is ignored, and what a route
 * composes still faces the kernel whole. Descriptions are written for the
 * model and deliberately name no particular species.
 */
export const SESSION_ROUTES: readonly NominableRoute[] = [
  {
    id: "listing",
    description:
      "the trainer wants members of a set enumerated — some of the species, a sample of a group " +
      "they were just told about, or the certified catalogue itself. NOT for qualified sets: " +
      "for a type's members, a move's learners, or any filtered group, compose the roster " +
      "yourself with the criteria and list memberships from it",
    args: {
      subject: { type: "string", enum: ["catalogue", "prior-roster"] },
      n: { type: "integer" },
    },
  },
  {
    id: "profile",
    description:
      "the trainer wants the rundown of ONE named creature — its types, dex number, base stats and what it evolves into; " +
      "put the certified id of that creature in entityId",
    args: { entityId: { type: "string" } },
  },
];

/**
 * What each door's arguments mean, for the ledger — a reader sees
 * "subject = catalogue — which set to list: the whole certified catalogue"
 * rather than a bare `subject=catalogue`. Driver-side only: the model's
 * schema carries the enum and nothing more, so a meaning added here changes
 * no prompt and no measured behaviour.
 */
const ROUTE_ARG_MEANING: Readonly<Record<string, Readonly<Record<string, (value: unknown) => string>>>> = {
  listing: {
    subject: (value) =>
      value === "catalogue"
        ? "which set to list: the whole certified catalogue"
        : value === "prior-roster"
          ? "which set to list: the set the previous answer showed"
          : "which set to list (not a set this door knows)",
    n: () => "how many members to list",
  },
  profile: {
    entityId: () => "the one creature whose certified facts to compile",
  },
};

/** The nomination as the ledger carries it: the door and its arguments on
 * one line, then one line per argument saying what it means. */
function explainNomination(route: { routeId: string; [arg: string]: unknown }): string[] {
  const args = Object.entries(route).filter(([key]) => key !== "routeId" && key !== "kind");
  const meanings = ROUTE_ARG_MEANING[route.routeId] ?? {};
  return [
    `${route.routeId}(${args.map(([key, value]) => `${key}=${String(value)}`).join(", ")})`,
    ...args.map(([key, value]) => `${key} = ${String(value)} — ${meanings[key]?.(value) ?? "an argument this door does not take"}`),
  ];
}

/** A nomination executed, or refused with the guard's reason in fixed wording
 * — the reason is the ledger's, so a trail says why a door stayed shut. */
type RouteResult = ({ ok: true } & Pick<ManifestDraft, "claims" | "rosters">) | { ok: false; reason: string };

/**
 * A nomination, validated and executed — or refused, which sends the flow
 * down exactly the path it would have taken with no nomination at all. The
 * model chose a door; every value still comes from the registry or the
 * record, and the kernel verifies the composition.
 */
function executeRoute(
  world: SessionWorld,
  state: SessionState,
  route: { routeId: string; [arg: string]: unknown },
): RouteResult {
  const refuse = (reason: string): RouteResult => ({ ok: false, reason });
  const currentAsk = openingAskOf(state);
  // The executors carry the cue doors' own guards. Found by the R1 bank run
  // (2026-09-04): under the provider-enforced schema the strong model
  // nominated the catalogue listing for "What's Pikachu's Speed stat?" and
  // the profile for "Does Pikachu learn Selfdestruct?", and both doors
  // composed — certified members and certified facts, neither the answer.
  // A guard belongs to whatever the model composed, nominated or not
  // (docs/routing.md); a refused nomination earns the retry with the door
  // closed, never a wrong-shape certificate.
  if (route.routeId === "listing") {
    // The ask-only checks, shared with the offer (docs/offered-door.md) so
    // the two cannot drift: a nomination the offer withholds is exactly one
    // the executor would refuse here.
    const askOnly = listingAskCheck(world, currentAsk);
    if (askOnly !== undefined) return refuse(askOnly);
    const haystack = ` ${currentAsk.toLowerCase()} `;
    const typesNamed = [...world.registry.typeNames].filter((type) => new RegExp(`\\b${type}\\b`).test(haystack));
    // Subject-correct by construction: the set comes from the ask's own
    // qualifiers, never from the nomination's say-so — a catalogue-subject
    // nomination for "show me all the fire types" mints the fire roster, and
    // a prior-roster nomination for "whats the rarest pokemon?" mints the
    // legendaries, not the fire roster of the exchange before (found live,
    // 2026-09-05, the first run without the cue door). The prior roster
    // answers only an ask that qualifies nothing itself.
    const qualified = qualifiedSet(world, currentAsk);
    const qualifies = typesNamed.length === 1 || (qualified !== undefined && qualified.criteria.all.length > 0);
    const roster = route.subject === "prior-roster" && !qualifies ? (priorRoster(state) ?? qualified) : qualified;
    // An enumeration of one is not an enumeration. Found live (dogfood,
    // 2026-09-06): "what is a Pokemon" drew a catalogue listing with n = 1
    // and was served Bulbasaur and a count where the what-is-pokemon lesson
    // was the answer; the tracer had shown the same shape — listing,
    // prior-roster, n = 1 — on every one of nine "what's a gym badge?" runs.
    // The bareness reading cannot see it (the ask is lexically bare); the
    // nomination's own argument can. Refused, so the route-door-closed retry
    // asks the model for the answer it meant.
    if (typeof route.n === "number" && Number.isFinite(route.n) && route.n < 2) return refuse(`a list of one is not a list (the model asked for n = ${route.n})`);
    const n = typeof route.n === "number" && Number.isFinite(route.n) && route.n > 0 ? route.n : 10;
    const listed = composeListing(roster, n);
    if (listed === undefined) return refuse("there is no set to list — the question defines none, and no earlier answer showed one");
    return { ok: true, ...listed };
  }
  if (route.routeId === "profile") {
    const raw = typeof route.entityId === "string" ? route.entityId.toLowerCase().trim().replace(/\s+/g, "-") : "";
    if (!world.registry.speciesIds.includes(raw)) return refuse(`"${raw}" is not a species the records certify`);
    // A profile carries no learnset: an ask that names a move is asking
    // about the move, and the species' nine facts cannot answer it.
    const moveHaystack = ` ${currentAsk.toLowerCase()} `;
    const namesMove = world.registry.moveIds.some((id) =>
      new RegExp(`\\b${id.split("-").join("[\\s-]?")}\\b`).test(moveHaystack),
    );
    if (namesMove) return refuse("the question is about a move, and a profile holds a creature's facts, not its moves");
    return { ok: true, claims: profileClaims(raw), rosters: [] };
  }
  return refuse(`there is no "${route.routeId}" door`);
}

/** The exchange's OPENING utterance is the ask; later ones answer the
 * pack's questions ("Red and Blue") and would unbare or requalify it. */
function openingAskOf(state: SessionState): string {
  const opening = state.transcript
    .slice(state.askStart)
    .find((event) => event.kind === "utterance" && event.source === "trainer");
  return opening?.kind === "utterance" ? opening.text : "";
}

/**
 * The listing executor's checks that read the ask alone — the reason a
 * nomination would be refused before any model has nominated, or
 * undefined when the ask admits the door. Two checks, the executor's own
 * (the M3 legs read 197 of 209 refused listing nominations on the strong
 * model as decided by exactly these; docs/offered-door.md): the ask names
 * a certified subject, so a listing answers the wrong shape; or it names
 * no single type and is not the bare catalogue ask, so there is no set.
 * Reasons are written for a reader outside the code: what the question
 * has or lacks, never the guard's own name for it.
 */
function listingAskCheck(world: SessionWorld, ask: string): string | undefined {
  if (namesCertifiedSubject(world.registry, ask)) return "the question is about one named thing, and a listing answers a set";
  const haystack = ` ${ask.toLowerCase()} `;
  const typesNamed = [...world.registry.typeNames].filter((type) => new RegExp(`\\b${type}\\b`).test(haystack));
  if (typesNamed.length !== 1 && !bareCatalogueAsk(world, ask)) return "the question names no set to list — no type, and not a plain ask to list the catalogue";
  return undefined;
}

/**
 * The lesson door's ask-only check (docs/lesson-door.md): which lessons
 * this ask is about, by the matcher the session runs — the declared aliases
 * by default, or the BM25 index over the lesson text (`deps.lessonMatcher`).
 * Both apply the same policy: concept lessons first, orientation lessons
 * only when no concept matched, the boundary always; a pack that declares
 * no coverage offers everything, and says so.
 */
export function lessonAskCheck(world: SessionWorld, ask: string, matcher: LessonMatcherId = "alias"): LessonOffer {
  return lessonOffer(matcher, world, ask);
}

/**
 * The lesson door's set for this exchange, as the argument every answer call
 * takes — the first call, the nomination retry and each carried-back retry
 * alike. Found on the porch (2026-09-16): with only the first call narrowed,
 * the off-ask retry brought the whole catalogue back into the grammar and the
 * strong model certified the withheld lesson on 3 of 50 conversations. The
 * check is a pure function of the ask, so recomputing it here cannot differ
 * from the step already on the trail.
 */
function lessonsArg(world: SessionWorld, state: SessionState, deps: SessionDeps): { lessons?: readonly string[] } {
  if (deps.lessonDoor !== true) return {};
  // The exchange's own offer when the first call set it — the classifier's
  // reading included — else the deterministic check, which is the same
  // function of the ask.
  return { lessons: state.lessonDoor.ids ?? lessonAskCheck(world, openingAskOf(state), deps.lessonMatcher).offered };
}

/** What the lesson door decided for one exchange, the classifier included. */
export interface LessonDoorDecision {
  readonly offer: LessonOffer;
  /** Whether the classifier was asked — only when the matcher found nothing. */
  readonly asked: boolean;
  readonly classified?: SessionState["lessonDoor"]["classified"];
  readonly usage: Usage;
  readonly providerError: boolean;
}

/**
 * The lesson door's whole decision for an ask (docs/lesson-door.md): the
 * deterministic matcher, then — with the classifier on and the matcher
 * offering the boundary alone — one model call asking what kind of
 * question this is. A lesson the model names is offered beside the
 * boundary; anything else, an unusable reply or a provider failure leaves
 * the boundary alone, so the door never widens past what the model said.
 * One function, so the driver and the live reading measure the same thing.
 */
export async function lessonDoorDecision(
  world: SessionWorld,
  provider: ModelProvider,
  ask: string,
  options: { matcher?: LessonMatcherId | undefined; classifier: boolean },
): Promise<LessonDoorDecision> {
  const offer = lessonAskCheck(world, ask, options.matcher);
  const none = { usage: emptyUsage(), providerError: false };
  if (!options.classifier || offer.offered.length > 1) return { offer, asked: false, ...none };
  const boundary = world.pack.recordsBoundary?.lessonId;
  try {
    const step = await classifyLessonAsk({
      provider,
      scenarioId: "session",
      ask,
      lessons: world.pack.curriculum
        .filter((lesson) => lesson.covers !== undefined && lesson.covers.scope !== "boundary")
        .map((lesson) => ({ id: lesson.id, scope: lesson.covers!.scope, gloss: firstSentence(lesson.block.content[0]?.text ?? "") })),
    });
    const classified = step.classification ?? "unusable";
    if (step.classification?.kind === "lesson" && step.classification.lessonId !== undefined) {
      const named = step.classification.lessonId;
      // The foothold: the named lesson must share a word with the ask, or
      // it is not offered. A model that reads form and not topic — the weak
      // model calling "How do I cook pasta?" a how-to-play ask — is held
      // to the pack's own words here, deterministically.
      const foothold = lessonFoothold(world.pack, ask, named);
      if (foothold.length === 0) {
        return { offer, asked: true, classified: { ...step.classification, foothold: [] }, usage: step.usage, providerError: false };
      }
      const offeredSet = new Set([named, ...(boundary === undefined ? [] : [boundary])]);
      return {
        offer: {
          offered: world.pack.curriculum.filter((lesson) => offeredSet.has(lesson.id)).map((lesson) => lesson.id),
          withheld: world.pack.curriculum.filter((lesson) => !offeredSet.has(lesson.id)).map((lesson) => lesson.id),
          reason: `no declared phrasing matched; asked, the model read the question as an ask for "${named}"`,
        },
        asked: true,
        classified: { ...step.classification, foothold },
        usage: step.usage,
        providerError: false,
      };
    }
    return { offer, asked: true, classified, usage: step.usage, providerError: false };
  } catch {
    return { offer, asked: true, classified: "unusable", usage: none.usage, providerError: true };
  }
}

function describeClassification(classified: SessionState["lessonDoor"]["classified"]): string {
  const lead = "the deterministic door offered only the boundary; asked what kind of question this is, the model";
  if (classified === undefined || classified === "unusable") return `${lead} gave no usable reply — the boundary stays alone`;
  if (classified.kind === "lesson" && classified.foothold !== undefined && classified.foothold.length === 0) {
    return `${lead} read it as an ask for the lesson "${classified.lessonId}", but the question shares no word with that lesson — not offered; the boundary stays alone`;
  }
  if (classified.kind === "lesson") return `${lead} read it as an ask for the lesson "${classified.lessonId}" (the question and the lesson share ${(classified.foothold ?? []).map((word) => `"${word}"`).join(", ") || "a word"}) — offered beside the boundary`;
  const kind =
    classified.kind === "fact"
      ? `a fact question${classified.entity === undefined ? "" : ` about "${classified.entity}"`}`
      : classified.kind === "advice"
        ? "a request for advice"
        : "not a lesson question";
  return `${lead} read it as ${kind} — the boundary stays alone`;
}

/** The lesson's first sentence, as its gloss in the classifier's prompt. */
function firstSentence(text: string): string {
  const match = /^(.*?[.!?])(\s|$)/.exec(text.trim());
  return (match?.[1] ?? text).trim();
}

/**
 * The schema linking applied to one decoded reply (docs/routing.md, R3b) —
 * the structural checks that replaced R3a's seventy boundary tokens, none of
 * which contains a domain word:
 *
 *  - **An alias contradiction is a question.** The phrase carries the
 *    dictionary's words for a different field than the one the model linked
 *    (or for a field where it linked none): the trainer is asked which they
 *    meant, and nothing certifies. Counted.
 *  - **Claims stay inside the ask.** Field-bearing claims about fields the
 *    model did not link are dropped and counted; a reply emptied by that is
 *    an honest pass, never a certificate of facts nobody asked for.
 *  - **A null link is the records' boundary.** Reported in the trainer's own
 *    phrase; alone, it hands the caller the boundary verdict so the pack's
 *    lesson is taught as the answer.
 *
 * Found by R2's bank leg (2026-09-05): with scope pre-set, ten needs-data
 * questions came back with a certified fact about the subject that was not
 * the fact asked for — true, in scope, not the answer. The token list that
 * first caught them was the class of mechanism no other domain could re-tune;
 * this is what replaced it.
 */
function applyLinking(
  world: SessionWorld,
  state: SessionState,
  deps: SessionDeps,
  decode: Extract<AnswerDecode, { ok: true }>,
  /** Whether a reply this step empties may be carried back to the model
   * once, the refusal named ({@link SessionDeps.feedback}); false on the
   * retry itself, so the loop is one round. */
  retryable = false,
): {
  state: SessionState;
  claims: readonly Claim[];
  verdict: "proceed" | "closed" | "boundary" | "off-domain" | "clarifying" | "retry";
  /** For `retry`: the refusal in fixed wording, one line per reason. */
  feedback?: readonly string[];
} {
  // The model asked instead of answering (R3b step 3). A nomination like any
  // other: the options are typed against the dictionary and the registry,
  // the chain is capped, and the question is a recorded event the trainer
  // answers by pick. Honored only through the open door — a scripted reply
  // carrying one with the door shut is read as the claims beside it.
  if (deps.clarify === true && decode.clarify !== undefined) {
    const options = validOptions(world.pack, world.registry, decode.clarify.options);
    // A question needs a choice: two typed options at least. Found by the
    // step 5 baseline leg (2026-09-06, strong model): 15 of 25 nominated
    // questions carried one option — "Which field do you mean?" over the
    // reserved none alone, "did you mean Move type?" — a hedge worded as a
    // question, which the truthful trainer could only decline twice. With
    // one option there is nothing to pick; the reply is read as the claims
    // and the mapping beside it, where a null link already knows what to do.
    if (options.length >= 2) {
      const question = usableQuestion(decode.clarify.question)
        ? decode.clarify.question.trim()
        : `When you said "${decode.clarify.about}", which did you mean — ${options.map((option) => option.label).join(", ")}?`;
      return clarify(state, deps, { about: decode.clarify.about, text: question, options, source: "the model's nomination" });
    }
    // No choice survived: the model said "ambiguous" and named nothing (or
    // one thing) a pick could bind to. The claims beside it stand as they
    // would have; a reply with nothing beside it is the honest pass, naming
    // the phrase.
    if (decode.draft.claims.length === 0 && decode.route === undefined && decode.asked.every((entry) => entry.fieldId !== null)) {
      return {
        state: note(
          closeExchange(state),
          deps,
          deps.now(),
          `I'm not sure what you mean by "${decode.clarify.about}" — ask it again in one line, naming the subject and the thing about it you want, and I'll answer what the records certify.`,
          "abstention",
          "clarification dropped: no typed option survived validation — nothing was asked, nothing certified",
        ),
        claims: [],
        verdict: "closed",
      };
    }
  }

  const gauge = { ...state.linking };
  // The trainer's pick on this exchange's clarification binds the ask (R3b
  // step 3): a field pick replaces the model's mapping with the one link the
  // trainer chose, so the claims are held to it below whatever the model
  // linked; a subject pick is applied after linking, dropping claims about
  // any other certified subject. Structural both ways — the pick is an id.
  const bound = state.bound;
  if (decode.asked.length === 0 && bound?.kind !== "field") {
    gauge.unlinked += 1;
    const unlinked = ledgerStep({ ...state, linking: gauge }, deps, deps.now(), "driver", "linking/unlinked", "the reply linked nothing — its claims stand as they are");
    return { state: unlinked, claims: holdToSubject(world, decode.draft.claims, bound, gauge), verdict: "proceed" };
  }
  if (decode.asked.length > 0) gauge.mapped += 1;

  // Only this ask's links: the earlier exchanges the model was shown as
  // context are not the ask, whatever it linked in them.
  const trainerWords = (events: ScopeTranscript): string =>
    events.flatMap((event) => (event.kind === "utterance" && event.source === "trainer" ? [event.text] : [])).join(" ");
  const fresh = freshLinks(decode.asked, trainerWords(state.transcript.slice(state.askStart)), trainerWords(state.transcript.slice(0, state.askStart)));
  gauge.staleDropped += fresh.stale;
  if (fresh.stale > 0) state = ledgerStep(state, deps, deps.now(), "driver", "linking/stale-dropped", `${fresh.stale} link(s) about an earlier exchange dropped`, fresh.stale);
  const subject = fresh.asked.map((entry) => canonicalId(entry.entityId)).find((id) => certifies(world.registry, id)) ?? fresh.asked[0]?.entityId ?? "";
  const asked =
    bound?.kind === "field" ? [{ phrase: bound.label, entityId: subject, fieldId: bound.fieldId }] : fresh.asked;

  // The dictionary's words cross-check the model's link, never a pick the
  // trainer made themselves.
  let contradiction = bound?.kind === "field" ? undefined : aliasContradiction(world.pack, world.registry, asked);
  // Before a question, two cheaper moves (2026-09-11, the levers that keep
  // the fallback rare). *Union*: the phrase carries another field's words,
  // but the reply already answers that reading too — every claim is
  // certified, so answering both is never wrong, and the suggested field is
  // within the ask by the dictionary's own evidence; the mapping is widened
  // to it and no one is asked. *Feedback*: with the round open, the
  // contradiction is carried back once in fixed wording — one model call
  // before one trainer question — and read again by this same step.
  let widened = asked;
  if (contradiction !== undefined) {
    const suggestedIds = new Set(contradiction.suggested.map((field) => field.id));
    const covered = decode.draft.claims.some((claim) => fieldsOfClaim(claim, decode.draft.rosters).some((field) => suggestedIds.has(field)));
    if (covered) {
      const about = asked.find((entry) => entry.phrase === contradiction?.phrase);
      widened = [...asked, ...contradiction.suggested.map((field) => ({ phrase: contradiction!.phrase, entityId: about?.entityId ?? subject, fieldId: field.id }))];
      gauge.unions += 1;
      state = ledgerStep(state, deps, deps.now(), "driver", "linking/union", `"${contradiction.phrase}" carries the words of ${contradiction.suggested.map((field) => field.name).join(" or ")}, and the reply answers that reading too — both kept, no question`);
      contradiction = undefined;
    } else if (retryable && deps.feedback === true) {
      const linkedName = contradiction.linked?.name ?? "no field";
      const names = contradiction.suggested.map((field) => field.name).join(" or ");
      const reason = `driver/ambiguous-field: "${contradiction.phrase}" was read as ${linkedName} but carries the words of ${names}`;
      return {
        state: ledgerStep({ ...state, linking: gauge }, deps, deps.now(), "driver", "linking/carried-back", `"${contradiction.phrase}" was read as ${linkedName} but carries the words of ${names} — carried back to the model once`, undefined, [reason]),
        claims: [],
        verdict: "retry",
        feedback: [`${reason} — answer every reading the records hold, each as its own claim, and link the phrase to each field it may mean`],
      };
    }
  }
  if (contradiction !== undefined) {
    gauge.contradictions += 1;
    const names = contradiction.suggested.map((field) => field.name).join(" or ");
    state = ledgerStep(state, deps, deps.now(), "driver", "linking/contradiction", `"${contradiction.phrase}" was read as ${contradiction.linked?.name ?? "no field"} but carries the words of ${names}`);
    if (deps.clarify === true) {
      // The question with the fields as typed options (R3b step 3): the
      // pick binds, where the stock line could only send the trainer away
      // to ask again. Driver-worded — the fields and the phrase are all the
      // question needs, and a fixed wording is a countable one.
      const fields = [...(contradiction.linked === undefined ? [] : [contradiction.linked]), ...contradiction.suggested];
      return clarify(
        { ...state, linking: gauge },
        deps,
        {
          about: contradiction.phrase,
          text:
            contradiction.linked === undefined
              ? `When you said "${contradiction.phrase}", did you mean ${names}?`
              : `I read "${contradiction.phrase}" as ${contradiction.linked.name}, but it could mean ${names} — which did you mean?`,
          options: fields.map((field) => ({ kind: "field", label: field.name, fieldId: field.id })),
          source: `alias contradiction: "${contradiction.phrase}" linked to ${contradiction.linked?.id ?? "no field"}, carries ${contradiction.suggested.map((field) => field.id).join(", ")}`,
        },
      );
    }
    const text =
      contradiction.linked === undefined
        ? `You asked about "${contradiction.phrase}" — I don't think the records hold that as such, but they do hold ${names}. If that's what you meant, ask again naming it.`
        : `I read "${contradiction.phrase}" as ${contradiction.linked.name}, but it could mean ${names}. Which did you mean? Ask again with that word and I'll answer it.`;
    return {
      state: note(
        closeExchange({ ...state, linking: gauge }),
        deps,
        deps.now(),
        text,
        "abstention",
        `alias contradiction: "${contradiction.phrase}" linked to ${contradiction.linked?.id ?? "no field"}, carries ${contradiction.suggested.map((field) => field.id).join(", ")} — asked, nothing certified`,
      ),
      claims: [],
      verdict: "closed",
    };
  }

  const held = linkClaims(widened, decode.draft.claims, decode.draft.rosters);
  gauge.offTargetDropped += held.dropped;
  const linked = { ...held, claims: holdToSubject(world, held.claims, bound, gauge) };
  let next: SessionState = { ...state, linking: gauge };
  if (held.dropped > 0) next = ledgerStep(next, deps, deps.now(), "driver", "linking/off-ask-dropped", `${held.dropped} claim(s) dropped as off the asked fields or subject`, held.dropped);
  if (linked.claims.length < held.claims.length) next = ledgerStep(next, deps, deps.now(), "driver", "linking/held-to-pick", `${held.claims.length - linked.claims.length} claim(s) dropped as off the subject the trainer picked`, held.claims.length - linked.claims.length);

  // What the model said it could not certify (the R3a abstention, now read
  // from the mapping): reported in the trainer's own phrase, never a claim —
  // and only when the null link is the whole answer. A null link beside a
  // surviving claim or a nomination is the model naming what has no column
  // ("how many", "list ten", "a gym badge") next to the set operation or
  // lesson that answers it; found live (2026-09-05): every count and listing
  // ask drew a boundary note beside its certified answer. Counted, silent.
  const unavailable = asked.flatMap((entry) => (entry.fieldId === null ? [{ entityId: entry.entityId, asked: entry.phrase }] : []));
  // A nomination the executor refuses is no answer (found live 2026-09-11:
  // "How many PP does Psychic have?" came back as a refused route beside one
  // off-ask claim, and the emptied reply was passed instead of carried back).
  const routeRefused = decode.route !== undefined && !executeRoute(world, state, decode.route).ok;
  const routeStands = decode.route !== undefined && !routeRefused;
  const answersRemain = linked.claims.length > 0 || routeStands;
  // The boundary is about a certified subject: "how tall is Onix?" is
  // asking the records for something they do not hold. A null link on a
  // subject the records never certified — the weather, "this" — is the
  // off-domain reply it always was (found by the first R3b bank leg: every
  // off-domain question taught the boundary lesson; and by dogfood the
  // same evening: "tell me about this" drew the boundary note AND the
  // redirect, because the note was written before this was checked).
  // ...and a subject the trainer actually named — in this exchange's words
  // or on the page they were just reading. A certified id the model supplied
  // from nowhere is the fabricated-subject class in the mapping's clothes:
  // found live (dogfood, 2026-09-06), "tell me more about this specie" after
  // two lessons drew "this specie" → pikachu → none, twelve Pikachu facts
  // dropped as off the ask, and the boundary lesson taught about a Pokémon
  // nobody had mentioned. With no named subject the reply is the anaphoric
  // redirect it always was: name what you mean.
  const exchangeWords = ` ${trainerWords(state.transcript.slice(state.askStart)).toLowerCase()} `;
  const shown = previousSubjects(world, state, trainerWords(state.transcript.slice(state.askStart))) ?? [];
  const namedByTrainer = (id: string): boolean =>
    shown.includes(id) || new RegExp(`\\b${id.split("-").join("[\\s-]?").replace(/\./g, "\\.")}\\b`).test(exchangeWords);
  const aboutRecords = unavailable.some((entry) => {
    const id = canonicalId(entry.entityId);
    const certified =
      world.registry.speciesIds.includes(id) ||
      world.registry.moveIds.includes(id) ||
      world.registry.itemIds.includes(id) ||
      world.registry.typeNames.has(id);
    return certified && namedByTrainer(id);
  });
  if (unavailable.length > 0 && !answersRemain && aboutRecords) {
    // The phrase is the model's span of the ask; when it already names the
    // subject (found on the first live run: the whole question came back as
    // the phrase), naming it again reads as a stutter.
    // ...and a subject the registry does not certify ("gym_badge", on the
    // weak model's first run) is not one to name at all.
    const registry = world.registry;
    const named = unavailable
      .map((entry) => {
        const id = entry.entityId.toLowerCase().trim();
        const certified = registry.speciesIds.includes(id) || registry.moveIds.includes(id) || registry.itemIds.includes(id);
        const entity = id.replace(/-/g, " ");
        const phrase = entry.asked.trim().replace(/[?.!]+$/, "");
        const namesEntity = new RegExp(`\\b${entity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(phrase);
        return certified && !namesEntity ? `"${phrase}" for ${entity}` : `"${phrase}"`;
      })
      .join(", ");
    next = note(
      next,
      deps,
      deps.now(),
      `The records don't hold ${named} — the League cannot certify that, so I won't guess at it.`,
      "abstention",
      `the model linked ${unavailable.length} asked phrase(s) to no certified field — nothing substituted`,
    );
  }

  if (linked.claims.length === 0 && !routeStands) {
    // The driver emptied a reply the model meant as an answer — every claim
    // dropped as off the ask or about no subject — and until now threw the
    // signal away, the way the kernel's denials once were. Found live
    // (dogfood, 2026-09-06): "what are Pokémon?", the model's own suggested
    // follow-up, came back as an action on the entity "none", was emptied,
    // and dead-ended in a redirect where the what-is-pokemon lesson was the
    // answer. One round, the refusal named in fixed wording, the second
    // reply read by exactly this step with the door shut; a reply the model
    // itself left empty (no claim at all) is not carried back — it said
    // nothing, and there is nothing to correct.
    const emptied = (decode.draft.claims.length > 0 || routeRefused) && !aboutRecords;
    if (retryable && emptied) {
      const reasons = [
        ...(routeRefused && decode.route !== undefined
          ? [`driver/refused-route: the nomination "${decode.route.routeId}" was refused — answer the ask directly, as claims about the subject asked`]
          : []),
        ...(decode.draft.claims.some((claim) => "entityId" in claim && canonicalId(claim.entityId) === NO_FIELD)
          ? [`driver/no-subject: a claim named "${NO_FIELD}" as its subject — a claim needs a certified subject, or none should be made`]
          : []),
        ...(linked.dropped > 0
          ? [`driver/off-ask: ${linked.dropped} claim(s) were about a field the mapping did not link, or a subject not asked about`]
          : []),
        "If a reviewed lesson squarely answers the question, teach that lesson; if a certified subject and field answer it, name them and link the field; otherwise reply with no claims at all.",
      ];
      const named = reasons.filter((line) => line.startsWith("driver/"));
      const codes = named.map((line) => line.split(":")[0]!);
      return {
        state: ledgerStep(next, deps, deps.now(), "driver", "reply/carried-back", `the reply was emptied (${codes.join(", ")}) — carried back to the model once`, undefined, named),
        claims: [],
        verdict: "retry",
        feedback: reasons,
      };
    }
    if (unavailable.length > 0) return { state: next, claims: [], verdict: aboutRecords ? "boundary" : "off-domain" };
    if (asked.length === 0) {
      // Every link was stale: the reply answered the earlier exchanges and
      // nothing in this one. An honest pass, with the stale count in the
      // detail register.
      return {
        state: note(
          closeExchange(next),
          deps,
          deps.now(),
          "I lost the thread of that one — it seems to point back at something we discussed. Ask it again in one line, naming what you mean, and I'll answer what the records certify.",
          "abstention",
          `schema linking found every link (${fresh.stale}) about an earlier exchange — nothing was committed`,
        ),
        claims: [],
        verdict: "closed",
      };
    }
    if (decode.draft.claims.length > 0) {
      // Everything the reply carried was off the ask — the fields the model
      // linked, or the reading the trainer picked.
      return {
        state: note(
          closeExchange(next),
          deps,
          deps.now(),
          bound === undefined
            ? "I could only find answers to things you didn't ask for, so I'd rather pass than answer the wrong question."
            : `You picked "${bound.label}", and I couldn't put together a certified answer about that — I'd rather pass than answer something else.`,
          "abstention",
          `schema linking dropped every claim (${decode.draft.claims.length}) as off the asked fields — nothing was committed`,
        ),
        claims: [],
        verdict: "closed",
      };
    }
  }
  return { state: next, claims: linked.claims, verdict: "proceed" };
}

/**
 * A subject pick, applied (R3b step 3): the trainer said which of the
 * candidates they meant, so a claim about any *other* certified subject is
 * the substitution class and is dropped, counted with the off-target claims.
 * Claims about no certified subject (a lesson, a set operation, a claim on
 * an id the registry never certified — the kernel's to refuse) pass through.
 */
function holdToSubject(
  world: SessionWorld,
  claims: readonly Claim[],
  bound: ClarificationOption | undefined,
  gauge: SessionState["linking"],
): readonly Claim[] {
  if (bound?.kind !== "entity") return claims;
  const kept = claims.filter((claim) => {
    const subjects = subjectsOfClaim(claim).map(canonicalId).filter((id) => certifies(world.registry, id));
    return subjects.length === 0 || subjects.includes(bound.entityId);
  });
  gauge.offTargetDropped += claims.length - kept.length;
  return kept;
}

/** The subject ids a claim is about, for the pick check — structure only. */
function subjectsOfClaim(claim: Claim): readonly string[] {
  switch (claim.kind) {
    case "fact":
    case "eligibility":
    case "recommendation":
    case "action":
    case "membership":
      return [claim.entityId];
    case "comparison":
      return [claim.leftId, claim.rightId];
    case "treats":
      return [claim.itemId];
    case "matchup":
      return claim.subject.kind === "species" ? [claim.subject.entityId] : [claim.subject.typeId];
    default:
      return [];
  }
}

/**
 * Ask the advisor's own question (R3b step 3): recorded as a `clarification`
 * event with its typed options, the phase set to wait for the pick, the
 * chain capped. The question text is shown in the advisor's voice and never
 * certifies anything; the options are what a pick binds to. At the cap the
 * exchange closes with the honest pass, naming what stayed ambiguous — the
 * bot may ask twice and never interrogate.
 */
function clarify(
  state: SessionState,
  deps: SessionDeps,
  question: { about: string; text: string; options: readonly ClarificationOption[]; source: string },
): { state: SessionState; claims: readonly Claim[]; verdict: "closed" | "clarifying" } {
  const askedSoFar = state.transcript.slice(state.askStart).filter((event) => event.kind === "clarification").length;
  if (askedSoFar >= MAX_CLARIFICATIONS) {
    return {
      state: note(
        closeExchange({ ...state, clarification: { ...state.clarification, capped: state.clarification.capped + 1 } }),
        deps,
        deps.now(),
        `I've asked twice and still can't pin down what you mean by "${question.about}" — ask it again in one line, naming it, and I'll answer what the records certify.`,
        "abstention",
        `clarification chain capped at ${MAX_CLARIFICATIONS} on "${question.about}" (${question.source}) — nothing was certified`,
      ),
      claims: [],
      verdict: "closed",
    };
  }
  const event: ClarificationEvent = {
    kind: "clarification",
    at: deps.now(),
    source: "advisor",
    about: question.about,
    text: question.text,
    options: question.options,
  };
  const { bound: _bound, ...rest } = ledgerStep(state, deps, event.at, "driver", "clarify/asked", `asked which was meant by "${question.about}" — options ${question.options.map((option) => option.label).join(" / ")} (${question.source})`);
  return {
    state: {
      ...rest,
      transcript: [...state.transcript, event],
      phase: { kind: "clarifying", clarification: event },
      clarification: { ...state.clarification, asked: state.clarification.asked + 1 },
    },
    claims: [],
    verdict: "clarifying",
  };
}

/**
 * The trainer replied to the advisor's question with words that picked no
 * option and asked nothing new. Once, the question is restated with its
 * options — the reply may have been a paraphrase the labels do not cover;
 * twice, the honest pass names what stayed ambiguous. Counted as ignored.
 */
function unansweredClarification(state: SessionState, deps: SessionDeps, clarification: ClarificationEvent): SessionState {
  const gauge = { ...state.clarification, ignored: state.clarification.ignored + 1 };
  const since = state.transcript.indexOf(clarification);
  const replies = state.transcript.slice(since + 1).filter((event) => event.kind === "utterance" && event.source === "trainer").length;
  const labels = clarification.options.map((option) => `"${option.label}"`).join(", ");
  if (replies >= 2) {
    return note(
      closeExchange({ ...state, clarification: gauge }),
      deps,
      deps.now(),
      `I couldn't tell which you meant by "${clarification.about}", so I'll leave it there — ask it again in one line, naming it, and I'll answer what the records certify.`,
      "abstention",
      "clarification unanswered twice — exchange closed, nothing certified",
    );
  }
  return note(
    { ...state, clarification: gauge },
    deps,
    deps.now(),
    `I still need to know which you meant — say one of ${labels}, or ask me something else.`,
    "social",
    "reply matched no clarification option — question restated once",
  );
}

/**
 * The records' boundary, taught (R3b): the pack's reviewed lesson saying
 * what these records hold, filed as a grantless record like any lesson — the
 * "plain telling" a substitution would have hidden. A pack that names no
 * boundary lesson has already said what it can in the note; the exchange
 * closes there.
 */
function teachRecordsBoundary(state: SessionState, deps: SessionDeps, transactionId: string, establishedAt: string): SessionState {
  const lessonId = deps.world.pack.recordsBoundary?.lessonId;
  if (lessonId === undefined) return closeExchange(state);
  state = ledgerStep(state, deps, deps.now(), "driver", "boundary/taught", "the ask named what the records do not hold — the records-boundary lesson taught");
  return commit(state, deps, {
    transactionId,
    establishedAt,
    draft: { transactionId, claims: [{ kind: "explanation", blockId: lessonId }], rosters: [] },
  });
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
  // The way back across the boundary (found live, 2026-09-01: "let's go back
  // to Red/blue" carried the tokens but none of the context words, so per
  // the context discipline it bound nothing — and nothing ever re-asked, so
  // Yellow was write-once and the trainer was trapped behind a lesson that
  // read like an acknowledgment). A home-version token in the trainer's
  // latest words re-arms the pack's own question: one deterministic ask,
  // whose direct answer already binds with full authority and supersedes
  // the earlier one. Ambiguity ("my rival went back to Red") costs one
  // question, never a wrong bind.
  const switchback = homeVersionMentioned(deps.world, state);
  if (switchback !== undefined) {
    return ask(deps.world, state, deps, deps.now(), "version", switchback);
  }
  const attempt = await teachOrDiscover(state, deps, true);
  if (attempt.result === "taught" || attempt.result === "closed") return attempt.state;
  if (attempt.result === "off-domain") return redirect(attempt.state, deps);
  return teachBoundary(attempt.state, deps);
}

/** The pack's version question, when the trainer's latest words carry a
 * token of the home version group — the switch-back signal. Tokens without
 * context deliberately do not bind (lesson 1); here they earn the question
 * instead, which is free, deterministic and armed. */
function homeVersionMentioned(world: SessionWorld, state: SessionState): string | undefined {
  return versionMentioned(world, state, "home");
}

/** The pack's version question, when the trainer's latest words carry a
 * version token — the home group's only, or any group's. Read from the
 * vocabulary's own terms, so a pack that renames its versions moves this
 * door with it. */
function versionMentioned(world: SessionWorld, state: SessionState, which: "home" | "any"): string | undefined {
  const last = [...state.transcript].reverse().find((event) => event.kind === "utterance" && event.source === "trainer");
  if (last?.kind !== "utterance") return undefined;
  const rule = world.pack.vocabulary.dimensions.find((entry) => entry.dimension === "version");
  if (rule === undefined) return undefined;
  const home = world.registry.document.scope.versionGroup;
  const terms = which === "home" ? rule.terms.filter((entry) => entry.value === home) : rule.terms;
  const haystack = ` ${last.text.toLowerCase()} `;
  const mentioned = terms.some((term) =>
    term.tokens.some((token) => new RegExp(`\\b${token.split("-").join("[\\s-]?")}\\b`).test(haystack)),
  );
  return mentioned ? rule.question : undefined;
}

/**
 * Whether this exchange's trainer words are a statement of scope and nothing
 * else: no question mark or interrogative opener, no certified subject, and
 * every clause either bound a dimension (its normalised text is a binding's
 * matchedText) or is two tokens or fewer ("ok", "sorry" — filler, not an
 * ask). Deterministic and narrow on purpose — a miss falls to today's path,
 * a false hit would acknowledge an ask instead of answering it, so every
 * gate here is a hard one. (The first cut read only the vocabulary's
 * *unmatched* clauses, and "Build me a team of six Pokemon." — a clause
 * carrying the token "six" and binding nothing — slipped through.)
 */
function scopeStatementOnly(world: SessionWorld, state: SessionState): boolean {
  const exchange = state.transcript.slice(state.askStart);
  const words = exchange.filter(
    (event): event is Extract<ScopeEvent, { kind: "utterance" }> => event.kind === "utterance" && event.source === "trainer",
  );
  if (words.length === 0) return false;
  const derivation = deriveScope(world.pack, exchange);
  if (derivation.bindings.length === 0) return false;
  // Read, not merely bound: the correction that armed the question ("i
  // actually play red") is superseded by the answer that resolved it
  // ("red") and lands in `ignored` — still scope-talk, not an ask.
  const bound = new Set([...derivation.bindings, ...derivation.ignored].map((match) => match.matchedText));
  for (const said of words) {
    const text = said.text.trim();
    if (text.includes("?") || ASK_OPENER.test(text)) return false;
    if (namesCertifiedSubject(world.registry, text)) return false;
    for (const clause of clauseTexts(world.pack, text)) {
      if (!bound.has(clause) && clause.split(" ").length > 2) return false;
    }
  }
  return true;
}

/** The acknowledgment a bare statement of scope earns: what now stands
 * bound, in the trainer's terms, and the exchange closed — no model call,
 * no record, nothing to certify. */
function acknowledgeScope(world: SessionWorld, state: SessionState, deps: SessionDeps, keepExchange = false): SessionState {
  const labels: string[] = [];
  for (const binding of deriveScope(world.pack, state.transcript).bindings) {
    if (binding.dimension === "version") labels.push(binding.value === "yellow" ? "Yellow" : "Red/Blue");
    else if (binding.dimension === "region") labels.push(String(binding.value).replace(/^\w/, (c) => c.toUpperCase()));
    else if (binding.dimension === "badgeLevel") labels.push(binding.value === 0 ? "no badges yet" : `${String(binding.value)} badge${binding.value === 1 ? "" : "s"}`);
  }
  return note(
    keepExchange ? state : closeExchange(state),
    deps,
    deps.now(),
    `Got it — ${labels.length === 0 ? "noted" : labels.join(", ")}. ${keepExchange ? "Now, the question above is still waiting." : "Ask away whenever you're ready."}`,
    "social",
    "scope statement acknowledged — no ask to answer, nothing sent to the model",
  );
}

function teachBoundary(state: SessionState, deps: SessionDeps): SessionState {
  if (!deps.world.pack.curriculum.some((lesson) => lesson.id === BOUNDARY_LESSON)) {
    // A pack without the boundary block falls to the honest note — never a
    // fabricated lesson, and never the bare denial this path exists to spare.
    return note(
      closeExchange(state),
      deps,
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
  reuse?: Pick<ManifestDraft, "claims" | "rosters" | "suggestions"> & { routed?: boolean },
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

  // The ask, as the trainer worded it — what the deterministic doors read,
  // and what a retry is shown again.
  const currentAsk = state.transcript
    .slice(state.askStart)
    .flatMap((event) => (event.kind === "utterance" && event.source === "trainer" ? [event.text] : []))
    .join(" ");
  const previously = anaphorContext(world, state, currentAsk);
  const about = previousSubjects(world, state, currentAsk);
  // The exchange's FIRST utterance — the ask — is what the set guards read:
  // later utterances answer the pack's questions ("Red and Blue") and would
  // unbare it. (The listing cue door that read it here is gone — R3b, see
  // the discovery hop; a listing is the model's to nominate.)
  const openingAsk = state.transcript
    .slice(state.askStart)
    .find((event) => event.kind === "utterance" && event.source === "trainer");

  // The precedent door, once per exchange: a reused draft was already
  // proposed under the discovery call's precedents, which the exchange keeps.
  if (reuse === undefined) state = consultMemory(state, deps, currentAsk);

  let step;
  let stepRetried = false;
  let stepRefusedListing = false;
  if (reuse !== undefined) {
    // The discovery call already proposed this draft for these exact words,
    // and the scope it named was already granted — re-asking the model would
    // only pay a second generation for a fresh guess at the same question
    // (observed live: slower and sometimes less responsive than the draft it
    // replaced). The kernel compiles and verifies the reused draft exactly
    // as it would a fresh one; nothing about what may commit changes. Folds
    // and usage were already counted when the draft was decoded.
    // No mapping rides with a reused draft: the discovery hop already held
    // it to the fields the model linked, and a route composes its own shape.
    step = {
      usage: emptyUsage(),
      decode: {
        ok: true as const,
        draft: { transactionId, claims: reuse.claims, rosters: reuse.rosters, ...(reuse.suggestions === undefined ? {} : { suggestions: reuse.suggestions }) },
        folds: 0,
        asked: [],
      },
    };
  } else {
    try {
      const fallback = await withRouteFallback(world, state, deps, (routes, feedback, lessons) =>
        proposeAnswer({
          provider,
          context,
          scenarioId: "session",
          transactionId,
          // The ask being answered, not the whole session: scope reads the full
          // transcript, but the answer should be responsive to the current words.
          transcript: state.transcript.slice(state.askStart),
          ...precedentArg(state),
          ...(previously === undefined ? {} : { previously }),
          ...(about === undefined ? {} : { previousSubjects: about }),
          ...(routes === undefined ? {} : { routes }),
          ...(feedback === undefined ? {} : { feedback }),
          ...(lessons === undefined ? {} : { lessons }),
          ...(deps.grounded === undefined ? {} : { grounded: deps.grounded }),
          ...(deps.retrieval === undefined ? {} : { retrieval: deps.retrieval }),
          ...(deps.gatedGrammar === undefined ? {} : { gatedGrammar: deps.gatedGrammar }),
          ...(deps.clarify === undefined ? {} : { clarify: deps.clarify }),
          ...(deps.suggest === undefined ? {} : { suggest: deps.suggest }),
          ...(deps.prompt === undefined ? {} : { prompt: deps.prompt }),
        }),
      );
      // Both calls' usage rides on the step; the retry is counted below, and
      // the nomination it answered is already on the ledger.
      state = fallback.state;
      step = { ...fallback.step, usage: fallback.usage };
      stepRetried = fallback.retried;
      stepRefusedListing = fallback.refusedListing;
    } catch (cause) {
      return note(
        { ...closeExchange(state), providerErrors: state.providerErrors + 1 },
        deps,
        deps.now(),
        "I couldn't reach the model just now — nothing was lost on your side. Try that again in a moment.",
        "error",
        `the provider failed producing the answer (${cause instanceof Error ? cause.message : String(cause)})`,
      );
    }
  }

  let withUsage = ledgerStep(
    {
      ...state,
      usage: addUsage(state.usage, step.usage),
      folds: state.folds + (step.decode.ok ? step.decode.folds : 0),
      nominationRetries: state.nominationRetries + (stepRetried ? 1 : 0),
    },
    deps,
    deps.now(),
    "model",
    "model/answer",
    `${describeReply(step)}${stepRetried ? afterNomination(deps) : ""}`,
  );
  if (stepRefusedListing) withUsage = tallyListing(withUsage, "stoodDown");

  // Keyed on the exchange's opening ask: later utterances answer the pack's
  // questions ("Red and Blue") and would unbare a bare listing.
  const openingWords = openingAsk?.kind === "utterance" ? openingAsk.text : currentAsk;
  const exchange = { transactionId, establishedAt };

  let groomed = groom(world, withUsage, deps, step, currentAsk, openingWords, exchange, reuse === undefined && deps.feedback === true);
  let carriedBack = false;
  if (groomed.kind === "retry") {
    // The driver emptied the reply: one more call with the refusal named,
    // the door shut, groomed once more with no further retry (R3b, the
    // verifier-in-the-loop round, extended to the driver's own refusals).
    withUsage = groomed.state;
    let again: AnswerStep | undefined;
    try {
      again = await proposeAnswer({
        provider,
        context,
        scenarioId: "session",
        transactionId,
        transcript: state.transcript.slice(state.askStart),
        ...precedentArg(state),
        ...(previously === undefined ? {} : { previously }),
        ...(about === undefined ? {} : { previousSubjects: about }),
        feedback: groomed.feedback,
        ...lessonsArg(world, state, deps),
        ...(deps.grounded === undefined ? {} : { grounded: deps.grounded }),
        ...(deps.retrieval === undefined ? {} : { retrieval: deps.retrieval }),
        ...(deps.gatedGrammar === undefined ? {} : { gatedGrammar: deps.gatedGrammar }),
        ...(deps.clarify === undefined ? {} : { clarify: deps.clarify }),
        ...(deps.suggest === undefined ? {} : { suggest: deps.suggest }),
        ...(deps.prompt === undefined ? {} : { prompt: deps.prompt }),
      });
    } catch {
      withUsage = ledgerStep({ ...withUsage, providerErrors: withUsage.providerErrors + 1 }, deps, deps.now(), "model", "model/retry-failed", RETRY_FAILED);
    }
    withUsage = {
      ...withUsage,
      feedbackRetries: withUsage.feedbackRetries + 1,
      feedbackDenials: [...withUsage.feedbackDenials, ...groomed.feedback.filter((line) => line.startsWith("driver/")).map((line) => line.split(":")[0]!)],
    };
    carriedBack = true;
    if (again === undefined) {
      // The provider failed on the round: the first reply's honest reading stands.
      groomed = groom(world, withUsage, deps, step, currentAsk, openingWords, exchange, false);
    } else {
      withUsage = ledgerStep(
        { ...withUsage, usage: addUsage(withUsage.usage, again.usage), folds: withUsage.folds + (again.decode.ok ? again.decode.folds : 0) },
        deps,
        deps.now(),
        "model",
        "model/retry",
        `${describeReply(again)} — the reply after ${fedBack(groomed.feedback.filter((line) => line.startsWith("driver/")).length)}`,
      );
      groomed = groom(world, withUsage, deps, again, currentAsk, openingWords, exchange, false);
    }
    if (groomed.kind === "retry") throw new Error("unreachable: an un-retryable groom asked to retry");
  }
  if (groomed.kind === "settled") return groomed.state;
  withUsage = groomed.state;

  // The scope escalation, generalized (epic #64, slice 2). The proposed answer
  // may depend on a dimension the grant does not hold — a ranking with no basis
  // established, an eligibility ruling reached after only a version was asked.
  // The kernel would refuse such a draft by name (scope-dimension-missing, or
  // ranking-basis-not-established), so nothing rests on this branch; it exists
  // so the exchange gathers exactly what the drafted claims require and costs
  // the visitor a question rather than a denial. The trigger is the claims'
  // declared dependencies, never the wording; a miss costs a question, never a
  // wrongly scoped commit, which the manifest gate holds.
  const unbound = (draft: ManifestDraft): readonly ScopeDimension[] =>
    requiredDimensionsFor(draft.claims).filter((dimension) => resolved.grant.scope[dimension] === undefined);
  if (unbound(groomed.draft).length > 0) {
    return drive({ ...withUsage, required: requiredDimensionsFor(groomed.draft.claims) }, deps);
  }

  let ran = probe(withUsage, deps, { ...exchange, draft: groomed.draft });

  // The verifier-in-the-loop retry (docs/routing.md, R3b). The kernel's
  // denial names exactly why — "gym-badge" is not a certified species — and
  // until now the driver threw that signal away. One more call carries it
  // back in fixed wording; the second reply is groomed and verified exactly
  // as the first, so the loop can only turn a denial into a certified answer
  // or an honest pass, never into a pass by trial and error. Only for a draft
  // the model wrote — a route-composed one has no reply to correct; a
  // discovery draft carried in through the version question does, and that
  // is exactly the porch's "what's a gym badge?" dying on its first round —
  // only at the answer stage, never for the repair's own class, and never
  // with the route door open: a nomination is not a correction.
  if (reuse?.routed !== true && deps.feedback === true && !carriedBack && feedbackEligible(ran.record)) {
    const violations = ran.record.outcome.status === "denied" ? ran.record.outcome.violations : [];
    const codes = violations.map(denialCode);
    // The kernel's own messages ride on the step, so the trail shows what was
    // sent back — "gym-badge" is not a certified species — not just a code.
    withUsage = ledgerStep(
      withUsage,
      deps,
      deps.now(),
      "kernel",
      "verdict/denied",
      `the kernel denied the draft: ${codes.join(", ")} — carried back to the model once`,
      undefined,
      violations.map((item) => `${denialCode(item)}: ${item.message}`),
    );
    let again: AnswerStep | undefined;
    try {
      again = await proposeAnswer({
        provider,
        context,
        scenarioId: "session",
        transactionId,
        transcript: state.transcript.slice(state.askStart),
        ...precedentArg(state),
        ...(previously === undefined ? {} : { previously }),
        ...(about === undefined ? {} : { previousSubjects: about }),
        feedback: violations.map((item) => `${denialCode(item)}: ${item.message}`),
        ...lessonsArg(world, state, deps),
        ...(deps.grounded === undefined ? {} : { grounded: deps.grounded }),
        ...(deps.retrieval === undefined ? {} : { retrieval: deps.retrieval }),
        ...(deps.gatedGrammar === undefined ? {} : { gatedGrammar: deps.gatedGrammar }),
        ...(deps.clarify === undefined ? {} : { clarify: deps.clarify }),
        ...(deps.suggest === undefined ? {} : { suggest: deps.suggest }),
        ...(deps.prompt === undefined ? {} : { prompt: deps.prompt }),
      });
    } catch {
      // The first denial is a complete, honest record; a provider that fails
      // on the retry files it as it stands, and the failure is counted.
      withUsage = ledgerStep({ ...withUsage, providerErrors: withUsage.providerErrors + 1 }, deps, deps.now(), "model", "model/retry-failed", RETRY_FAILED);
    }
    if (again !== undefined) {
      withUsage = ledgerStep(
        {
          ...withUsage,
          usage: addUsage(withUsage.usage, again.usage),
          folds: withUsage.folds + (again.decode.ok ? again.decode.folds : 0),
          feedbackRetries: withUsage.feedbackRetries + 1,
          feedbackDenials: [...withUsage.feedbackDenials, ...codes],
        },
        deps,
        deps.now(),
        "model",
        "model/retry",
        `${describeReply(again)} — the reply after ${fedBack(codes.length)}`,
      );
      const regroomed = groom(world, withUsage, deps, again, currentAsk, openingWords, exchange, false);
      if (regroomed.kind === "settled") return regroomed.state;
      if (regroomed.kind === "retry") throw new Error("unreachable: an un-retryable groom asked to retry");
      withUsage = regroomed.state;
      if (unbound(regroomed.draft).length > 0) {
        return drive({ ...withUsage, required: requiredDimensionsFor(regroomed.draft.claims) }, deps);
      }
      ran = probe(withUsage, deps, { ...exchange, draft: regroomed.draft });
    }
  }

  return fileProbe(withUsage, deps, exchange, ran);
}

/** Whether a probe's denial is the feedback retry's to answer: denied at the
 * answer stage, for anything but the repair's own all-fact-mismatch class. */
function feedbackEligible(record: Transaction): boolean {
  if (record.outcome.status !== "denied" || record.outcome.stage !== "answer") return false;
  const violations = record.outcome.violations;
  if (violations.length === 0) return false;
  return !violations.every((item) => item.article === "IA-2" && item.rule === "fact-mismatch");
}

type Groomed =
  | { kind: "settled"; state: SessionState }
  | { kind: "draft"; state: SessionState; draft: ManifestDraft }
  /** The driver emptied the reply; carry the refusal back once. */
  | { kind: "retry"; state: SessionState; feedback: readonly string[] };

/**
 * One answer-step reply, made into the draft the seam will judge — or the
 * settled exchange it earns instead. The schema linking first (R3b), then
 * the doors' guards: a nomination composes, a gated advisory ask gets the
 * pack's rule appended, a matchup's direction is held to the ask's word
 * order, a wrong-set catalogue is dropped, padding lessons are trimmed.
 * Every step here is deterministic and counted; the kernel still verifies
 * whatever leaves.
 * Shared by the first reply and the feedback retry so the two are groomed
 * identically — a retry that skipped a guard would be a second door.
 */
function groom(
  world: SessionWorld,
  state: SessionState,
  deps: SessionDeps,
  step: AnswerStep,
  ask: string,
  openingWords: string,
  exchange: { transactionId: string; establishedAt: string },
  /** Whether an emptied reply may be carried back once (see {@link applyLinking}). */
  retryable = false,
): Groomed {
  const { transactionId, establishedAt } = exchange;
  const honestPass = (withNote: SessionState, detail: string): Groomed => ({
    kind: "settled",
    state: note(
      closeExchange(withNote),
      deps,
      deps.now(),
      "I don't have a certified answer for that one, so I'd rather pass than guess. " +
        "A specific Pokémon, a move, or a how-the-game-works question usually lands.",
      "abstention",
      detail,
    ),
  });

  if (!step.decode.ok) {
    // Before conceding an abstention, let the pack answer what it can: a
    // gated advisory ask has a deterministic, certified answer — the rule.
    const routed = eligibilityClaims(world, ask, []);
    if (routed.length === 0) return honestPass(state, `the model produced no usable answer (${step.decode.reason}) — nothing was committed`);
    return { kind: "draft", state, draft: { transactionId, claims: routed, rosters: [] } };
  }

  const linked = applyLinking(world, state, deps, step.decode, retryable);
  state = linked.state;
  if (linked.verdict === "retry") return { kind: "retry", state, feedback: linked.feedback ?? [] };
  if (linked.verdict === "closed" || linked.verdict === "clarifying") return { kind: "settled", state };
  // The anaphoric redirect names what is missing — the antecedent — the way
  // the discovery hop's does; the answer hop had fallen to the generic menu.
  if (linked.verdict === "off-domain") return { kind: "settled", state: redirect(state, deps, pointsBack(world, state, ask)) };
  if (linked.verdict === "boundary") return { kind: "settled", state: teachRecordsBoundary(state, deps, transactionId, establishedAt) };
  const decode = { ...step.decode, draft: { ...step.decode.draft, claims: linked.claims } };

  // A nomination at the scoped hop composes here too — same door, same
  // validation, same kernel downstream; an invalid one is simply ignored.
  const nominated = decode.route !== undefined ? executeRoute(world, state, decode.route) : undefined;
  if (decode.route !== undefined && nominated !== undefined) {
    state = ledgerStep(
      state,
      deps,
      deps.now(),
      "driver",
      nominated.ok ? "route/served" : "route/refused",
      nominated.ok
        ? `the "${decode.route.routeId}" door composed ${nominated.claims.length} claim(s) from the records`
        : `the "${decode.route.routeId}" door was refused: ${nominated.reason}${decode.draft.claims.length === 0 ? " — and the reply carried nothing else" : " — the claims beside it stand on their own"}`,
    );
  }
  if (nominated !== undefined && !nominated.ok && decode.draft.claims.length === 0) {
    // A refused nomination with nothing beside it: the same honest pass an
    // empty reply earns, with the countable line in the detail register.
    return honestPass(state, "the model nominated a route the driver refused, and the reply carried nothing else — nothing was committed");
  }
  const served = nominated?.ok === true ? nominated : undefined;
  if (decode.route?.routeId === "listing") {
    state = tallyListing(state, served !== undefined ? "served" : "stoodDown");
  }
  const decoded = served !== undefined ? { ...decode.draft, claims: served.claims, rosters: served.rosters } : decode.draft;
  // A model that deflected a gated advisory ask into adjacent facts gets the
  // on-target answer appended; one that addressed the species advice-wise —
  // including by proposing the gated advice the kernel will deny — is left
  // alone, so the route never softens a denial the gate has earned.
  const routed = eligibilityClaims(world, ask, decoded.claims);
  const directed = correctMatchupDirections(world, ask, decoded.claims);
  const rightSet = dropWrongSetClaims(world, openingWords, { claims: directed.claims, rosters: decoded.rosters });
  if (directed.flips > 0) state = ledgerStep(state, deps, deps.now(), "driver", "guard/direction-flipped", `${directed.flips} matchup direction(s) held to the ask's word order`, directed.flips);
  if (rightSet.claims.length < directed.claims.length) {
    state = tallyListing(state, "guardDropped");
    state = ledgerStep(state, deps, deps.now(), "driver", "guard/wrong-set-dropped", `${directed.claims.length - rightSet.claims.length} catalogue claim(s) about the wrong set dropped`, directed.claims.length - rightSet.claims.length);
  }
  if (rightSet.claims.length === 0 && directed.claims.length > 0) {
    // The guard emptied the draft: everything it carried was the wrong
    // set. An honest pass, never an empty certificate.
    return honestPass(state, "the wrong-set guard removed every claim the draft carried — nothing was committed");
  }
  const groomed = { ...decoded, rosters: rightSet.rosters, claims: trimPaddedLessons(world, ask, rightSet.claims) };
  if (groomed.claims.length < rightSet.claims.length) state = ledgerStep(state, deps, deps.now(), "driver", "guard/padding-trimmed", `${rightSet.claims.length - groomed.claims.length} padding lesson(s) trimmed`, rightSet.claims.length - groomed.claims.length);
  if (routed.length > 0) state = ledgerStep(state, deps, deps.now(), "driver", "guard/eligibility-appended", `the pack's rule appended to a gated advisory ask: ${routed.length} claim(s)`, routed.length);
  if (directed.flips > 0) state = { ...state, flips: state.flips + directed.flips };
  // (The deflected-profile backstop that stood here too is gone — R3b step
  // 5. A lesson the model composed at this hop is the lesson it composed.)
  const draft = routed.length === 0 ? groomed : { ...groomed, claims: [...groomed.claims, ...routed] };
  // Last, the follow-ups (R3b step 4): guarded onto whatever shape the
  // guards settled on, so a next step rides with every certified answer.
  const suggested = withSuggestions(world, state, deps, decode, draft);
  return { kind: "draft", state: suggested.state, draft: suggested.draft };
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
  return fileProbe(state, deps, exchange, probe(state, deps, exchange));
}

/** One pass through the seam, with the repair: what {@link commit} judges
 * before it files. Separated so the feedback retry can look at a denial and
 * ask the model once more before anything is filed. */
interface Probe {
  record: Transaction;
  planned: ManifestDraft;
  committedAt: string;
  renderedAt: string;
  repaired: boolean;
}

function probe(
  state: SessionState,
  deps: SessionDeps,
  exchange: { transactionId: string; establishedAt: string; draft: ManifestDraft },
): Probe {
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
  let repaired = false;

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
      repaired = true;
    }
  }
  return { ...ran, planned, repaired };
}

/** File what a probe judged: the exchange's record, or the pause for
 * consent. The mis-recall a repair fixed stays on the books here — whatever
 * files is a post-repair outcome, and the accounting never blends the two. */
function fileProbe(
  state: SessionState,
  deps: SessionDeps,
  exchange: { transactionId: string; establishedAt: string },
  ran: Probe,
): SessionState {
  const { transactionId, establishedAt } = exchange;
  if (ran.repaired) state = ledgerStep({ ...state, repairs: state.repairs + 1 }, deps, deps.now(), "driver", "repair/strip-assertion", "a mis-recalled value was stripped and the gate run once more — the certified value read");
  // The memory's reading, for a draft the kernel accepted (docs/precedent.md).
  if (ran.record.outcome.status === "answered" || ran.record.outcome.status === "declined") state = readMemory(state, deps, ran.planned);
  const { record, committedAt, renderedAt, planned } = ran;
  if (record.outcome.status === "declined") state = ledgerStep(state, deps, deps.now(), "driver", "act/consent-requested", "the page carries an act — attested, held for the trainer's consent");
  switch (record.outcome.status) {
    case "answered": {
      // No acts proposed: the probe is the exchange's record. The certified
      // page is rendered for display through the same planner the verifier
      // rules with — the record does not need it, the visitor does.
      return file(state, deps, record, displayPage(deps.world, record));
    }
    case "declined": {
      // Acts proposed and attested; the decline is the probe's, not the
      // visitor's. Hold the page and wait for the person.
      const artifact = record.artifact;
      if (artifact === undefined) return file(state, deps, record); // unreachable: declined carries its page
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
      return file(state, deps, record, displayPage(deps.world, record));
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
