/**
 * Driving one bank question through the real session spine (epic #45, wave 2).
 *
 * The playability bank measures the *whole* player experience, so it runs the
 * question through exactly the code the live page runs — `startSession`, `say`,
 * `decideScope`, `decideAct` from src/session — not a shortcut. The only thing
 * this adds is the counterparty: a truthful trainer who answers the pack's
 * clarifying questions from the entry's profile and confirms an interpretation
 * only when it matches (reusing `candidateIsTrue`). The opening is just the
 * question — no profile stated up front — so scope is established the way a real
 * player's would be, through the answer route (§16), and the friction the map
 * reports is the friction a player would actually feel.
 *
 * The run is then read as a funnel stage and scored against the entry's
 * disposition (see playability.ts). No model in that scoring — a stage is read
 * from the record, exactly as replay reads.
 */

import type { Claim, ClarificationOption, ScopeDimension, TrainerScope } from "../kernel/contracts.js";
import { deriveScope } from "../kernel/scope.js";
import type { ModelProvider } from "./provider.js";
import type { DemoWorld } from "../demo/script.js";
import {
  decideAct,
  decideScope,
  say,
  type SessionDeps,
  type SessionState,
  setProfile,
  startSession,
} from "../session/session.js";
import { candidateIsTrue } from "./trainer.js";
import { ledgerOf } from "../session/ledger.js";
import { defaultFixedIds, type PrecedentLevers, type PrecedentStore } from "../memory/precedent.js";
import type { BankEntry, ClaimKind } from "./bank.js";
import { type Ceremony, ceremonyOf } from "./ceremony.js";
import {
  committedGatedAdvice,
  type Disposition,
  type DispositionScore,
  eligibilityAnswered,
  type ExpectedFact,
  type FunnelStage,
  funnelOf,
  resolvedOnFact,
  resolvedOnFactIn,
  resolvedOnShape,
  resolvedOnShapeIn,
  routedLesson,
  routedLessonIn,
  scoreDisposition,
} from "./playability.js";
import type { HarnessRun, RunStatus } from "./run.js";

/** Bound on how many turns one exchange may take before it is abandoned as
 * scope friction. Generous: a cooperative trainer settles in a handful, and
 * only a model that cannot make progress hits it. */
const MAX_STEPS = 16;

/** One bank question, run and judged. */
export interface BankRun {
  entryId: string;
  disposition: Disposition;
  /** The wording actually asked — the canonical intent, or the paraphrase a
   * robustness pass chose. */
  opening: string;
  /** Which pass this sample came from, when the run repeated; 0 otherwise. */
  repetition: number;
  stage: FunnelStage;
  score: DispositionScore;
  /** Model calls made — the friction number, per entry. */
  turns: number;
  /** What the trainer endured, read from the record (epic #94, slice 5).
   * Optional: artifacts filed before this existed read unchanged. */
  ceremony?: Ceremony;
  /** True when the outcome followed a strip-assertion repair (docs/recovery.md,
   * channel 2) — a post-repair resolution, counted apart from first-attempt
   * ones so the retry can never launder the model's mis-recall rate. */
  repaired?: boolean;
  /** True when the outcome followed a degenerate-comparison fold at decode
   * (Center loop 2) — the self-pair folded to the fact it means, counted for
   * the same never-blend reason `repaired` is. */
  folded?: boolean;
  /** True when the outcome followed a verifier-in-the-loop retry (docs/
   * routing.md, R3b) — a post-feedback resolution, counted apart like the
   * repair; `firstAttemptDenials` keeps what the first attempt was refused
   * for, so the enforcement number still measures first attempts. */
  feedbackRetried?: boolean;
  firstAttemptDenials?: readonly string[];
  /** Field-bearing claims the schema linking dropped as off the asked fields
   * (R3b) — the substitution class, as a per-entry number. */
  offTargetDropped?: number;
  /**
   * For a run the kernel denied: whether the refused draft, read by the
   * entry's own oracle, would have counted as an answer to this question
   * had it been published — the gate's own removal of a believed answer,
   * which is the kernel-only half of the governance tax (tax.ts,
   * `gateRemoved`). Read from the record's refused draft (IA-10); absent
   * when the run was not denied or kept no draft.
   */
  deniedDraftOnTarget?: boolean;
  /** The advisor's own questions on this run (R3b step 3), from the driver's
   * gauge, and how the truthful trainer fared: `picked` when an option held
   * the entry's truth, `ignored` when none did — the model asked a question
   * whose answers did not include the right one — and `capped` when the
   * driver refused a third. Present when the clarify door was open. */
  clarified?: { asked: number; picked: number; ignored: number; capped: number };
  /** Follow-up suggestions (R3b step 4): `shown` is read from the record —
   * the certified answer's manifest — and `dropped` from the driver's gauge,
   * the offenders the topic-not-value rule removed. Present when the suggest
   * door was open. */
  suggestions?: { shown: number; dropped: number };
  /**
   * The precedent door's reading (docs/precedent.md), present when the door
   * was open: `held` is the precedents the exchange's calls carried, by id
   * (empty: the door engaged nothing — the activation ceiling, per run);
   * `followed` whether the accepted answer took a held example's shape,
   * absent when nothing was held or no record was filed.
   */
  precedents?: { held: readonly string[]; followed?: boolean };
  /** One human line on how it ended, for the report's detail column. */
  detail: string;
}

