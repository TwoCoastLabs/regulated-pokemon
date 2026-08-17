/**
 * Eligibility as a certified answer: the rule derived whole from pack,
 * snapshot and grant, every clause a bound slot, every tamper a named denial.
 */

import { describe, expect, it } from "vitest";

import type { Claim } from "./contracts.js";
import { deriveEligibility } from "./eligibility.js";
import { compileManifest, verifyManifest } from "./manifest.js";
import { planRender } from "./render.js";
import { denialCode } from "./violation.js";
import { manifestContext } from "../testing/fixtures.js";

const context = manifestContext();
const { registry, pack } = context;

describe("deriveEligibility reads the rules, the snapshot and the grant", () => {
  it("finds the governing rule and the verdict for a restricted species", () => {
    expect(deriveEligibility(registry, pack, 2, "mewtwo")).toEqual({
      ok: true,
      value: { eligible: false, badgeLevel: 2, ruleId: "legendary-acquisition", minimumBadgeLevel: 6 },
    });
    expect(deriveEligibility(registry, pack, 6, "mewtwo")).toEqual({
      ok: true,
      value: { eligible: true, badgeLevel: 6, ruleId: "legendary-acquisition", minimumBadgeLevel: 6 },
    });
    // Mew is mythical, which the pack holds to a stricter threshold.
    expect(deriveEligibility(registry, pack, 6, "mew")).toEqual({
      ok: true,
      value: { eligible: false, badgeLevel: 6, ruleId: "mythical-acquisition", minimumBadgeLevel: 8 },
    });
  });

  it("an unrestricted species is eligible with no rule to cite", () => {
    expect(deriveEligibility(registry, pack, 0, "pikachu")).toEqual({
      ok: true,
      value: { eligible: true, badgeLevel: 0 },
    });
  });

  it("refuses a fabricated species by name", () => {
    const result = deriveEligibility(registry, pack, 8, "missingno");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violations.map(denialCode)).toContain("IA-3/fabricated-entity");
  });
});

describe("an eligibility claim compiles, verifies and renders like any certified value", () => {
  const MEWTWO: Claim = { kind: "eligibility", entityId: "mewtwo" };
  // The shared fixture grant holds badge 8, where Mewtwo is within
  // accreditation; the not-yet case runs under a badge-2 grant below.
  const lowBadge = manifestContext(2);

  it("derives the finding at compile time; the model never stated it", () => {
    const result = compileManifest(lowBadge, { transactionId: "txn-elig", claims: [MEWTWO], rosters: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const claim = result.value.claims[0]!;
    expect(claim.kind === "eligibility" && claim.finding).toEqual({
      eligible: false,
      badgeLevel: 2,
      ruleId: "legendary-acquisition",
      minimumBadgeLevel: 6,
    });
  });

  it("is not advice: the finding compiles for a trainer the recommendation gate would refuse", () => {
    // The same species, the same badge-2 trainer: a recommendation is denied
    // under IA-5, the eligibility finding about it is certified information.
    const advice = compileManifest(lowBadge, {
      transactionId: "txn-advice",
      claims: [{ kind: "recommendation", entityId: "mewtwo" }],
      rosters: [],
    });
    expect(advice.ok).toBe(false);
    if (!advice.ok) expect(advice.violations.map(denialCode)).toContain("IA-5/restricted-species");

    const finding = compileManifest(lowBadge, { transactionId: "txn-elig", claims: [MEWTWO], rosters: [] });
    expect(finding.ok).toBe(true);
  });

  it("refuses a forged threshold, a mis-cited rule, and a verdict against the grant — one denial", () => {
    const compiledResult = compileManifest(lowBadge, { transactionId: "txn-elig", claims: [MEWTWO], rosters: [] });
    if (!compiledResult.ok) throw new Error("fixture manifest was refused");
    const manifest = compiledResult.value;
    const honest = (manifest.claims[0] as Extract<Claim, { kind: "eligibility" }>).finding!;

    for (const finding of [
      { ...honest, minimumBadgeLevel: 2 }, // forged threshold
      { ...honest, ruleId: "junior-league-exemption" }, // mis-cited rule
      { ...honest, eligible: true }, // verdict contradicting the grant
      { ...honest, badgeLevel: 6 }, // trainer's own standing misstated
    ]) {
      const doctored = { ...manifest, claims: [{ ...MEWTWO, finding }] };
      const verdict = verifyManifest(lowBadge, doctored);
      expect(verdict.allowed).toBe(false);
      expect(verdict.violations.map(denialCode)).toContain("IA-5/eligibility-mismatch");
    }
  });

  it("composes with an eligible alternative on one page, each claim under its own certificate", () => {
    const result = compileManifest(lowBadge, {
      transactionId: "txn-composed",
      claims: [MEWTWO, { kind: "recommendation", entityId: "snorlax" }],
      rosters: [],
    });
    expect(result.ok).toBe(true);
  });

  it("renders every clause as a bound slot — verdict polarity included", () => {
    const compiledResult = compileManifest(lowBadge, { transactionId: "txn-elig", claims: [MEWTWO], rosters: [] });
    if (!compiledResult.ok) throw new Error("fixture manifest was refused");
    const plan = planRender(lowBadge, compiledResult.value);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const unit = plan.value.units.find((entry) => entry.kind === "eligibility")!;
    expect(unit.id).toBe("eligibility:mewtwo");
    expect(unit.slots.map((slot) => [slot.name, slot.expected])).toEqual([
      ["entity", "Mewtwo"],
      ["verdict", "is not within your accreditation yet"],
      ["rule", "legendary-acquisition"],
      ["requires", "6"],
      ["held", "2"],
    ]);
  });

  it("renders an unrestricted species with 'none' for rule and threshold", () => {
    const result = compileManifest(context, {
      transactionId: "txn-elig-clear",
      claims: [{ kind: "eligibility", entityId: "pikachu" }],
      rosters: [],
    });
    if (!result.ok) throw new Error("fixture manifest was refused");
    const plan = planRender(context, result.value);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const unit = plan.value.units.find((entry) => entry.kind === "eligibility")!;
    expect(unit.slots.map((slot) => [slot.name, slot.expected])).toEqual([
      ["entity", "Pikachu"],
      ["verdict", "is within your accreditation"],
      ["rule", "none"],
      ["requires", "none"],
      ["held", "8"],
    ]);
  });
});

describe("verification edge paths", () => {
  it("an omitted finding defers to the derivation and can never disagree", () => {
    const compiled = compileManifest(manifestContext(2), {
      transactionId: "txn-defer",
      claims: [{ kind: "eligibility", entityId: "mewtwo" }],
      rosters: [],
    });
    if (!compiled.ok) throw new Error("fixture refused");
    // Strip the derived finding back off the record and verify: the claim
    // defers, exactly as a count with no stated number does.
    const stripped = { ...compiled.value, claims: [{ kind: "eligibility", entityId: "mewtwo" } as Claim] };
    expect(verifyManifest(manifestContext(2), stripped).allowed).toBe(true);
  });

  it("a fabricated species in an eligibility claim is refused at verification too", () => {
    const compiled = compileManifest(context, {
      transactionId: "txn-fab",
      claims: [{ kind: "eligibility", entityId: "pikachu" }],
      rosters: [],
    });
    if (!compiled.ok) throw new Error("fixture refused");
    const doctored = { ...compiled.value, claims: [{ kind: "eligibility", entityId: "missingno" } as Claim] };
    const verdict = verifyManifest(context, doctored);
    expect(verdict.allowed).toBe(false);
    expect(verdict.violations.map(denialCode)).toContain("IA-3/fabricated-entity");
  });
});
