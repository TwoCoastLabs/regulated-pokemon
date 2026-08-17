/**
 * Matchup derivation against the vendored gen-I chart: the era's own numbers,
 * including its famous quirk, plus every named refusal — and the whole path
 * from a model-shaped claim to the strings a certified page must show.
 */

import { describe, expect, it } from "vitest";

import { deriveMatchup } from "./chart.js";
import type { Claim } from "./contracts.js";
import { compileManifest, verifyManifest } from "./manifest.js";
import { planRender } from "./render.js";
import { denialCode } from "./violation.js";
import { manifestContext } from "../testing/fixtures.js";

const context = manifestContext();
const registry = context.registry;

function derived(subject: Parameters<typeof deriveMatchup>[1], direction: Parameters<typeof deriveMatchup>[2]) {
  const result = deriveMatchup(registry, subject, direction);
  if (!result.ok) throw new Error(`expected a derivation: ${result.violations.map(denialCode).join(", ")}`);
  return result.value;
}

function refused(subject: Parameters<typeof deriveMatchup>[1], direction: Parameters<typeof deriveMatchup>[2]) {
  const result = deriveMatchup(registry, subject, direction);
  if (result.ok) throw new Error("expected a refusal");
  return result.violations.map(denialCode);
}

describe("deriveMatchup reads the era's chart, not the modern one", () => {
  it("composes a dual type by multiplying cells — Gengar (ghost/poison) in gen I", () => {
    // Ground 2×1, psychic 1×2, and ghost 2×1 — gen-I ghost is super-effective
    // against ghost. Notably absent: dark, which does not exist yet.
    expect(derived({ kind: "species", entityId: "gengar" }, "weak-to")).toEqual(["ghost", "ground", "psychic"]);
    // Fighting and normal both deal 0× into ghost, and poison does not undo an
    // immunity: 0 × anything is 0.
    expect(derived({ kind: "species", entityId: "gengar" }, "immune-to")).toEqual(["fighting", "normal"]);
  });

  it("preserves the gen-I ghost/psychic bug as certified fact", () => {
    // In generation I, Ghost deals no damage to Psychic. A modern chart says
    // double. The snapshot's name promises Red/Blue's world.
    expect(registry.multiplier("ghost", "psychic")).toBe(0);
    expect(derived({ kind: "type", typeId: "psychic" }, "immune-to")).toContain("ghost");
    expect(derived({ kind: "type", typeId: "ghost" }, "strong-against")).not.toContain("psychic");
  });

  it("answers the four directions for a type subject", () => {
    expect(derived({ kind: "type", typeId: "electric" }, "strong-against")).toEqual(["flying", "water"]);
    expect(derived({ kind: "type", typeId: "electric" }, "weak-to")).toEqual(["ground"]);
    expect(derived({ kind: "type", typeId: "electric" }, "resists")).toEqual(["electric", "flying"]);
    expect(derived({ kind: "type", typeId: "flying" }, "immune-to")).toEqual(["ground"]);
  });

  it("an empty answer is a certified empty list, not a refusal", () => {
    // Normal resists nothing in gen I; it is immune to ghost.
    expect(derived({ kind: "type", typeId: "normal" }, "resists")).toEqual([]);
    expect(derived({ kind: "type", typeId: "normal" }, "immune-to")).toEqual(["ghost"]);
  });

  it("refuses a fabricated species, a fabricated type, and a species asked to attack", () => {
    expect(refused({ kind: "species", entityId: "missingno" }, "weak-to")).toContain("IA-3/fabricated-entity");
    expect(refused({ kind: "type", typeId: "fairy" }, "weak-to")).toContain("IA-3/fabricated-type");
    expect(refused({ kind: "species", entityId: "gengar" }, "strong-against")).toContain("IA-2/matchup-inapplicable");
  });
});

describe("a matchup claim compiles, verifies and renders like any certified value", () => {
  const GENGAR_WEAKNESS: Claim = {
    kind: "matchup",
    subject: { kind: "species", entityId: "gengar" },
    direction: "weak-to",
  };

  it("compileManifest derives the members; the model never stated them", () => {
    const result = compileManifest(context, { transactionId: "txn-chart", claims: [GENGAR_WEAKNESS], rosters: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const claim = result.value.claims[0]!;
    expect(claim.kind === "matchup" && claim.members).toEqual(["ghost", "ground", "psychic"]);
  });

  it("a doctored member list is refused by name, dropped or added alike", () => {
    const compiledResult = compileManifest(context, { transactionId: "txn-chart", claims: [GENGAR_WEAKNESS], rosters: [] });
    if (!compiledResult.ok) throw new Error("fixture manifest was refused");
    const manifest = compiledResult.value;

    for (const members of [["ground", "psychic"], ["ghost", "ground", "normal", "psychic"], ["ground", "water"]]) {
      const doctored = {
        ...manifest,
        claims: [{ ...GENGAR_WEAKNESS, members }],
      };
      const verdict = verifyManifest(context, doctored);
      expect(verdict.allowed).toBe(false);
      expect(verdict.violations.map(denialCode)).toContain("IA-4/matchup-mismatch");
    }
  });

  it("renders through bound slots — subject, direction word, and the list", () => {
    const compiledResult = compileManifest(context, { transactionId: "txn-chart", claims: [GENGAR_WEAKNESS], rosters: [] });
    if (!compiledResult.ok) throw new Error("fixture manifest was refused");
    const plan = planRender(context, compiledResult.value);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    const unit = plan.value.units.find((entry) => entry.kind === "matchup")!;
    expect(unit.id).toBe("matchup:gengar:weak-to");
    expect(unit.slots.map((slot) => [slot.name, slot.expected])).toEqual([
      ["subject", "Gengar"],
      // The direction is a bound rendering, not renderer prose: "ground and
      // psychic" beside "Gengar" would otherwise be equally consistent with a
      // weakness and a resistance.
      ["direction", "is weak to"],
      // en-US carries the serial comma; the same plan for en-GB would not.
      ["members", "ghost, ground, and psychic"],
    ]);
  });

  it("renders an empty matchup as a certified 'none'", () => {
    const claim: Claim = { kind: "matchup", subject: { kind: "type", typeId: "normal" }, direction: "resists" };
    const compiledResult = compileManifest(context, { transactionId: "txn-chart", claims: [claim], rosters: [] });
    if (!compiledResult.ok) throw new Error("fixture manifest was refused");
    const plan = planRender(context, compiledResult.value);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const unit = plan.value.units.find((entry) => entry.kind === "matchup")!;
    expect(unit.slots.find((slot) => slot.name === "members")?.expected).toBe("none");
  });
});