/** The dials a bank run threads to the session, all off by default so a
 * scripted run in CI measures the bare spine. Each one that changes what the
 * number means travels with the artifact. */
export interface BankRunOptions {
  /** Hand the proposer the whole certified registry to compose from. */
  grounded?: boolean;
  /** Ground with only the rows each question needs. */
  retrieval?: boolean;
  /** Narrow the answer grammar to the kinds each question nominates. */
  gatedGrammar?: boolean;
  /** Strip-assertion resubmit on an all-fact-mismatch denial (docs/recovery.md). */
  repair?: boolean;
  /** The trainer's profile set on the panel before the opener (epic #145, R2). */
  profile?: boolean;
  /** The verifier-in-the-loop retry (docs/routing.md, R3b). */
  feedback?: boolean;
  /** The model may ask its own clarifying question (R3b step 3); the truthful
   * trainer answers it from the entry's oracle ({@link truthfulPick}). */
  clarify?: boolean;
  /** The model may offer follow-up suggestions (R3b step 4); the bank's
   * trainer never takes one — what is measured is whether they are offered. */
  suggest?: boolean;
  /**
   * The precedent door (docs/precedent.md): the operator's store, held on
   * every answer call as worked examples. `nearest` retrieves per ask;
   * `fixed` holds the same few on every call (the few-shot control arm).
   * The hold-out rule is applied per entry here: a precedent made from the
   * entry under test, or worded as it, is never offered to it.
   */
  precedents?: { store: PrecedentStore; mode: "nearest" | "fixed"; levers?: PrecedentLevers; fixed?: readonly string[] };
}

/** A bank run still carrying the whole record behind its verdict — transcript,
 * usage and, when one was reached, the transaction replay re-executes. This is
 * what a filed artifact stores: a summary would be a press release (see
 * artifact.ts); the aggregation (`coverageMap`) needs only the {@link BankRun}
 * summary, which is why the two are separate types. */
export interface RecordedBankRun extends BankRun {
  run: HarnessRun;
}

/** What the trainer says when the pack asks about a dimension — the profile
 * value, worn plainly so the answer route binds it. Exported for a direct test
 * of the comparison-basis wording. */
export function profileWord(dimension: ScopeDimension, profile: TrainerScope): string {
  switch (dimension) {
    case "version":
      return String(profile.version);
    case "region":
      return String(profile.region);
    case "badgeLevel":
      return String(profile.badgeLevel);
    case "comparisonBasis":
      // The basis value ("base-speed") is not itself a vocabulary token; its
      // words are. Strip the prefix and the hyphens so the answer route matches.
      return (profile.comparisonBasis ?? "base-speed").replace(/^base-/, "").replace(/-/g, " ");
  }
}

function wantsAct(entry: BankEntry): boolean {
  return (entry.expectClaimKinds ?? []).includes("action");
}

/**
 * What the truthful trainer says when the model asks which reading it meant
 * (R3b step 3) — read from the entry's oracle, never from the options'
 * wording (lesson 3: the simulated truthful user verifies every pinned
 * dimension). A field option is right when the entry expects a fact in that
 * field or ranks by it; a no-field option is right when the entry expects a
 * lesson and no fact; a subject option is right when the oracle accepts that
 * subject or the trainer's own question named it. The first right option is
 * the pick. None right means the model asked a question whose answers do not
 * include the truth, and the trainer says so ({@link NO_HONEST_PICK}) rather
 * than guess — a pick from nothing would be the simulated user answering
 * only the interesting dimension.
 */
