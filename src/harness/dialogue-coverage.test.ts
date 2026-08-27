/**
 * The dialogue coverage aggregate, proven pure: synthetic per-turn runs in,
 * a per-disposition tally and a ceremony table out, rendered from the aggregate
 * and nothing else. The per-turn tally reuses the single-turn coverage map, so
 * these tests pin the two things dialogue adds: the tally is over *turns*, and
 * the ceremony section reports prompts-to-answer per conversation.
 */

import { describe, expect, it } from "vitest";

import type { RecordedDialogueRun, RecordedDialogueTurnRun } from "./dialogue-run.js";
import { dialogueCoverage, renderDialogueCoverage } from "./dialogue-coverage.js";
import type { HarnessRun } from "./run.js";
import type { Disposition, FunnelStage } from "./playability.js";

/** A per-turn run stub — the aggregate reads only these fields. */
function turn(
  index: number,
  disposition: Disposition,
  stageKind: FunnelStage["kind"],
  pass: boolean,
  calls: number,
): RecordedDialogueTurnRun {
  const stage = { kind: stageKind } as FunnelStage;
  return {
    turnIndex: index,
    say: `turn ${index}`,
    disposition,
    stage,
    score: { pass, reason: "stub" },
    turns: calls,
    detail: "stub",
    run: {} as HarnessRun,
  };
}

function dialogue(id: string, turns: readonly RecordedDialogueTurnRun[]): RecordedDialogueRun {
  return {
    repetition: 0,
  dialogueId: id,
    turns,
    totalModelCalls: turns.reduce((sum, t) => sum + t.turns, 0),
    resolvedTurns: turns.filter((t) => t.stage.kind === "resolved").length,
    passedTurns: turns.filter((t) => t.score.pass).length,
    enforcementEscalations: [],
    wrongScopeEscalations: [],
    attacks: { turns: 0, reached: 0 },
    providerErrors: 0,
  };
}

describe("dialogueCoverage aggregates turns and prices each conversation", () => {
  const runs: RecordedDialogueRun[] = [
    dialogue("a", [turn(0, "answerable", "resolved", true, 2), turn(1, "needs-data", "abstained-answer", true, 1)]),
    dialogue("b", [turn(0, "answerable", "resolved", true, 2), turn(1, "answerable", "abstained-answer", false, 3)]),
  ];

  it("counts dialogues, turns and per-conversation ceremony", () => {
    const coverage = dialogueCoverage(runs);
    expect(coverage.dialogues).toBe(2);
    expect(coverage.totalTurns).toBe(4);
    expect(coverage.totalModelCalls).toBe(8);
    expect(coverage.ceremony).toHaveLength(2);
    expect(coverage.ceremony[0]).toMatchObject({ dialogueId: "a", turns: 2, modelCalls: 3, passedTurns: 2 });
    expect(coverage.ceremony[1]).toMatchObject({ dialogueId: "b", turns: 2, modelCalls: 5, passedTurns: 1 });
  });

  it("the per-turn tally is the single-turn coverage map over every turn", () => {
    const coverage = dialogueCoverage(runs);
    const answerable = coverage.map.byDisposition.find((row) => row.disposition === "answerable")!;
    expect(answerable.total).toBe(3); // two resolved passes and one answerable that abstained
    expect(answerable.pass).toBe(2);
    const needsData = coverage.map.byDisposition.find((row) => row.disposition === "needs-data")!;
    expect(needsData.pass).toBe(1);
    expect(coverage.map.enforcementEscalations).toEqual([]);
  });

  it("post-repair turns are named apart in the map and its render", () => {
    const repairedTurn = { ...turn(0, "answerable", "resolved", true, 2), repaired: true };
    const coverage = dialogueCoverage([dialogue("fixed", [repairedTurn])]);
    expect(coverage.map.repaired).toEqual(["fixed#1"]);
    const page = renderDialogueCoverage(coverage);
    expect(page).toContain("strip-assertion repair");
    expect(page).toContain("`fixed#1`");
  });
});

describe("renderDialogueCoverage renders from the aggregate", () => {
  it("shows the ceremony table and the average prompts-to-answer", () => {
    const coverage = dialogueCoverage([
      dialogue("solo", [turn(0, "answerable", "resolved", true, 2), turn(1, "answerable", "resolved", true, 1)]),
    ]);
    const page = renderDialogueCoverage(coverage);
    expect(page).toContain("Ceremony cost");
    expect(page).toContain("`solo`");
    expect(page).toContain("prompts-to-answer on average");
    // 3 calls over 2 turns.
    expect(page).toContain("3 model call(s) over 2 turn(s)");
  });
});
