/**
 * The Center improvement loop's free leg, pinned (epic #94, Center loop 1;
 * findings iteration 40).
 *
 * The filed strong-model Center artifact is re-scored under today's oracles,
 * and both readings are pinned: the map as filed (the baseline the batch
 * paid for) and the map as the current instrument reads the same records.
 * The delta between them is exactly the share of the miss rate the
 * instrument owned — oracle strictness, not model failure — measured at zero
 * spend. A change to the scorer or the bank that moves the published rate
 * has to move this file in the same change, the discipline divergence.test
 * keeps for its artifacts.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { centerWorld } from "../demo/files.js";
import { CENTER_BANK_PATH, readBank } from "./bank.js";
import type { RecordedBankRun } from "./bank-run.js";
import type { CoverageArtifact } from "./coverage-artifact.js";
import { degenerateComparisons, missBreakdown, rescoreMap, rescoreRuns } from "./rescore.js";

const ARTIFACT = "2026-08-27T12-33-45-700Z-coverage.json";
const LOOP_1_ARTIFACT = "2026-08-27T22-15-59-495Z-coverage.json";

function artifact(name: string = ARTIFACT): CoverageArtifact {
  return JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../runs/coverage", name), "utf8"),
  ) as CoverageArtifact;
}

describe("the filed strong Center map, re-read under the loop-1 oracles", () => {
  const filed = artifact();
  const world = centerWorld();
  const bank = readBank(CENTER_BANK_PATH);
  const runs = filed.runs as readonly RecordedBankRun[];

  it("replays the same world the artifact pinned", () => {
    expect(filed.world.snapshotId).toBe(world.registry.snapshot.id);
    expect(filed.world.snapshotDigest).toBe(world.registry.document.contentDigest);
    expect(filed.bankId).toBe(bank.id);
  });

  it("baseline, as filed: the numbers the batch paid for", () => {
    const answerable = filed.map.byDisposition[0]!;
    expect(answerable.disposition).toBe("answerable");
    expect(answerable.pass).toBe(71);
    expect(answerable.total).toBe(237);
    expect(filed.map.pass).toBe(154);
    expect(filed.map.total).toBe(375);
  });

  it("baseline decomposition: where the 166 answerable misses were, by the layer that owes the fix", () => {
    expect(missBreakdown(filed.runs)).toEqual({
      misses: 166,
      // 86 of 100 denials are the comparison grammar's fault — the enum
      // offered prose facts to compare; treatment B narrows it to numeric.
      // The other 14 are model recall, caught and named (the gate working).
      deniedByRule: {
        "IA-2/incomparable-fact": 86,
        "IA-2/uncertified-fact": 9,
        "IA-3/fabricated-entity": 5,
      },
      // Dominated by treats enumerations where an item roster was the asked
      // shape — which the grammar did not offer; treatment C's target.
      resolvedOffShape: 39,
      resolvedOffSubject: 1,
      resolvedOther: 6,
      abstainedScope: 9,
      abstainedAnswer: 10,
      declined: 1,
    });
  });

  it("names the self-comparison pathology in the record: 13 committed, 48 more refused as drafts", () => {
    // potion-vs-potion: verified true, degenerate — a fact claim wearing the
    // comparison's clothes. Treatment A (IA-2/degenerate-comparison) makes it
    // a named denial; the prompt line makes it rare. This is the baseline.
    expect(degenerateComparisons(runs)).toEqual({ committed: 13, refusedDrafts: 48 });
  });

  it("rescored under today's oracles: the instrument owned exactly 4 of the 166 misses", () => {
    // The free re-measurement: same paid records, current bank and scorer.
    // Oracle strictness (treats answers failed as off-shape/off-subject) was
    // worth +4 answerable passes and 4 fewer stable fails — real, and small:
    // the miss rate is overwhelmingly the proposer's, not the instrument's.
    const map = rescoreMap(world, bank.entries, runs);
    const answerable = map.byDisposition[0]!;
    expect(answerable.pass).toBe(75);
    expect(answerable.total).toBe(237);
    expect(map.pass).toBe(158);
    expect(map.repetition?.passPerRepetition).toEqual([54, 57, 47]);
    expect(map.repetition?.stablePass).toBe(36);
    expect(map.repetition?.stableFail).toBe(53);
    const breakdown = missBreakdown(rescoreRuns(world, bank.entries, runs));
    expect(breakdown.misses).toBe(162);
    expect(breakdown.resolvedOffShape).toBe(36);
    expect(breakdown.resolvedOffSubject).toBe(0);
    // The denials are untouched: no oracle can (or may) move a named refusal.
    expect(breakdown.deniedByRule).toEqual({
      "IA-2/incomparable-fact": 86,
      "IA-2/uncertified-fact": 9,
      "IA-3/fabricated-entity": 5,
    });
    // Enforcement is not an oracle question: rescoring may never move it.
    expect(map.enforcementEscalations).toEqual([]);
  });
});

describe("the loop-1 re-run, same dials, treatments in: the paid leg's effect, pinned", () => {
  // Baseline and re-run share every dial (--retrieval --gated-grammar
  // --repair, N=3, same model, same world) so the delta is the treatments'.
  const rerun = artifact(LOOP_1_ARTIFACT);
  const runs = rerun.runs as readonly RecordedBankRun[];

  it("ran the same configuration as the baseline", () => {
    const filed = artifact();
    expect(rerun.model.slug).toBe(filed.model.slug);
    expect(rerun.world).toEqual(filed.world);
    expect({
      retrieval: rerun.retrieval,
      gatedGrammar: rerun.gatedGrammar,
      repair: rerun.repair,
      repetitions: rerun.repetitions,
    }).toEqual({ retrieval: true, gatedGrammar: true, repair: true, repetitions: 3 });
  });

  it("answerable 111/237 pooled — from 71 as filed and 75 rescored; band 62-74 against the baseline's 47-55", () => {
    const answerable = rerun.map.byDisposition[0]!;
    expect(answerable.pass).toBe(111);
    expect(answerable.total).toBe(237);
    expect(rerun.map.pass).toBe(199);
    expect(rerun.map.repetition?.passPerRepetition).toEqual([74, 63, 62]);
    expect(rerun.map.repetition?.stablePass).toBe(46);
    expect(rerun.map.repetition?.stableFail).toBe(35);
  });

  it("the treated classes moved, each toward its treatment", () => {
    const breakdown = missBreakdown(rerun.runs);
    expect(breakdown.misses).toBe(126);
    // Treatment B (numeric-only comparison enum): 86 -> 12. The remaining 12
    // are the enum's blind spot — numeric-capable facts absent on one side
    // (a repel-steps against a potion) — which is the runtime gate's job, and
    // proof the narrowing did not make it vacuous.
    expect(breakdown.deniedByRule).toEqual({
      "IA-2/incomparable-fact": 12,
      "IA-2/uncertified-fact": 7,
      "IA-3/fabricated-entity": 2,
      "IA-2/fact-mismatch": 1,
      "IA-4/membership-mismatch": 1,
      "IA-4/ranking-over-empty-roster": 1,
    });
    // Treatment C (item criteria offered): off-shape resolutions 39 -> 25.
    expect(breakdown.resolvedOffShape).toBe(25);
    // The new dominant miss class: honest abstention (10 -> 55). The grammar
    // took the improvisation vehicles away and the model abstains where it
    // used to improvise — loop 2's named target, not this loop's claim.
    expect(breakdown.abstainedAnswer).toBe(55);
    expect(breakdown.abstainedScope).toBe(14);
  });

  it("treatment A: the self-comparison pathology is gone from the record — none committed, none even drafted", () => {
    expect(degenerateComparisons(runs)).toEqual({ committed: 0, refusedDrafts: 0 });
  });

  it("enforcement is untouched by the loop, as it must be", () => {
    expect(rerun.map.enforcementEscalations).toEqual([]);
  });
});