export function truthfulPick(entry: BankEntry, opening: string, options: readonly ClarificationOption[]): ClarificationOption | undefined {
  const facts = entry.expectFacts ?? [];
  const kinds = entry.expectClaimKinds ?? [];
  const fields = new Set([
    ...facts.flatMap((fact) => (fact.factId === undefined ? [] : [fact.factId])),
    ...(entry.profile.comparisonBasis === undefined ? [] : [entry.profile.comparisonBasis]),
  ]);
  const lessonOnly = kinds.includes("explanation") && !kinds.includes("fact") && facts.length === 0;
  const named = (id: string): boolean => new RegExp(`(^|[^a-z0-9])${id.replace(/-/g, "[ -]")}([^a-z0-9]|$)`, "i").test(opening);
  return options.find((option) =>
    option.kind === "field"
      ? option.fieldId === null
        ? lessonOnly
        : fields.has(option.fieldId)
      : facts.some((fact) => fact.entityId === option.entityId) || named(option.entityId),
  );
}

/** The truthful trainer's reply when no option is right. Plain words that
 * carry no option label, field alias or subject name, so the driver reads
 * it as no pick, restates once, and closes — the honest outcome of a
 * question with no honest answer, at no model cost. */
export const NO_HONEST_PICK = "neither of those";

/**
 * The disposition oracle a scoring pass reads: the expected disposition, and —
 * for the resolving/refusing ones — the claim kinds and lessons a right answer
 * asserts. A {@link BankEntry} is one; so is a dialogue turn, which is why this
 * is the shape {@link scoreOracle} takes rather than the whole entry. Keeping
 * the two on one function is what stops single-turn and multi-turn scoring from
 * drifting apart.
 */
export interface DispositionOracle {
  disposition: Disposition;
  expectClaimKinds?: readonly ClaimKind[];
  expectBlockIds?: readonly string[];
  /** For entries expecting a `fact`: the certified facts any of which an
   * on-target answer asserts — the subject oracle, parallel to
   * `expectBlockIds` for lessons (epic #87, slice 1). */
  expectFacts?: readonly ExpectedFact[];
}

/**
 * The disposition score, then the routing oracle on top.
 *
 * Routing accuracy only ever narrows: a resolution that committed no lesson
 * the oracle accepts is a mis-teach — reviewed text on the wrong subject, the
 * curriculum's own species of deflection — and it may not ride a "resolved"
 * bucket into a pass. The override runs one way; nothing here can turn a fail
 * into a pass.
 */
export function scoreOracle(oracle: DispositionOracle, run: HarnessRun, world: DemoWorld, stage: FunnelStage): DispositionScore {
  // The records-boundary lesson, taught alone, is the honest answer to a
  // needs-data question (epic #145, R3) — a resolution in the record's
  // mechanics that scores as the abstention it means.
  const boundaryLesson = world.pack.recordsBoundary?.lessonId;
  const boundaryTaught =
    boundaryLesson !== undefined &&
    routedLesson(run, [boundaryLesson]) &&
    (run.transaction?.manifest?.claims ?? []).every((claim) => claim.kind === "explanation" && claim.blockId === boundaryLesson);
  const score = scoreDisposition(
    oracle.disposition,
    stage,
    committedGatedAdvice(run, world),
    eligibilityAnswered(run, world),
    boundaryTaught,
  );
  // The overrides judge a *resolution*'s target; a pass earned by a named
  // denial or an honest abstention (a should-refuse, a needs-data) is left
  // exactly as scored.
  if (!score.pass || stage.kind !== "resolved") return score;
  // A resolution still has to be on target. Two one-way pass→fail overrides,
  // neither able to turn a fail into a pass: the curriculum's own deflection (a
  // lesson on the wrong subject) and the shape deflection (a lesson, or any
  // other prose, where the question asked for a count/fact/matchup). Both are
  // "resolved, on the wrong subject" — the same family, one axis apart.
  if (!routedLesson(run, oracle.expectBlockIds)) {
    return { pass: false, reason: "resolved, but no lesson this question accepts was taught — a mis-teach" };
  }
  if (!resolvedOnShape(run, oracle.expectClaimKinds)) {
    return {
      pass: false,
      reason: `resolved, but committed no ${(oracle.expectClaimKinds ?? []).join("/")} — prose where a structured answer was asked (a shape deflection)`,
      shapeDeflection: true,
    };
  }
  // The subject check (epic #87, slice 1): the right shape came back, but was
  // it about the right thing? An answer that rode a *different* expected kind
  // (the Zapdos question passing on a membership) is judged by that kind's own
  // oracle, never failed here for lacking a fact it did not need.
  if (!resolvedOnFact(run, oracle.expectFacts) && !answeredThroughOtherKind(run, oracle.expectClaimKinds)) {
    return {
      pass: false,
      reason: "resolved, but no certified fact this question accepts — right shape, wrong subject (a subject deflection)",
      subjectDeflection: true,
    };
  }
  return score;
}

