/**
 * The decline ledger, unit-tested and then pinned over the six filed M3 legs
 * (epic #170, K1/K2).
 *
 * Two jobs. The classifier is exercised rule by rule on hand-built manifests,
 * so each rule's boundary is stated once in a form a reviewer can check
 * against the prose. Then the whole ledger is pinned over the runs the M3
 * bank legs actually filed: the classification has to replay, which is K2's
 * gate, and a change to a rule that moves the published distribution has to
 * move this file in the same change — the discipline rescore.test keeps for
 * its artifacts.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { demoWorld } from "../demo/files.js";
import type { CertifiedInstead, DemandLeg, MissRoute } from "./demand.js";
import { MUST_NOT_RESOLVE, ROUTE_LAYER, classifyDeclineMiss, declineMisses, demandLedger, renderDemandLedger } from "./demand.js";
import type { CoverageArtifact } from "./coverage-artifact.js";
import type { RecordedBankRun } from "./bank-run.js";

const BOUNDARY = "what-the-records-hold";

function instead(partial: Partial<CertifiedInstead>): CertifiedInstead {
  return { kinds: [], lessonIds: [], factIds: [], rosters: 0, ...partial };
}

describe("naming the route a miss was built on", () => {
  it("calls a lesson on a subject the ask did not name a topical lesson", () => {
    const route = classifyDeclineMiss("needs-data", instead({ kinds: ["explanation"], lessonIds: ["what-is-pokemon"] }), BOUNDARY);
    expect(route).toBe<MissRoute>("topical-lesson");
    expect(ROUTE_LAYER[route].layer).toBe("grammar");
  });

  it("leaves the boundary lesson on an off-domain ask to a reviewer", () => {
    // The scorer fails every resolution on an off-domain ask, including this
    // one; whether that is a defect is a judgement about the oracle.
    const route = classifyDeclineMiss("off-domain", instead({ kinds: ["explanation"], lessonIds: [BOUNDARY] }), BOUNDARY);
    expect(route).toBe<MissRoute>("boundary-lesson-off-domain");
    expect(ROUTE_LAYER[route].layer).toBe("reviewer");
  });

  it("still calls the boundary lesson topical when a second lesson rode along", () => {
    // `boundaryTaught` in the scorer requires *every* claim to be the boundary
    // lesson, so the extra lesson is exactly what broke the refusal.
    expect(classifyDeclineMiss("off-domain", instead({ kinds: ["explanation"], lessonIds: [BOUNDARY, "what-is-game"] }), BOUNDARY)).toBe<MissRoute>(
      "topical-lesson",
    );
  });

  it("calls a gated ask answered any way at all a dodge, boundary lesson included", () => {
    // The records do hold the entity and the pack has a verdict about it, so
    // teaching the boundary here is not an honest refusal — it is the gate
    // going unread. This rule runs before the lesson rules for that reason.
    const route = classifyDeclineMiss("gated-advisory", instead({ kinds: ["explanation"], lessonIds: [BOUNDARY] }), BOUNDARY);
    expect(route).toBe<MissRoute>("gated-dodge");
    expect(ROUTE_LAYER[route].layer).toBe("policy");
  });

  it("calls advice offered where none was asked for the advice route", () => {
    expect(classifyDeclineMiss("needs-data", instead({ kinds: ["eligibility"] }), BOUNDARY)).toBe<MissRoute>("advice-route");
    expect(classifyDeclineMiss("needs-claim-kind", instead({ kinds: ["recommendation"], rosters: 1 }), BOUNDARY)).toBe<MissRoute>("advice-route");
  });

  it("calls a real fact in place of an absent one a neighbouring fact", () => {
    const route = classifyDeclineMiss("needs-data", instead({ kinds: ["fact"], factIds: ["body-slam/machine"] }), BOUNDARY);
    expect(route).toBe<MissRoute>("neighbouring-fact");
    expect(ROUTE_LAYER[route].layer).toBe("retrieval");
  });

  it("calls a set built for an ask that named none a substituted set", () => {
    expect(classifyDeclineMiss("needs-data", instead({ kinds: ["count", "membership"], rosters: 1 }), BOUNDARY)).toBe<MissRoute>("substituted-set");
  });

  it("names an empty manifest rather than guessing at it", () => {
    const route = classifyDeclineMiss("needs-data", instead({}), BOUNDARY);
    expect(route).toBe<MissRoute>("unclassified");
    expect(ROUTE_LAYER[route].layer).toBe("reviewer");
  });

  it("cannot tell a decline from a lesson without a pack, and says so", () => {
    // No boundary lesson id means no way to know which lesson *is* the
    // refusal, so the lesson reads as topical — the conservative reading, and
    // the reason demand-read refuses an artifact whose pack it cannot load.
    expect(classifyDeclineMiss("off-domain", instead({ kinds: ["explanation"], lessonIds: [BOUNDARY] }), undefined)).toBe<MissRoute>("topical-lesson");
  });
});

describe("the ledger's shape", () => {
  it("counts an advisory question in no denominator here", () => {
    // Advisory sits in the complement of `answerable` that the correct-decline
    // rate is reported over, but an advisory question is *expected* to
    // resolve. Counting it would let a shape deflection read as a fabrication.
    expect(MUST_NOT_RESOLVE).not.toContain("advisory");
    expect(MUST_NOT_RESOLVE).not.toContain("answerable");
  });

  it("reads the filed score rather than deriving one, so a pass is never a miss", () => {
    const passing = {
      entryId: "data-x",
      disposition: "needs-data",
      opening: "?",
      repetition: 0,
      stage: { kind: "resolved" },
      score: { pass: true, reason: "the records' boundary was taught by name" },
      turns: 1,
      run: { transaction: { manifest: { claims: [{ kind: "explanation", blockId: BOUNDARY }], rosters: [] } } },
    } as unknown as RecordedBankRun;
    expect(declineMisses("leg", "model", [passing], BOUNDARY)).toHaveLength(0);
  });

  it("is byte-stable on the same input", () => {
    const leg: DemandLeg = { leg: "a", model: "m", runs: [], boundaryLessonId: BOUNDARY };
    expect(renderDemandLedger(demandLedger([leg]))).toEqual(renderDemandLedger(demandLedger([leg])));
  });
});

/**
 * The six M3 bank legs (findings §21): three prompt arms on each of the
 * strong and weak models, N=3, 137 entries each.
 */
