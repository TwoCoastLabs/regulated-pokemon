/**
 * Eligibility derivation (IA-5): the rule itself as a certified answer —
 * epic #54, slice 2.
 *
 * The best response to a gated question is neither a bare denial nor a change
 * of subject: it is the rule, certified. "Mewtwo is legendary; under this rule
 * the League requires badge 6 to be advised toward it; you hold 2" is a fact
 * about the Accord pack, the snapshot and the trainer's own grant — every
 * clause derivable, so the model's whole contribution is naming the species.
 * The pack stops being only enforceable and becomes readable, through the same
 * discipline as every other derived value: the kernel computes the finding,
 * verification recomputes it, and a doctored threshold is a named refusal.
 *
 * Deliberately *not* advice: an eligibility claim states what the rules say,
 * and IA-5 still gates any actual recommendation of the species. The two may
 * share a page — a verdict beside an eligible alternative — with each claim
 * carrying its own certificate.
 */

import type { Resolution } from "./contracts.js";
import { type AccordPack, restrictionsFor } from "./pack.js";
import type { CertifiedRegistry } from "./registry.js";
import { violation } from "./violation.js";

/**
 * The derived verdict, whole. `ruleId`/`minimumBadgeLevel` are present exactly
 * when a restriction governs the species; an unrestricted species is eligible
 * with no rule to cite.
 */
export interface EligibilityFinding {
  eligible: boolean;
  /** The badge level of the grant this finding was derived under. */
  badgeLevel: number;
  ruleId?: string;
  minimumBadgeLevel?: number;
}

/**
 * Derive the finding for one species under one grant, or refuse by name.
 *
 * Where several rules govern one species, the strictest wins: a trainer
 * cleared for the highest threshold is cleared for the rest, and a finding
 * that cited a looser rule would understate what the pack demands.
 */
export function deriveEligibility(
  registry: CertifiedRegistry,
  pack: AccordPack,
  badgeLevel: number,
  entityId: string,
): Resolution<EligibilityFinding> {
  const species = registry.findSpecies(entityId);
  if (species === undefined) {
    return {
      ok: false,
      violations: [
        violation("IA-3", "fabricated-entity", `"${entityId}" is not certified by snapshot ${registry.snapshot.id}`, {
          expected: `a species in ${registry.snapshot.id}`,
          actual: entityId,
        }),
      ],
    };
  }

  const rules = restrictionsFor(pack, species);
  if (rules.length === 0) return { ok: true, value: { eligible: true, badgeLevel } };

  const strictest = rules.reduce((left, right) =>
    right.minimumBadgeLevel > left.minimumBadgeLevel ? right : left,
  );
  return {
    ok: true,
    value: {
      eligible: badgeLevel >= strictest.minimumBadgeLevel,
      badgeLevel,
      ruleId: strictest.id,
      minimumBadgeLevel: strictest.minimumBadgeLevel,
    },
  };
}

export function sameFinding(left: EligibilityFinding, right: EligibilityFinding): boolean {
  return (
    left.eligible === right.eligible &&
    left.badgeLevel === right.badgeLevel &&
    left.ruleId === right.ruleId &&
    left.minimumBadgeLevel === right.minimumBadgeLevel
  );
}

export function describeFinding(finding: EligibilityFinding): string {
  const rule =
    finding.ruleId === undefined
      ? "no rule applies"
      : `"${finding.ruleId}" requires badge ${finding.minimumBadgeLevel}`;
  return `${finding.eligible ? "eligible" : "not eligible"} at badge ${finding.badgeLevel} (${rule})`;
}