/** Whether a draft's claims answer this entry by its own oracle — lesson,
 * shape and subject, the same checks a resolution faces — regardless of
 * truth, which is the kernel's to judge and which it already has. */
export function draftOnTarget(entry: BankEntry, claims: readonly Claim[]): boolean {
  if (claims.length === 0) return false;
  if (entry.disposition !== "answerable" && entry.disposition !== "advisory") return false;
  return (
    routedLessonIn(claims, entry.expectBlockIds) &&
    resolvedOnShapeIn(claims, entry.expectClaimKinds) &&
    (resolvedOnFactIn(claims, entry.expectFacts) || answeredThroughOtherKindIn(claims, entry.expectClaimKinds))
  );
}

/** Whether the certificate carries a claim of an expected kind other than
 * `fact` — the escape hatch that keeps the subject check from failing an
 * answer the question accepts through another route. */
function answeredThroughOtherKind(run: HarnessRun, expected: readonly ClaimKind[] | undefined): boolean {
  const manifest = run.transaction?.manifest;
  if (manifest === undefined) return false;
  return answeredThroughOtherKindIn(manifest.claims, expected);
}

/** {@link answeredThroughOtherKind} over claims — shared with the raw arm
 * (bank-raw.ts), which holds published claims to the same oracle. */
export function answeredThroughOtherKindIn(claims: readonly Claim[], expected: readonly ClaimKind[] | undefined): boolean {
  if (expected === undefined) return false;
  // `treats` is excluded: it now has its own subject oracle inside
  // resolvedOnFact (the itemId must match an accepted entity), so letting it
  // ride the escape hatch would waive exactly the discipline it just gained —
  // a verdict about the wrong item would pass on shape alone.
  return claims.some((claim) => claim.kind !== "fact" && claim.kind !== "treats" && expected.includes(claim.kind));
}

/** Drive the session to a settled state, answering as the trainer would. The
 * opening is one phrasing of the question — the canonical intent, or a variant
 * when robustness is being measured. */
async function play(entry: BankEntry, opening: string, deps: SessionDeps, profile = false): Promise<SessionState> {
  // The profile mode (epic #145, R2): the trainer set their version, region
  // and badges on the panel before asking, so no pack question about them is
  // owed. The entry's profile is the same one the question-answering trainer
  // reads from — only the channel changes, from prose to the typed form.
  let state = profile
    ? await setProfile(
        startSession(),
        { version: entry.profile.version, region: entry.profile.region, badgeLevel: entry.profile.badgeLevel },
        deps,
      )
    : startSession();
  state = await say(state, opening, deps);
  const acts = wantsAct(entry);

  for (let step = 0; step < MAX_STEPS; step += 1) {
    const phase = state.phase;
    if (phase.kind === "gathering") break; // settled: a record filed, or an abstention noted
    if (phase.kind === "asking") {
      state = await say(state, profileWord(phase.dimension, entry.profile), deps);
    } else if (phase.kind === "confirming-scope") {
      const decision = candidateIsTrue(phase.proposal.candidate, entry.profile) ? "confirm" : "reject";
      state = await decideScope(state, decision, deps);
    } else if (phase.kind === "confirming-act") {
      // No ask, no consent: the trainer confirms an act only when it is the one
      // they came for, and declines a surprise — the honest-trainer discipline.
      state = await decideAct(state, acts ? "confirm" : "decline", deps);
    } else if (phase.kind === "clarifying") {
      // The model's own question (R3b step 3): answered from the oracle, or
      // declined in plain words when no option holds the truth.
      const pick = truthfulPick(entry, opening, phase.clarification.options);
      state = await say(state, pick === undefined ? NO_HONEST_PICK : pick.label, deps);
    }
  }
  return state;
}