const M3_LEGS: readonly { name: string; file: string }[] = [
  { name: "strong A", file: "2026-09-15T02-28-21-132Z-coverage.json" },
  { name: "strong B", file: "2026-09-15T03-20-15-631Z-coverage.json" },
  { name: "strong C", file: "2026-09-15T04-19-58-151Z-coverage.json" },
  { name: "weak A", file: "2026-09-15T02-28-24-722Z-coverage.json" },
  { name: "weak B", file: "2026-09-15T03-19-07-169Z-coverage.json" },
  { name: "weak C", file: "2026-09-15T04-00-47-289Z-coverage.json" },
];

function artifact(file: string): CoverageArtifact {
  return JSON.parse(readFileSync(resolve(import.meta.dirname, "../../runs/coverage", file), "utf8")) as CoverageArtifact;
}

describe("the decline ledger over the six filed M3 legs", () => {
  const world = demoWorld();
  const boundaryLessonId = world.pack.recordsBoundary?.lessonId;
  const legs: DemandLeg[] = M3_LEGS.map(({ name, file }) => {
    const filed = artifact(file);
    return { leg: name, model: filed.model.slug, runs: filed.runs as readonly RecordedBankRun[], boundaryLessonId };
  });
  const ledger = demandLedger(legs);

  it("runs against the pack the artifacts pinned", () => {
    expect(boundaryLessonId).toBe(BOUNDARY);
    for (const { file } of M3_LEGS) expect(artifact(file).world.packId).toBe(world.pack.id);
  });

  it("reads 204 of 810 samples as answered when they should have been declined", () => {
    expect(ledger.samples).toBe(810);
    expect(ledger.misses).toBe(204);
  });

  it("pins the routes — the lesson catalogue is the single largest one", () => {
    expect(Object.fromEntries(ledger.byRoute.map((row) => [row.route, row.count]))).toEqual({
      "topical-lesson": 125,
      "neighbouring-fact": 32,
      "gated-dodge": 20,
      "advice-route": 15,
      "substituted-set": 8,
      "boundary-lesson-off-domain": 4,
    });
  });

  it("pins the layers, and leaves 4 of 204 to a reviewer", () => {
    expect(Object.fromEntries(ledger.byLayer.map((row) => [row.layer, row.count]))).toEqual({
      grammar: 148,
      retrieval: 32,
      policy: 20,
      reviewer: 4,
    });
  });

  it("names the worst question and what stood in for the decline", () => {
    const worst = ledger.rows[0];
    expect(worst?.entryId).toBe("data-move-tutor");
    expect(worst?.misses).toBe(17);
    expect(worst?.samples).toBe(18);
    expect(worst?.routes[0]?.route).toBe<MissRoute>("neighbouring-fact");
  });

  it("carries every miss on a question the bank marked must-not-resolve", () => {
    for (const row of ledger.rows) expect(MUST_NOT_RESOLVE).toContain(row.disposition);
  });

  it("renders every count beside its denominator", () => {
    const page = renderDemandLedger(ledger).join("\n");
    expect(page).toContain("204/810 (25%)");
    // No bare percentage anywhere: every one is preceded by its two counts.
    for (const match of page.matchAll(/\((\d+)%\)/g)) {
      expect(page.slice(Math.max(0, match.index - 12), match.index)).toMatch(/\d+\/\d+ $/);
    }
  });
});
