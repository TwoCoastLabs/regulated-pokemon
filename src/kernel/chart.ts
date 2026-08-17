/**
 * Matchup derivation (IA-2, IA-4): effectiveness read off the certified chart,
 * never off anybody's memory of it.
 *
 * The same discipline as counts and rankings, extended to a relation: the
 * model names a subject and a direction, and the members of the answer are
 * kernel arithmetic over the snapshot's complete chart. The model never states
 * a multiplier, so there is nothing for it to misremember — a wrong weakness
 * is not a reachable output, and a doctored chart is a loader refusal long
 * before anything derives from it.
 *
 * Directions are the four questions the chart can actually answer. Three are
 * about defending, and compose over a dual type by multiplying the cells —
 * which is the game's own rule, not an interpretation. The fourth,
 * `strong-against`, is about attacking, and only a *type* attacks: a species'
 * offense runs through the moves it knows, not the types it has, so a species
 * asked for `strong-against` is refused by name rather than answered with a
 * plausible confusion.
 */

import type { Resolution } from "./contracts.js";
import type { CertifiedRegistry } from "./registry.js";
import { violation } from "./violation.js";

export type MatchupDirection = "weak-to" | "resists" | "immune-to" | "strong-against";

export const MATCHUP_DIRECTIONS: readonly MatchupDirection[] = [
  "weak-to",
  "resists",
  "immune-to",
  "strong-against",
];

export type MatchupSubject =
  | { kind: "species"; entityId: string }
  | { kind: "type"; typeId: string };

/** A stable id fragment for units and messages: what the claim is about. */
export function matchupSubjectId(subject: MatchupSubject): string {
  return subject.kind === "species" ? subject.entityId : subject.typeId;
}

/**
 * Derive the members of a matchup claim from the certified chart, or refuse by
 * name. The result is sorted, so two derivations of the same claim are equal
 * lists and verification is one comparison.
 */
export function deriveMatchup(
  registry: CertifiedRegistry,
  subject: MatchupSubject,
  direction: MatchupDirection,
): Resolution<readonly string[]> {
  const chart = registry.typeChart;

  if (subject.kind === "species") {
    const species = registry.findSpecies(subject.entityId);
    if (species === undefined) {
      return refuse(
        violation("IA-3", "fabricated-entity", `"${subject.entityId}" is not certified by snapshot ${registry.snapshot.id}`, {
          expected: `a species in ${registry.snapshot.id}`,
          actual: subject.entityId,
        }),
      );
    }
    if (direction === "strong-against") {
      return refuse(
        violation("IA-2", "matchup-inapplicable", `a species defends with its typing; what ${subject.entityId} is strong against is a property of its moves, which this chart does not certify`, {
          expected: "weak-to, resists or immune-to for a species; strong-against for a type",
          actual: `${subject.entityId} strong-against`,
        }),
      );
    }
    // Defending with a dual type multiplies the cells — the game's own rule.
    const combined = (attacking: string): number =>
      species.types.reduce((product, defending) => product * (registry.multiplier(attacking, defending) ?? 1), 1);
    return { ok: true, value: chart.types.filter((attacking) => selects(direction, combined(attacking))) };
  }

  if (!chart.types.includes(subject.typeId)) {
    return refuse(
      violation("IA-3", "fabricated-type", `"${subject.typeId}" is not a type this generation's chart certifies`, {
        expected: chart.types.join(", "),
        actual: subject.typeId,
      }),
    );
  }
  if (direction === "strong-against") {
    return {
      ok: true,
      value: chart.types.filter((defending) => (registry.multiplier(subject.typeId, defending) ?? 1) > 1),
    };
  }
  return {
    ok: true,
    value: chart.types.filter((attacking) => selects(direction, registry.multiplier(attacking, subject.typeId) ?? 1)),
  };
}

/** Which combined multiplier a defending direction names. */
function selects(direction: Exclude<MatchupDirection, "strong-against">, multiplier: number): boolean {
  switch (direction) {
    case "weak-to":
      return multiplier > 1;
    case "resists":
      return multiplier > 0 && multiplier < 1;
    case "immune-to":
      return multiplier === 0;
  }
}

function refuse(...violations: ReturnType<typeof violation>[]): { ok: false; violations: typeof violations } {
  return { ok: false, violations };
}
