/**
 * The scope-dependency table is the single source of truth for how much scope
 * an answer must establish, read by both the verifier and (slice 2) the
 * planner. These tests pin what each claim kind depends on and that the derived
 * required set is the stable union — because a wrong entry here would either
 * interrogate a trainer for scope an answer never uses, or (worse) let an answer
 * commit without the scope its verification reads.
 */

import { describe, expect, it } from "vitest";

import type { Claim } from "./contracts.js";
import { requiredDimensionsFor, SCOPE_DEPENDENCIES } from "./scope-deps.js";

const CLAIM: Record<Claim["kind"], Claim> = {
  explanation: { kind: "explanation", blockId: "what-is-type" },
  fact: { kind: "fact", entityId: "pikachu", factId: "base-speed" },
  count: { kind: "count", rosterId: "electric-kanto" },
  typeCount: { kind: "typeCount" },
  membership: { kind: "membership", rosterId: "electric-kanto", entityId: "zapdos", asserted: true },
  ranking: { kind: "ranking", rosterId: "electric-kanto", basis: "base-speed", direction: "highest" },
  matchup: { kind: "matchup", subject: { kind: "species", entityId: "gengar" }, direction: "weak-to" },
  eligibility: { kind: "eligibility", entityId: "mewtwo" },
  recommendation: { kind: "recommendation", entityId: "mewtwo" },
  action: { kind: "action", tool: "catch", entityId: "mewtwo" },
};

describe("scope dependencies per claim kind", () => {
  it("teaches without any established scope", () => {
    expect(requiredDimensionsFor([CLAIM.explanation])).toEqual([]);
  });

  it("binds world facts to a version and nothing else", () => {
    for (const kind of ["fact", "count", "membership", "matchup"] as const) {
      expect(requiredDimensionsFor([CLAIM[kind]]), kind).toEqual(["version"]);
    }
  });

  it("reads the trainer's badges for advice and acts", () => {
    for (const kind of ["eligibility", "recommendation", "action"] as const) {
      expect(requiredDimensionsFor([CLAIM[kind]]), kind).toEqual(["version", "badgeLevel"]);
    }
  });

  it("reads the comparison basis for a ranking", () => {
    expect(requiredDimensionsFor([CLAIM.ranking])).toEqual(["version", "comparisonBasis"]);
  });

  it("never depends on region — the dimension the kernel verifies against nowhere", () => {
    for (const claim of Object.values(CLAIM)) {
      expect(requiredDimensionsFor([claim]), claim.kind).not.toContain("region");
    }
  });
});

describe("the derived required set", () => {
  it("is the union across a mixed answer, deduplicated", () => {
    expect(requiredDimensionsFor([CLAIM.fact, CLAIM.eligibility, CLAIM.ranking])).toEqual([
      "version",
      "badgeLevel",
      "comparisonBasis",
    ]);
  });

  it("is stable in canonical order regardless of claim order", () => {
    const a = requiredDimensionsFor([CLAIM.ranking, CLAIM.eligibility, CLAIM.fact]);
    const b = requiredDimensionsFor([CLAIM.eligibility, CLAIM.fact, CLAIM.ranking]);
    expect(a).toEqual(b);
    expect(a).toEqual(["version", "badgeLevel", "comparisonBasis"]);
  });

  it("is empty exactly when every claim is a lesson", () => {
    expect(requiredDimensionsFor([CLAIM.explanation, CLAIM.explanation])).toEqual([]);
    expect(requiredDimensionsFor([CLAIM.explanation, CLAIM.fact])).toEqual(["version"]);
  });

  it("covers every claim kind in the union — a new kind cannot depend on nothing silently", () => {
    // SCOPE_DEPENDENCIES is a Record over Claim["kind"], so this is really a
    // compile-time guarantee; the runtime check keeps it honest against edits.
    for (const claim of Object.values(CLAIM)) {
      expect(SCOPE_DEPENDENCIES[claim.kind], claim.kind).toBeDefined();
    }
  });
});
