/**
 * Closed rosters (IA-4): a complete answer carries its own certificate.
 *
 * "How many Kanto Pokémon are Electric?" is not a number, it is a *set*. The
 * roster enumerates every member and states its own cardinality, and the
 * verifier recomputes both from the roster's declarative criteria. A count
 * with no enumerable set behind it cannot be certified, so it cannot ship.
 *
 * Criteria are data, not predicates written in agent code: that is what lets
 * a roster be re-derived during verification and, later, during replay.
 */

import type { ClosedRoster, RosterCriteria, RosterCriterion, Resolution, Verdict, Violation } from "./contracts.js";
import type { CertifiedRegistry } from "./registry.js";
import type { SnapshotSpecies } from "./snapshot-format.js";
import { verdictOf, violation } from "./violation.js";

/**
 * Build a roster from its criteria. Every term is checked against the
 * snapshot's vocabulary first: an unknown type or move is refused rather
 * than quietly matching nothing, because "no Pokémon can learn Hyper Fang
 * Blast" is a fabricated answer to a fabricated question — the empty set is
 * a claim, and this snapshot cannot support it.
 */
export function buildRoster(
  registry: CertifiedRegistry,
  id: string,
  criteria: RosterCriteria,
): Resolution<ClosedRoster> {
  const violations = checkVocabulary(registry, criteria);
  if (violations.length > 0) return { ok: false, violations };

  const members = selectMembers(registry, criteria);
  return {
    ok: true,
    value: {
      id,
      snapshotId: registry.snapshot.id,
      criteria,
      memberIds: members.map((species) => species.id),
      cardinality: members.length,
    },
  };
}

/**
 * Recompute a roster from its own criteria and report every disagreement by
 * name. This is the enforcement primitive: a roster that arrives from
 * anywhere — a model, a cache, a mutated fixture — is only as good as this.
 */
export function verifyRoster(registry: CertifiedRegistry, roster: ClosedRoster): Verdict {
  if (roster.snapshotId !== registry.snapshot.id) {
    return verdictOf([
      violation("IA-2", "snapshot-mismatch", `roster ${roster.id} was certified against another snapshot`, {
        expected: registry.snapshot.id,
        actual: roster.snapshotId,
      }),
    ]);
  }

  const vocabulary = checkVocabulary(registry, roster.criteria);
  if (vocabulary.length > 0) return verdictOf(vocabulary);

  const violations: Violation[] = [];

  // Fabrications are named first and then excluded from the set comparison,
  // so an injected MissingNo is denied as a fabrication (IA-3) rather than
  // being mislabelled as a merely surplus member (IA-4).
  const fabricated = roster.memberIds.filter((memberId) => registry.findSpecies(memberId) === undefined);
  for (const memberId of fabricated) {
    violations.push(
      violation("IA-3", "fabricated-entity", `roster ${roster.id} contains "${memberId}", which is not certified`, {
        expected: `a species in ${registry.snapshot.id}`,
        actual: memberId,
      }),
    );
  }

  for (const duplicate of new Set(
    roster.memberIds.filter((memberId, index) => roster.memberIds.indexOf(memberId) !== index),
  )) {
    violations.push(
      violation("IA-4", "roster-duplicate-member", `roster ${roster.id} lists "${duplicate}" more than once`, {
        actual: duplicate,
      }),
    );
  }

  const expected = selectMembers(registry, roster.criteria).map((species) => species.id);
  const claimed = roster.memberIds.filter((memberId) => !fabricated.includes(memberId));
  const claimedSet = new Set(claimed);

  for (const memberId of expected.filter((candidate) => !claimedSet.has(candidate))) {
    violations.push(
      violation("IA-4", "roster-member-missing", `roster ${roster.id} omits "${memberId}", which meets its criteria`, {
        actual: memberId,
      }),
    );
  }
  const expectedSet = new Set(expected);
  for (const memberId of claimed.filter((candidate) => !expectedSet.has(candidate))) {
    violations.push(
      violation("IA-4", "roster-member-extra", `roster ${roster.id} includes "${memberId}", which fails its criteria`, {
        actual: memberId,
      }),
    );
  }

  // Order is enforced, not merely preferred: a verdict must be a pure
  // function of recorded inputs (IA-10), and digests taken over a reordered
  // roster would not reproduce.
  if (violations.length === 0 && claimed.some((memberId, index) => memberId !== expected[index])) {
    violations.push(
      violation("IA-4", "roster-order-mismatch", `roster ${roster.id} is not in Pokédex order`, {
        expected: expected.join(", "),
        actual: claimed.join(", "),
      }),
    );
  }

  if (roster.cardinality !== roster.memberIds.length) {
    violations.push(
      violation("IA-4", "cardinality-mismatch", `roster ${roster.id} states a count it does not enumerate`, {
        expected: String(roster.memberIds.length),
        actual: String(roster.cardinality),
      }),
    );
  }

  return verdictOf(violations);
}

/** Human-readable set definition, for exhibits and denial messages. */
export function describeCriteria(criteria: RosterCriteria): string {
  if (criteria.all.length === 0) return "every certified species";
  return criteria.all.map(describeCriterion).join(" and ");
}

function describeCriterion(criterion: RosterCriterion): string {
  switch (criterion.kind) {
    case "has-type":
      return `of type ${criterion.type}`;
    case "learns-move":
      return `able to learn ${criterion.move}`;
    case "rarity":
      return `classified ${criterion.rarity}`;
    case "stat-at-least":
      return `base ${criterion.stat} at least ${criterion.value}`;
    case "stat-at-most":
      return `base ${criterion.stat} at most ${criterion.value}`;
  }
}

function checkVocabulary(registry: CertifiedRegistry, criteria: RosterCriteria): Violation[] {
  const violations: Violation[] = [];
  for (const criterion of criteria.all) {
    if (criterion.kind === "has-type" && !registry.typeNames.has(criterion.type)) {
      violations.push(
        violation("IA-3", "unknown-type", `"${criterion.type}" is not a type certified by ${registry.snapshot.id}`, {
          expected: [...registry.typeNames].sort().join(", "),
          actual: criterion.type,
        }),
      );
    }
    if (criterion.kind === "learns-move" && registry.findMove(criterion.move) === undefined) {
      violations.push(
        violation("IA-3", "unknown-move", `"${criterion.move}" is not a move certified by ${registry.snapshot.id}`, {
          actual: criterion.move,
        }),
      );
    }
  }
  return violations;
}

/** Members in Pokédex order — the registry already stores them that way. */
function selectMembers(registry: CertifiedRegistry, criteria: RosterCriteria): readonly SnapshotSpecies[] {
  return registry.species.filter((species) =>
    criteria.all.every((criterion) => satisfies(species, criterion)),
  );
}

function satisfies(species: SnapshotSpecies, criterion: RosterCriterion): boolean {
  switch (criterion.kind) {
    case "has-type":
      return species.types.includes(criterion.type);
    case "learns-move":
      return species.learnset.some((entry) => entry.move === criterion.move);
    case "rarity":
      return criterion.rarity === "legendary" ? species.isLegendary : species.isMythical;
    case "stat-at-least":
      return species.stats[criterion.stat] >= criterion.value;
    case "stat-at-most":
      return species.stats[criterion.stat] <= criterion.value;
  }
}
