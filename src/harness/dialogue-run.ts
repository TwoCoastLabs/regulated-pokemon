/**
 * Driving one scripted conversation through the real session spine (epic #54).
 *
 * The single-turn bank runner (bank-run.ts) starts a fresh session per
 * question, so it is blind by construction to everything that lives *across*
 * turns. This runner keeps one `SessionState` alive for a whole conversation —
 * the same `startSession`, `say`, `decideScope`, `decideAct` the live page and
 * the single-turn bank both call — so a grant established on turn one is the
 * grant turn three answers under (or the stale grant it trips over), a
 * clarifying question recorded on turn two is in the transcript when turn four
 * speaks, and the ceremony cost is the model calls over the whole task, not one
 * exchange. Those are the cross-turn failure modes `docs/generalization.md` §10
 * names as the unmeasured axis.
 *
 * Each turn is read and scored exactly as a single-turn question is — its
 * funnel stage from the record, its verdict from {@link scoreOracle} — with one
 * discipline the single-turn reader does not need: the outcome is read from the
 * record *that turn* produced, never the session's latest. A turn that abstains
 * files no record, and trusting `records.at(-1)` there would score it against
 * an earlier turn's answer. So every read is bounded by where the turn began.
 *
 * No model in any scoring path, exactly as replay reads: a stage and a verdict
 * are functions of the recorded transcript and nothing else.
 */

import { deriveScope } from "../kernel/scope.js";
import type { DemoWorld } from "../demo/script.js";
import {
  decideAct,
  decideScope,
  say,
  type SessionDeps,
  type SessionState,
  startSession,
} from "../session/session.js";
import { profileWord, scoreOracle } from "./bank-run.js";
import { candidateIsTrue } from "./trainer.js";
import type { DialogueEntry, DialogueTurn } from "./dialogues.js";
import {
  type Disposition,
  type DispositionScore,
  type FunnelStage,
  funnelOf,
} from "./playability.js";
import type { HarnessRun, RunStatus } from "./run.js";
import type { ModelProvider } from "./provider.js";

/** Bound on how many driver steps one turn may take before it is abandoned as
 * scope friction — the same generous ceiling the single-turn runner uses. A
 * cooperative trainer settles in a handful; only a model that cannot make
 * progress hits it. */
const MAX_STEPS = 16;

/** Whether a turn asked for an act — an action question resolves only when the
 * act executed, the same rule the funnel uses. */
function wantsAct(turn: DialogueTurn): boolean {
  return (turn.expectClaimKinds ?? []).includes("action");
}

/** One turn, run and judged in the context of the turns before it. */
export interface DialogueTurnRun {
  /** 0-based position in the conversation. */
  turnIndex: number;
  /** The trainer's words this turn. */
  say: string;
  disposition: Disposition;
  stage: FunnelStage;
  score: DispositionScore;
  /** Model calls this turn made — the per-turn ceremony cost, including any
   * scope clarification the utterance provoked. */
  turns: number;
  /** True when this turn's outcome followed a strip-assertion repair
   * (docs/recovery.md, channel 2) — counted apart from first-attempt outcomes. */
  repaired?: boolean;
  /** One human line on how the turn ended, for the report's detail column. */
  detail: string;
}

/** A turn run still carrying the record behind its verdict — what a filed
 * artifact stores, so a dialogue number stays traceable to its transcript. */
export interface RecordedDialogueTurnRun extends DialogueTurnRun {
  run: HarnessRun;
}

/** One conversation, run and judged — the per-turn verdicts plus the
 * thread-level instruments that only a multi-turn run can produce. */
export interface DialogueRun {
  dialogueId: string;
  turns: readonly DialogueTurnRun[];
  /** Prompts-to-answer over the whole task: total model calls across the
   * conversation. The ceremony-cost number §10 asks for at task scope rather
   * than one exchange. */
  totalModelCalls: number;
  /** Turns that resolved (any bucket), and turns that passed their oracle. */
  resolvedTurns: number;
  passedTurns: number;
  /** Turn indices that committed the advice the pack gates — re-verified from
   * each turn's record, never inferred from a bucket. Must be empty: a
   * non-empty list is a broken enforcement zero, and one that broke *mid-
   * conversation* is exactly the case single-turn evals cannot see. */
  enforcementEscalations: readonly number[];
  /** Provider failures across the conversation, counted apart from abstention. */
  providerErrors: number;
}

/** A dialogue run still carrying every turn's record. */
export interface RecordedDialogueRun extends Omit<DialogueRun, "turns"> {
  turns: readonly RecordedDialogueTurnRun[];
}

/**
 * Advance the session to a settled state after a substantive utterance,
 * answering as the truthful trainer would — the same auto-driving the
 * single-turn runner does, per turn: answer a clarifying question from the
 * profile, confirm an interpretation only when it is actually true, and consent
 * to an act only when this turn is the one that asked for it (declining a
 * surprise — the honest-trainer discipline).
 */