/** Read a settled session as the minimal run the funnel needs. Exported so the
 * record-shape and friction branches are testable without a live session. */
export function asRun(entry: BankEntry, state: SessionState, world: DemoWorld, repetition = 0): HarnessRun {
  const record = state.records.at(-1);
  const opening = state.transcript.slice(state.askStart).find((event) => event.kind === "utterance" && event.source === "trainer");
  const base = {
    scenarioId: entry.id,
    providerId: "bank",
    repetition,
    transcript: state.transcript,
    turns: state.usage.calls,
    providerErrors: state.providerErrors,
    usage: state.usage,
    // The driver's steps, per exchange — the open one filed as `open` so an
    // abstention's trail is in the record too.
    exchanges: ledgerOf(state, opening?.kind === "utterance" ? opening.text : ""),
  };

  if (record !== undefined) {
    const status: RunStatus =
      record.outcome.status === "answered"
        ? "answered"
        : record.outcome.status === "acted"
          ? "acted"
          : record.outcome.status === "denied"
            ? "denied"
            : "unresolved";
    return {
      ...base,
      status,
      detail: record.outcome.status,
      transaction: record,
      ...(record.grant === undefined ? {} : { grantScope: record.grant.scope }),
    };
  }

  // No record — an abstention. Whether scope had closed distinguishes friction
  // (never established) from an answer-step abstention. Derive it from the
  // bindings rather than minting a grant: a grant carries a timestamp and would
  // be refused for predating the answers it rests on, which is a fact about
  // clocks, not about whether the trainer established their scope.
  //
  // The floor is `version`, not the full triple (epic #64, slice 2): scope is
  // now gathered per the answer's own dependencies, so a fact abstention closes
  // only the version it needed. Every scoped answer depends on version, and
  // only an off-domain redirect — which attempts no scoped answer at all —
  // binds nothing, so `version` established is exactly "the answer stage was
  // reached."
  const bound = new Set(deriveScope(world.pack, state.transcript).bindings.map((binding) => binding.dimension));
  const scopeClosed = bound.has("version");
  const detail = state.notes.at(-1)?.text ?? "no answer produced";
  return {
    ...base,
    status: "unresolved",
    detail,
    ...(scopeClosed ? { grantScope: entry.profile } : {}),
  };
}

/** Every wording of a question the bank carries — the canonical intent first,
 * then any frozen paraphrases. Robustness is measured over this list. */
export function phrasingsOf(entry: BankEntry): readonly string[] {
  return [entry.intent, ...(entry.phrasings ?? [])];
}

/** Run one phrasing of one entry and score it. `now` is injected, so a run
 * replays; `opening` defaults to the canonical intent. */
