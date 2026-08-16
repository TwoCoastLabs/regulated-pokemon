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
import { deriveScope, REQUIRED_DIMENSIONS } from "../kernel/scope.js";
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
import type { BankEntry } from "./bank.js";
import { type Disposition, type DispositionScore, type FunnelStage, funnelOf, scoreDisposition } from "./playability.js";
import type { HarnessRun, RunStatus } from "./run.js";

/** Bound on how many turns one exchange may take before it is abandoned as
 * scope friction. Generous: a cooperative trainer settles in a handful, and
 * only a model that cannot make progress hits it. */
const MAX_STEPS = 16;

/** One bank question, run and judged. */
export interface BankRun {
  entryId: string;
  disposition: Disposition;
  stage: FunnelStage;
  score: DispositionScore;
  /** Model calls made — the friction number, per entry. */
  turns: number;
  /** One human line on how it ended, for the report's detail column. */
  detail: string;
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
export function asRun(entry: BankEntry, state: SessionState, world: DemoWorld): HarnessRun {
  const record = state.records.at(-1);
  const base = {
    scenarioId: entry.id,
    providerId: "bank",
    repetition: 0,
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
  const bound = new Set(deriveScope(world.pack, state.transcript).bindings.map((binding) => binding.dimension));
  const scopeClosed = REQUIRED_DIMENSIONS.every((dimension) => bound.has(dimension));
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
): Promise<BankRun> {
  const state = await play(entry, opening, { world, provider, now });
  const run = asRun(entry, state, world);
  const stage = funnelOf(run, wantsAct(entry));
  return {
    entryId: entry.id,
    disposition: entry.disposition,
    stage,
    score: scoreDisposition(entry.disposition, stage),
    turns: run.turns,
    detail: run.detail,
  };
}

/** The whole bank, one provider, in order — the canonical phrasing of each. A
 * live caller pays for it; a scripted one proves the machinery in CI. `clock`
 * yields a fresh, strictly increasing clock per entry so ids do not collide. */
export async function runBank(
  world: DemoWorld,
  entries: readonly BankEntry[],
  provider: ModelProvider,
  clock: () => () => string,
): Promise<readonly BankRun[]> {
  const runs: BankRun[] = [];
  for (const entry of entries) {
    runs.push(await runBankEntry(world, entry, provider, clock()));
  }
  return runs;
}

/** One entry's answer under every wording — the robustness reading. */
export interface IntentRobustness {
  entryId: string;
  disposition: Disposition;
  /** Each phrasing and where it landed. */
  phrasings: readonly { text: string; stage: FunnelStage; pass: boolean }[];
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
  const phrasings: { text: string; stage: FunnelStage; pass: boolean }[] = [];
  for (const text of phrasingsOf(entry)) {
    const run = await runBankEntry(world, entry, provider, clock(), text);
    phrasings.push({ text, stage: run.stage, pass: run.score.pass });
  }
  const stages = new Set(phrasings.map((p) => p.stage.kind));
  return { entryId: entry.id, disposition: entry.disposition, phrasings, stable: stages.size === 1 };
}