async function settle(state: SessionState, turn: DialogueTurn, entry: DialogueEntry, deps: SessionDeps): Promise<SessionState> {
  const acts = wantsAct(turn);
  for (let step = 0; step < MAX_STEPS; step += 1) {
    const phase = state.phase;
    if (phase.kind === "gathering") break; // settled: a record filed, or an abstention noted
    if (phase.kind === "asking") {
      state = await say(state, profileWord(phase.dimension, entry.profile), deps);
    } else if (phase.kind === "confirming-scope") {
      const decision = candidateIsTrue(phase.proposal.candidate, entry.profile) ? "confirm" : "reject";
      state = await decideScope(state, decision, deps);
    } else if (phase.kind === "confirming-act") {
      state = decideAct(state, acts ? "confirm" : "decline", deps);
    }
  }
  return state;
}

/** Where a turn began, so its outcome is read from what *it* produced. */
interface TurnStart {
  records: number;
  notes: number;
  calls: number;
  errors: number;
  repairs: number;
}

/**
 * Read one turn's settled state as the minimal run the funnel needs — bounded
 * by where the turn began.
 *
 * The one rule the single-turn reader does not need: a record counts as this
 * turn's only when the session filed one *since the turn started*. A turn that
 * abstained filed nothing, and the session's latest record is a previous turn's
 * answer — reading it would score this turn against that one. Scope-closed for
 * an abstention is derived from the *whole* transcript, because an earlier turn
 * may already have established `version`: a later abstention is then an
 * answer-step abstention, not scope friction (the same `version`-established
 * heuristic the single-turn reader uses, one conversation wider).
 */
function asTurnRun(entry: DialogueEntry, index: number, state: SessionState, world: DemoWorld, start: TurnStart): HarnessRun {
  const record = state.records.length > start.records ? state.records.at(-1) : undefined;
  const base = {
    scenarioId: `${entry.id}#${index + 1}`,
    providerId: "dialogue",
    repetition: 0,
    transcript: state.transcript,
    // Per-turn ceremony cost: calls this turn made, not the running total.
    turns: state.usage.calls - start.calls,
    providerErrors: state.providerErrors - start.errors,
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

  const bound = new Set(deriveScope(world.pack, state.transcript).bindings.map((binding) => binding.dimension));
  const scopeClosed = bound.has("version");
  const detail = state.notes.length > start.notes ? (state.notes.at(-1)?.text ?? "no answer produced") : "no answer produced";
  return {
    ...base,
    status: "unresolved",
    detail,
    ...(scopeClosed ? { grantScope: entry.profile } : {}),
  };
}

/** Run one scripted conversation and score every turn. `now` is injected, so a
 * run replays; the whole conversation shares one session. */
export async function runDialogue(
  world: DemoWorld,
  entry: DialogueEntry,
  provider: ModelProvider,
  now: () => string,
  grounded = false,
  retrieval = false,
  gatedGrammar = false,
  repair = false,
): Promise<RecordedDialogueRun> {
  const deps: SessionDeps = { world, provider, now, grounded, retrieval, gatedGrammar, repair };
  let state = startSession();
  const turns: RecordedDialogueTurnRun[] = [];

  for (let index = 0; index < entry.turns.length; index += 1) {
    const turn = entry.turns[index]!;
    const start: TurnStart = {
      records: state.records.length,
      notes: state.notes.length,
      calls: state.usage.calls,
      errors: state.providerErrors,
      repairs: state.repairs,
    };

    state = await say(state, turn.say, deps);
    state = await settle(state, turn, entry, deps);

    const run = asTurnRun(entry, index, state, world, start);
    const stage = funnelOf(run, wantsAct(turn));
    // Scored by the same oracle a single-turn question is — the gated flags
    // re-verified from the record, a deflection scored a vacuous miss not a
    // broken zero.
    const score = scoreOracle(turn, run, world, stage);
    turns.push({
      turnIndex: index,
      say: turn.say,
      disposition: turn.disposition,
      stage,
      score,
      turns: run.turns,
      ...(state.repairs > start.repairs ? { repaired: true } : {}),
      detail: run.detail,
      run,
    });
  }

  return {
    dialogueId: entry.id,
    turns,
    totalModelCalls: state.usage.calls,
    resolvedTurns: turns.filter((turn) => turn.stage.kind === "resolved").length,
    passedTurns: turns.filter((turn) => turn.score.pass).length,
    enforcementEscalations: turns.filter((turn) => turn.score.enforcementEscalation === true).map((turn) => turn.turnIndex),
    providerErrors: state.providerErrors,
  };
}

/** The whole dialogue bank, one provider, in order. A live caller pays for it;
 * a scripted one proves the machinery in CI. `clock` yields a fresh, strictly
 * increasing clock per conversation so ids do not collide. */
export async function runDialogues(
  world: DemoWorld,
  entries: readonly DialogueEntry[],
  provider: ModelProvider,
  clock: () => () => string,
  grounded = false,
  retrieval = false,
  gatedGrammar = false,
  repair = false,
): Promise<readonly RecordedDialogueRun[]> {
  const runs: RecordedDialogueRun[] = [];
  for (const entry of entries) {
    runs.push(await runDialogue(world, entry, provider, clock(), grounded, retrieval, gatedGrammar, repair));
  }
  return runs;
}
