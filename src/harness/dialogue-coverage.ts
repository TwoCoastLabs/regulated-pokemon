/**
 * The dialogue coverage map (epic #54): the dialogue bank's runs, aggregated so
 * the two things a multi-turn run adds over a single-turn one are both legible —
 * the per-turn disposition tally (does each utterance still do what it should,
 * *in context*), and the thread-level ceremony cost (how many prompts a whole
 * task took).
 *
 * The per-turn tally is deliberately the single-turn coverage map, computed
 * over the conversation's turns: a dialogue turn is scored by the same oracle a
 * bank question is, so it aggregates the same way, and reusing {@link
 * coverageMap} keeps the enforcement-escalation guard and the honest-refusal
 * framing identical across the two instruments. Each turn is keyed
 * `<dialogue>#<n>` so an escalation or a friction row points at the exact
 * utterance in the exact conversation.
 *
 * The ceremony section is what only a multi-turn run can report: prompts-to-
 * answer over the whole task, per conversation and on average, the number §10
 * asks for at task scope rather than one exchange.
 */

import type { BankRun } from "./bank-run.js";
import { type CoverageMap, coverageMap, renderCoverage } from "./coverage.js";
import type { RecordedDialogueRun } from "./dialogue-run.js";

/** One conversation's ceremony cost — the prompts a whole task took. */
export interface DialogueCeremony {
  dialogueId: string;
  /** Turns in the conversation. */
  turns: number;
  /** Turns that passed their oracle. */
  passedTurns: number;
  /** Model calls over the whole conversation — prompts-to-answer at task scope. */
  modelCalls: number;
}

export interface DialogueCoverageMap {
  dialogues: number;
  totalTurns: number;
  /** The per-turn disposition tally — the single-turn coverage map, over every
   * turn of every conversation. Its enforcement-escalation list is the
   * cross-turn enforcement zero: a turn that committed gated advice
   * mid-conversation is exactly what single-turn evals cannot see. */
  map: CoverageMap;
  /** Ceremony cost per conversation. */
  ceremony: readonly DialogueCeremony[];
  /** Model calls across every conversation — the numerator of the average. */
  totalModelCalls: number;
}

/** Flatten dialogue turns into the single-turn run shape the coverage map
 * aggregates, keyed so each turn is addressable in its conversation. */
function asBankRuns(runs: readonly RecordedDialogueRun[]): BankRun[] {
  return runs.flatMap((dialogue) =>
    dialogue.turns.map((turn): BankRun => ({
      entryId: `${dialogue.dialogueId}#${turn.turnIndex + 1}`,
      disposition: turn.disposition,
      opening: turn.say,
      repetition: 0,
      stage: turn.stage,
      score: turn.score,
      turns: turn.turns,
      detail: turn.detail,
    })),
  );
}

export function dialogueCoverage(runs: readonly RecordedDialogueRun[]): DialogueCoverageMap {
  const ceremony = runs.map(
    (run): DialogueCeremony => ({
      dialogueId: run.dialogueId,
      turns: run.turns.length,
      passedTurns: run.passedTurns,
      modelCalls: run.totalModelCalls,
    }),
  );
  return {
    dialogues: runs.length,
    totalTurns: ceremony.reduce((sum, item) => sum + item.turns, 0),
    map: coverageMap(asBankRuns(runs)),
    ceremony,
    totalModelCalls: ceremony.reduce((sum, item) => sum + item.modelCalls, 0),
  };
}

// --- rendering --------------------------------------------------------------

/** The dialogue map as Markdown — pure, read from the aggregate, never
 * recomputed. The per-turn table is the single-turn renderer's, so the two
 * pages read the same; the ceremony table is what multi-turn adds. */
export function renderDialogueCoverage(coverage: DialogueCoverageMap, heading = "Dialogue coverage map"): string {
  const lines: string[] = [`# ${heading}`, ""];
  lines.push(`**${coverage.dialogues} conversation(s), ${coverage.totalTurns} turn(s).**`);
  lines.push("");

  // The per-turn disposition table and the enforcement line, from the reused
  // single-turn renderer — over the turns rather than isolated questions.
  lines.push(renderCoverage(coverage.map, "Per-turn coverage (every turn, in conversation)"));

  lines.push("## Ceremony cost — prompts-to-answer over a whole task");
  lines.push("");
  lines.push("This is the number a single-turn run cannot produce: the model calls a");
  lines.push("*conversation* took, not one exchange. Scope established early and reused is");
  lines.push("what makes later turns cheap; a thread that re-establishes it every turn is");
  lines.push("the friction this column would expose.");
  lines.push("");
  lines.push("| Conversation | turns | passed | model calls | calls/turn |");
  lines.push("|---|---|---|---|---|");
  for (const item of coverage.ceremony) {
    const perTurn = item.turns === 0 ? 0 : item.modelCalls / item.turns;
    lines.push(`| \`${item.dialogueId}\` | ${item.turns} | ${item.passedTurns}/${item.turns} | ${item.modelCalls} | ${perTurn.toFixed(1)} |`);
  }
  lines.push("");
  const average = coverage.totalTurns === 0 ? 0 : coverage.totalModelCalls / coverage.totalTurns;
  lines.push(
    `**${coverage.totalModelCalls} model call(s) over ${coverage.totalTurns} turn(s) — ` +
      `${average.toFixed(1)} prompts-to-answer on average across the bank.**`,
  );
  lines.push("");

  return lines.join("\n");
}
