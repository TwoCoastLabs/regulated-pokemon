/**
 * The Center world's claim shapes (epic #94, slice 3, PR 2), exercised arm by
 * arm: the derivations that fill what the model omitted, the refusals the
 * crucible does not own, the comparison's tie and absence edges, and the item
 * criteria in every direction. The crucible carries the named sabotages; this
 * file carries the branches.
 */

import { describe, expect, it } from "vitest";

import { describeClaim } from "../ui/viewmodel.js";
import type { Claim } from "./contracts.js";
import { compileManifest, verifyManifest } from "./manifest.js";
import { planRender } from "./render.js";
import { buildRoster, describeCriteria, verifyRoster } from "./roster.js";
import { denialCode } from "./violation.js";
import { centerContext } from "../testing/fixtures.js";

const center = centerContext();

function compiled(claims: readonly Claim[], rosters: Parameters<typeof compileManifest>[1]["rosters"] = []) {
  return compileManifest(center, { transactionId: "txn-center-shapes", claims, rosters });
}

function denials(claims: readonly Claim[]): string[] {
  const result = compiled(claims);
  return result.ok ? verifyManifest(center, result.value).violations.map(denialCode) : result.violations.map(denialCode);
}

describe("treats, derived and refused", () => {
  it("fills the verdict from the closed effect set — the certified negative included", () => {
    const yes = compiled([{ kind: "treats", itemId: "antidote", condition: "poison" }]);
    expect(yes.ok && yes.value.claims[0]).toMatchObject({ kind: "treats", asserted: true });
    const no = compiled([{ kind: "treats", itemId: "antidote", condition: "burn" }]);
    expect(no.ok && no.value.claims[0]).toMatchObject({ kind: "treats", asserted: false });
  });

  it("accepts a correctly asserted negative", () => {
    expect(denials([{ kind: "treats", itemId: "antidote", condition: "burn", asserted: false }])).toEqual([]);
  });

  it("refuses a verdict about an item that does not exist, as a fabrication", () => {
    expect(denials([{ kind: "treats", itemId: "mega-antidote", condition: "poison", asserted: true }])).toContain(
      "IA-3/fabricated-entity",
    );
  });

  it("leaves a verdict about an unknown item underived, and the fabrication is named", () => {
    // deriveClaims cannot fill against an item the world does not carry; the
    // claim passes through unfilled and the verifier names the fabrication.
    expect(denials([{ kind: "treats", itemId: "mega-antidote", condition: "poison" }])).toContain("IA-3/fabricated-entity");
  });

  it("plans an underived treats verdict by recomputing it from the effect set", () => {
    // A manifest can arrive with the verdict omitted (the grounded shape); the
    // plan recomputes it rather than trusting a counter kept elsewhere.
    const result = compiled([{ kind: "treats", itemId: "burn-heal", condition: "burn" }]);
    if (!result.ok) throw new Error(result.violations.map(denialCode).join(", "));
    const stripped = {
      ...result.value,
      claims: result.value.claims.map((claim) => (claim.kind === "treats" ? { ...claim, asserted: undefined } : claim)),
    };
    const planned = planRender(center, stripped);
    if (!planned.ok) throw new Error(planned.violations.map(denialCode).join(", "));
    const unit = planned.value.units.find((entry) => entry.kind === "treats");
    expect(unit?.slots.find((entry) => entry.name === "verdict")?.expected).toBe("yes");
  });

  it("leaves an underivable claim unfilled, for the verifier to name", () => {
    const unknown = compiled([{ kind: "treats", itemId: "antidote", condition: "sadness" }]);
    expect(unknown.ok).toBe(false);
    expect(!unknown.ok && unknown.violations.map(denialCode)).toContain("IA-2/unknown-condition");
  });
});

describe("comparison, derived and refused", () => {
  it("fills both sides from the records", () => {
    const result = compiled([{ kind: "comparison", factId: "restores-hp", leftId: "super-potion", rightId: "potion" }]);
    expect(result.ok && result.value.claims[0]).toMatchObject({
      left: { kind: "number", value: 50 },
      right: { kind: "number", value: 20 },
    });
  });

  it("refuses a doctored right side as its own mismatch", () => {
    expect(
      denials([
        {
          kind: "comparison",
          factId: "cost",
          leftId: "potion",
          rightId: "super-potion",
          left: { kind: "number", value: 200 },
          right: { kind: "number", value: 9999 },
        },
      ]),
    ).toContain("IA-2/comparison-mismatch");
  });

  it("renders a tie with no leader and a zero gap, and an equal pair stays certified", () => {
    // fresh-water and super-potion both restore 50.
    const result = compiled([{ kind: "comparison", factId: "restores-hp", leftId: "fresh-water", rightId: "super-potion" }]);
    if (!result.ok) throw new Error(result.violations.map(denialCode).join(", "));
    const planned = planRender(center, result.value);
    if (!planned.ok) throw new Error(planned.violations.map(denialCode).join(", "));
    const unit = planned.value.units.find((entry) => entry.kind === "comparison");
    const slot = (name: string) => unit?.slots.find((entry) => entry.name === name);
    expect(slot("gap")?.expected).toBe("0");
    expect(slot("leader")?.value).toEqual({ kind: "absent" });
    expect(slot("leftvalue")?.expected).toBe("50");
  });

  it("refuses to compare across a fact only one side certifies", () => {
    expect(denials([{ kind: "comparison", factId: "repel-steps", leftId: "repel", rightId: "potion" }])).toContain(
      "IA-2/incomparable-fact",
    );
  });
});

