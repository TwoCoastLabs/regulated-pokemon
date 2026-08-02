import { describe, expect, it } from "vitest";

import { kantoRegistry } from "../testing/fixtures.js";
import type { ClosedRoster, RosterCriteria } from "./contracts.js";
import { buildRoster, describeCriteria, verifyRoster } from "./roster.js";
import { denialCode } from "./violation.js";

const registry = kantoRegistry();

function roster(id: string, criteria: RosterCriteria): ClosedRoster {
  const built = buildRoster(registry, id, criteria);
  if (!built.ok) throw new Error(`fixture roster failed: ${built.violations.map(denialCode).join(", ")}`);
  return built.value;
}

const electric = roster("electric-kanto", { all: [{ kind: "has-type", type: "electric" }] });

describe("a roster is a set, and the set is the count", () => {
  it("enumerates every member in Pokédex order", () => {
    expect(electric.memberIds).toEqual([
      "pikachu",
      "raichu",
      "magnemite",
      "magneton",
      "voltorb",
      "electrode",
      "electabuzz",
      "jolteon",
      "zapdos",
    ]);
    expect(electric.cardinality).toBe(electric.memberIds.length);
  });

  it("answers the whole Pokédex when no criteria narrow it", () => {
    const everything = roster("kanto", { all: [] });
    expect(everything.cardinality).toBe(151);
    expect(describeCriteria(everything.criteria)).toBe("every certified species");
  });

  it("composes criteria as a conjunction", () => {
    const fast = roster("fast-electric", {
      all: [
        { kind: "has-type", type: "electric" },
        { kind: "stat-at-least", stat: "speed", value: 100 },
      ],
    });
    // Raichu is here at base speed 110, which is its *present-day* value; in
    // Red/Blue it was 100. Upstream does not publish historical base stats,
    // so the snapshot says so in source.caveats and the roster is certified
    // against these bytes rather than against the cartridge. The set is
    // provable; what it is provable *about* is stated, not implied.
    expect(fast.memberIds).toEqual(["raichu", "voltorb", "electrode", "electabuzz", "jolteon", "zapdos"]);
  });

  it("resolves membership against the Red/Blue learnset", () => {
    const boom = roster("selfdestructors", { all: [{ kind: "learns-move", move: "self-destruct" }] });
    expect(boom.cardinality).toBe(20);
    expect(boom.memberIds).toContain("geodude");
    expect(boom.memberIds).not.toContain("pikachu");
  });

  it("separates legendary from mythical", () => {
    expect(roster("legends", { all: [{ kind: "rarity", rarity: "legendary" }] }).memberIds).toEqual([
      "articuno",
      "zapdos",
      "moltres",
      "mewtwo",
    ]);
    expect(roster("myths", { all: [{ kind: "rarity", rarity: "mythical" }] }).memberIds).toEqual(["mew"]);
  });

  it("verifies clean with no violations", () => {
    expect(verifyRoster(registry, electric)).toEqual({ allowed: true, violations: [] });
  });
});

describe("criteria the snapshot cannot evaluate are refused, not answered emptily", () => {
  it("refuses an uncertified type", () => {
    // Steel exists in later generations; answering "zero" here would be a
    // fabricated answer dressed as a complete one.
    const built = buildRoster(registry, "steel-kanto", { all: [{ kind: "has-type", type: "steel" }] });
    expect(built.ok).toBe(false);
    expect(built.ok === false && denialCode(built.violations[0]!)).toBe("IA-3/unknown-type");
  });

  it("refuses an invented move", () => {
    const built = buildRoster(registry, "invented", { all: [{ kind: "learns-move", move: "hyper-fang-blast" }] });
    expect(built.ok).toBe(false);
    expect(built.ok === false && denialCode(built.violations[0]!)).toBe("IA-3/unknown-move");
  });
});

describe("verification recomputes the roster from its own criteria", () => {
  it("denies a member that does not exist", () => {
    const verdict = verifyRoster(registry, { ...electric, memberIds: [...electric.memberIds, "missingno"] });
    expect(verdict.allowed).toBe(false);
    expect(verdict.violations.map(denialCode)).toContain("IA-3/fabricated-entity");
    // Cardinality is also wrong now, and both are reported: a denial that
    // stops at the first problem hides the rest of the tampering.
    expect(verdict.violations.map(denialCode)).toContain("IA-4/cardinality-mismatch");
  });

  it("denies a dropped member", () => {
    const verdict = verifyRoster(registry, {
      ...electric,
      memberIds: electric.memberIds.filter((id) => id !== "zapdos"),
      cardinality: electric.cardinality - 1,
    });
    expect(verdict.violations.map(denialCode)).toEqual(["IA-4/roster-member-missing"]);
    expect(verdict.violations[0]!.actual).toBe("zapdos");
  });

  it("denies a member that fails the criteria", () => {
    const verdict = verifyRoster(registry, {
      ...electric,
      memberIds: [...electric.memberIds, "snorlax"],
      cardinality: electric.cardinality + 1,
    });
    expect(verdict.violations.map(denialCode)).toEqual(["IA-4/roster-member-extra"]);
  });

  it("denies a tampered count even when the members are right", () => {
    const verdict = verifyRoster(registry, { ...electric, cardinality: 8 });
    expect(verdict.violations.map(denialCode)).toEqual(["IA-4/cardinality-mismatch"]);
    expect(verdict.violations[0]!.expected).toBe("9");
    expect(verdict.violations[0]!.actual).toBe("8");
  });

  it("denies a duplicated member", () => {
    const verdict = verifyRoster(registry, {
      ...electric,
      memberIds: [...electric.memberIds, "pikachu"],
      cardinality: electric.cardinality + 1,
    });
    expect(verdict.violations.map(denialCode)).toContain("IA-4/roster-duplicate-member");
  });

  it("denies a reordered roster, because replay must reproduce exactly", () => {
    const verdict = verifyRoster(registry, {
      ...electric,
      memberIds: [...electric.memberIds].reverse(),
    });
    expect(verdict.violations.map(denialCode)).toEqual(["IA-4/roster-order-mismatch"]);
  });

  it("denies a roster certified against another snapshot", () => {
    const verdict = verifyRoster(registry, { ...electric, snapshotId: "kanto-yellow" });
    expect(verdict.violations.map(denialCode)).toEqual(["IA-2/snapshot-mismatch"]);
    expect(verdict.violations[0]!.expected).toBe("kanto-red-blue");
  });

  it("denies criteria that were tampered with after certification", () => {
    const verdict = verifyRoster(registry, {
      ...electric,
      criteria: { all: [{ kind: "has-type", type: "water" }] },
    });
    expect(verdict.allowed).toBe(false);
    expect(new Set(verdict.violations.map(denialCode))).toEqual(
      new Set(["IA-4/roster-member-missing", "IA-4/roster-member-extra"]),
    );
    // The stated count still matches the enumerated set, so cardinality is
    // silent: swapping the criteria is caught by recomputation, which is the
    // only check a self-consistent forgery cannot satisfy.
    expect(verdict.violations.map(denialCode)).not.toContain("IA-4/cardinality-mismatch");
  });
});
