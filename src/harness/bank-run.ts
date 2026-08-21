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

import type { ScopeDimension, TrainerScope } from "../kernel/contracts.js";
import { deriveScope } from "../kernel/scope.js";
import type { ModelProvider } from "./provider.js";
import type { DemoWorld } from "../demo/script.js";
import {
  decideAct,
  decideScope,
  say,
  type SessionDeps,
  type SessionState,
  startSession,
} from "../session/session.js";
import { candidateIsTrue } from "./trainer.js";
import type { BankEntry, ClaimKind } from "./bank.js";
import {
  committedGatedAdvice,
  type Disposition,
  type DispositionScore,
  eligibilityAnswered,
  type FunnelStage,
  funnelOf,
  resolvedOnShape,
  routedLesson,
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
  /** True when the outcome followed a strip-assertion repair (docs/recovery.md,
   * channel 2) — a post-repair resolution, counted apart from first-attempt
   * ones so the retry can never launder the model's mis-recall rate. */
  repaired?: boolean;
  /** One human line on how it ended, for the report's detail column. */
  detail: string;
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
  const score = scoreDisposition(oracle.disposition, stage, committedGatedAdvice(run, world), eligibilityAnswered(run, world));
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
  return score;
}

/** Drive the session to a settled state, answering as the trainer would. The
 * opening is one phrasing of the question — the canonical intent, or a variant
 * when robustness is being measured. */
async function play(entry: BankEntry, opening: string, deps: SessionDeps): Promise<SessionState> {
  let state = await say(startSession(), opening, deps);
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
    }
  }
  return state;
}

/** Read a settled session as the minimal run the funnel needs. Exported so the
 * record-shape and friction branches are testable without a live session. */
export function asRun(entry: BankEntry, state: SessionState, world: DemoWorld, repetition = 0): HarnessRun {
  const record = state.records.at(-1);
  const base = {
    scenarioId: entry.id,
    providerId: "bank",
    repetition,
    transcript: state.transcript,
    turns: state.usage.calls,
    providerErrors: state.providerErrors,
    usage: state.usage,
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
  grounded = false,
  retrieval = false,
  gatedGrammar = false,
  repair = false,
): Promise<RecordedBankRun> {
  const state = await play(entry, opening, { world, provider, now, grounded, retrieval, gatedGrammar, repair });
  const run = asRun(entry, state, world, repetition);
  const stage = funnelOf(run, wantsAct(entry));
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
    ...(state.repairs > 0 ? { repaired: true } : {}),
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
  grounded = false,
  retrieval = false,
  gatedGrammar = false,
  repair = false,
): Promise<readonly RecordedBankRun[]> {
  const runs: RecordedBankRun[] = [];
  for (const entry of entries) {
    runs.push(await runBankEntry(world, entry, provider, clock(), entry.intent, repetition, grounded, retrieval, gatedGrammar, repair));
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
