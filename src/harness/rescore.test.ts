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

function artifact(): CoverageArtifact {
  return JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../runs/coverage", ARTIFACT), "utf8"),
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
