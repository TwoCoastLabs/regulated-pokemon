import { describe, expect, it } from "vitest";

import { describeClaim, violationView } from "./viewmodel.js";

describe("describeClaim", () => {
  it("states each kind of claim, including the derived-value forms", () => {
    expect(describeClaim({ kind: "fact", entityId: "pikachu", factId: "base-speed", asserted: { kind: "number", value: 90 } })).toBe(
      "pikachu: base-speed = 90",
    );
    expect(describeClaim({ kind: "fact", entityId: "onix", factId: "types", asserted: { kind: "list", value: ["rock", "ground"] } })).toBe(
      "onix: types = rock, ground",
    );
    expect(describeClaim({ kind: "fact", entityId: "ditto", factId: "legendary", asserted: { kind: "boolean", value: false } })).toBe(
      "ditto: legendary = false",
    );
    expect(describeClaim({ kind: "fact", entityId: "mew", factId: "note", asserted: { kind: "text", value: "mythical" } })).toBe(
      "mew: note = mythical",
    );
    expect(describeClaim({ kind: "fact", entityId: "splash", factId: "power", asserted: { kind: "absent" } })).toBe(
      "splash: power = absent (certified)",
    );
    expect(describeClaim({ kind: "count", rosterId: "poison-types" })).toBe("count(poison-types) — derived by the kernel");
    expect(describeClaim({ kind: "count", rosterId: "poison-types", reported: 33 })).toBe("count(poison-types) = 33");
    expect(describeClaim({ kind: "typeCount" })).toBe("typeCount() — derived by the kernel");
    expect(describeClaim({ kind: "typeCount", reported: 15 })).toBe("typeCount() = 15");
    expect(describeClaim({ kind: "membership", rosterId: "poison-types", entityId: "grimer", asserted: true })).toBe(
      "grimer ∈ poison-types",
    );
    expect(describeClaim({ kind: "membership", rosterId: "poison-types", entityId: "pikachu", asserted: false })).toBe(
      "pikachu ∉ poison-types",
    );
    expect(describeClaim({ kind: "ranking", rosterId: "kanto", basis: "base-speed", direction: "highest" })).toBe(
      "highest base-speed of kanto — winner derived by the kernel",
    );
    expect(
      describeClaim({ kind: "ranking", rosterId: "kanto", basis: "base-speed", direction: "highest", selectedEntityId: "electrode" }),
    ).toBe("highest base-speed of kanto → electrode");
    expect(describeClaim({ kind: "recommendation", entityId: "snorlax" })).toBe("recommend snorlax");
    expect(describeClaim({ kind: "action", tool: "release", entityId: "raticate" })).toBe("release(raticate)");
  });
});

describe("violationView", () => {
  it("joins a denial to its article, with what it expected against what it found", () => {
    const view = violationView({
      article: "IA-5",
      rule: "restricted-species",
      message: "zapdos is gated",
      expected: "badge level 6",
      actual: "badge level 2",
    });
    expect(view).toEqual({
      code: "IA-5/restricted-species",
      articleTitle: "Restricted Species",
      analog: "Accredited-investor / complex-product gating",
      message: "zapdos is gated",
      expected: "badge level 6",
      actual: "badge level 2",
    });
  });

  it("omits expected/actual when the denial carried none", () => {
    const view = violationView({ article: "IA-3", rule: "fabricated-entity", message: "no such species" });
    expect(view.code).toBe("IA-3/fabricated-entity");
    expect("expected" in view).toBe(false);
  });
});

describe("the console line for the derived claim kinds", () => {
  it("states a matchup with and without its derived members", () => {
    expect(describeClaim({ kind: "matchup", subject: { kind: "species", entityId: "gengar" }, direction: "weak-to" })).toContain("derived by the kernel");
    expect(
      describeClaim({ kind: "matchup", subject: { kind: "type", typeId: "electric" }, direction: "strong-against", members: ["flying", "water"] }),
    ).toContain("flying, water");
  });

  it("states an eligibility finding in all three shapes", () => {
    expect(describeClaim({ kind: "eligibility", entityId: "mewtwo" })).toContain("derived by the kernel");
    expect(
      describeClaim({ kind: "eligibility", entityId: "mewtwo", finding: { eligible: true, badgeLevel: 8 } }),
    ).toContain("within accreditation");
    expect(
      describeClaim({
        kind: "eligibility",
        entityId: "mewtwo",
        finding: { eligible: false, badgeLevel: 2, ruleId: "legendary-acquisition", minimumBadgeLevel: 6 },
      }),
    ).toContain("requires badge 6, holds 2");
  });
});