describe("item rosters, in every direction", () => {
  it("builds by category, by cost bound, and describes itself plainly", () => {
    const healing = buildRoster(center.registry, "healing", { all: [{ kind: "item-category", category: "healing" }] });
    expect(healing.ok && healing.value.memberIds).toContain("potion");
    const cheap = buildRoster(center.registry, "cheap-cures", {
      all: [
        { kind: "treats-condition", condition: "poison" },
        { kind: "cost-at-most", value: 300 },
      ],
    });
    expect(cheap.ok && cheap.value.memberIds).toEqual(["antidote"]);
    const pricey = buildRoster(center.registry, "pricey", { all: [{ kind: "cost-at-least", value: 3000 }] });
    expect(pricey.ok && pricey.value.memberIds).toContain("full-restore");
    expect(describeCriteria({ all: [{ kind: "item-category", category: "healing" }, { kind: "cost-at-most", value: 300 }] })).toBe(
      "in the healing category and costing at most 300",
    );
    expect(describeCriteria({ all: [{ kind: "treats-condition", condition: "poison" }, { kind: "cost-at-least", value: 100 }] })).toBe(
      "that treat poison and costing at least 100",
    );
  });

  it("refuses an unknown category and an unknown condition by name", () => {
    const category = buildRoster(center.registry, "x", { all: [{ kind: "item-category", category: "snacks" }] });
    expect(!category.ok && category.violations.map(denialCode)).toContain("IA-3/unknown-item-category");
    const condition = buildRoster(center.registry, "y", { all: [{ kind: "treats-condition", condition: "boredom" }] });
    expect(!condition.ok && condition.violations.map(denialCode)).toContain("IA-3/unknown-condition");
  });

  it("verifies an item roster's membership and catches a smuggled member as a fabrication", () => {
    const built = buildRoster(center.registry, "cures-poison", { all: [{ kind: "treats-condition", condition: "poison" }] });
    if (!built.ok) throw new Error("fixture roster");
    expect(verifyRoster(center.registry, built.value).allowed).toBe(true);
    const smuggled = { ...built.value, memberIds: [...built.value.memberIds, "missingno"], cardinality: built.value.cardinality + 1 };
    expect(verifyRoster(center.registry, smuggled).violations.map(denialCode)).toContain("IA-3/fabricated-entity");
  });

  it("counts and tests membership over item rosters through the ordinary claims", () => {
    // Ranking an item roster by cost is deliberately absent here: the ranking
    // basis must be a scope the trainer established, and the pack's
    // comparison-basis vocabulary knows only species stats today. The kernel's
    // ranking path is domain-agnostic already; the vocabulary widening is the
    // Center pack's to make (slice 3, PR 3), and the ranking lands with it.
    const built = buildRoster(center.registry, "cures-poison", { all: [{ kind: "treats-condition", condition: "poison" }] });
    if (!built.ok) throw new Error("fixture roster");
    const result = compiled(
      [
        { kind: "count", rosterId: built.value.id },
        { kind: "membership", rosterId: built.value.id, entityId: "antidote", asserted: true },
        // The certified negative for membership: a species is not a member of
        // an item set, and the closed set says so itself.
        { kind: "membership", rosterId: built.value.id, entityId: "pikachu", asserted: false },
      ],
      [built.value],
    );
    if (!result.ok) throw new Error(result.violations.map(denialCode).join(", "));
    expect(verifyManifest(center, result.value).allowed).toBe(true);
  });
});

describe("the console can say the new claims", () => {
  it("describes treats and comparison in the ledger's register", () => {
    expect(describeClaim({ kind: "treats", itemId: "antidote", condition: "burn", asserted: false })).toContain("does not treat");
    expect(describeClaim({ kind: "treats", itemId: "antidote", condition: "poison" })).toContain("derived by the kernel");
    expect(describeClaim({ kind: "comparison", factId: "cost", leftId: "potion", rightId: "super-potion" })).toContain("potion vs super-potion");
  });
});