export async function runBankEntry(
  world: DemoWorld,
  entry: BankEntry,
  provider: ModelProvider,
  now: () => string,
  opening: string = entry.intent,
  repetition = 0,
  options: BankRunOptions = {},
): Promise<RecordedBankRun> {
  const deps: SessionDeps = {
    world,
    provider,
    now,
    grounded: options.grounded ?? false,
    retrieval: options.retrieval ?? false,
    gatedGrammar: options.gatedGrammar ?? false,
    repair: options.repair ?? false,
    feedback: options.feedback ?? false,
    ...(options.clarify === undefined ? {} : { clarify: options.clarify }),
    ...(options.suggest === undefined ? {} : { suggest: options.suggest }),
    ...(options.precedents === undefined
      ? {}
      : {
          precedents: {
            store: options.precedents.store,
            ...(options.precedents.levers === undefined ? {} : { levers: options.precedents.levers }),
            // The hold-out rule, per entry: never the entry's own precedents,
            // under any of its wordings — so a precedent can only ever teach
            // a neighbour, never answer for itself.
            holdOut: { entryId: entry.id, phrasings: phrasingsOf(entry) },
            ...(options.precedents.mode === "fixed" ? { fixed: options.precedents.fixed ?? defaultFixedIds(options.precedents.store, world.registry.snapshot.id) } : {}),
          },
        }),
  };
  const state = await play(entry, opening, deps, options.profile ?? false);
  const run = asRun(entry, state, world, repetition);
  const { asked, picked, ignored, capped } = state.clarification;
  const shown = run.transaction?.manifest?.suggestions?.length ?? 0;
  const stage = funnelOf(run, wantsAct(entry));
  const refused = stage.kind === "denied" ? run.transaction?.refused?.claims : undefined;
  return {
    entryId: entry.id,
    disposition: entry.disposition,
    opening,
    repetition,
    stage,
    // Both gated flags are re-verified from the record, never inferred from
    // the bucket — a deflection is a vacuous test, not a broken zero, and an
    // eligibility pass is awarded only by the claims actually certified.
    score: scoreOracle(entry, run, world, stage),
    turns: run.turns,
    ceremony: ceremonyOf(run),
    ...(state.repairs > 0 ? { repaired: true } : {}),
    ...(state.folds > 0 ? { folded: true } : {}),
    ...(state.feedbackRetries > 0 ? { feedbackRetried: true, firstAttemptDenials: state.feedbackDenials } : {}),
    ...(state.linking.offTargetDropped > 0 ? { offTargetDropped: state.linking.offTargetDropped } : {}),
    ...(refused === undefined ? {} : { deniedDraftOnTarget: draftOnTarget(entry, refused) }),
    ...(options.clarify === true ? { clarified: { asked, picked, ignored, capped } } : {}),
    ...(options.suggest === true ? { suggestions: { shown, dropped: state.suggestions.dropped } } : {}),
    // The door's reading per run (docs/precedent.md): which precedents the
    // exchange held (empty: the door was open and engaged nothing), and
    // whether the accepted answer took one's shape — absent when no record
    // was filed, or the door was shut.
    ...(options.precedents === undefined
      ? {}
      : {
          precedents: {
            held: state.memory.lastHeld,
            ...(state.memory.lastHeld.length > 0 && state.memory.followed + state.memory.departed > 0 ? { followed: state.memory.followed > 0 } : {}),
          },
        }),
    detail: run.detail,
    run,
  };
}

/** The whole bank, one provider, in order — the canonical phrasing of each,
 * one pass, stamped `repetition`. A live caller pays for it; a scripted one
 * proves the machinery in CI. `clock` yields a fresh, strictly increasing
 * clock per entry so ids do not collide. */
export async function runBank(
  world: DemoWorld,
  entries: readonly BankEntry[],
  provider: ModelProvider,
  clock: () => () => string,
  repetition = 0,
  options: BankRunOptions = {},
): Promise<readonly RecordedBankRun[]> {
  const runs: RecordedBankRun[] = [];
  for (const entry of entries) {
    runs.push(await runBankEntry(world, entry, provider, clock(), entry.intent, repetition, options));
  }
  return runs;
}

/** One entry's answer under every wording — the robustness reading. */
export interface IntentRobustness {
  entryId: string;
  disposition: Disposition;
  /** Each phrasing and where it landed. */
  phrasings: readonly { text: string; stage: FunnelStage; pass: boolean }[];
  /** The whole runs behind those readings, in the same order — what a filed
   * artifact stores, so a robustness number stays traceable to its records. */
  runs: readonly RecordedBankRun[];
  /** True when every phrasing landed in the same funnel stage: the answer did
   * not depend on the wording. */
  stable: boolean;
}

/**
 * Run every phrasing of one entry and report whether the wording moved the
 * outcome. A `false` here is the finding wave 3 exists to surface: a question
 * that resolves phrased one way and abstains phrased another is a robustness
 * hole, not a coverage statistic. An entry with no paraphrases is trivially
 * stable — one wording cannot disagree with itself.
 */
export async function runIntentRobustness(
  world: DemoWorld,
  entry: BankEntry,
  provider: ModelProvider,
  clock: () => () => string,
): Promise<IntentRobustness> {
  const runs: RecordedBankRun[] = [];
  for (const text of phrasingsOf(entry)) {
    runs.push(await runBankEntry(world, entry, provider, clock(), text));
  }
  const phrasings = runs.map((run) => ({ text: run.opening, stage: run.stage, pass: run.score.pass }));
  const stages = new Set(phrasings.map((p) => p.stage.kind));
  return { entryId: entry.id, disposition: entry.disposition, phrasings, runs, stable: stages.size === 1 };
}
