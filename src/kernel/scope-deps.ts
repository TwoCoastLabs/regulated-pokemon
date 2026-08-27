/**
 * What scope each kind of claim actually depends on (epic #64, slice 1).
 *
 * This is the single source of truth for "how much scope must an answer
 * establish", and it is *structural*: every dimension listed here is one the
 * manifest verifier genuinely reads when it checks that kind of claim. A fact
 * is only a fact within a version; an eligibility ruling reads the trainer's
 * badge level; a ranking reads the comparison basis. A lesson reads nothing
 * about the trainer, so it depends on nothing.
 *
 * Two consumers read this one table, which is the point:
 *
 *  - the **verifier** derives the material dimensions a committed answer
 *    requires and refuses a grant that does not bind them (so scope
 *    sufficiency is a property of the claims, not a trusted input);
 *  - the **planner/session** (slice 2) derives the same set to gather exactly
 *    those dimensions and no more — no fixed ceremony, no `region` nobody
 *    verifies against.
 *
 * Fork 1 (locked): this table is kernel-intrinsic, so the two consumers cannot
 * drift. A pack *policy* layer may union additional dimensions on top later (a
 * regulation demanding jurisdiction before advice); the union point is here.
 */

import type { Claim, ScopeDimension } from "./contracts.js";

/**
 * The dimensions each claim kind's verification consumes. Exhaustive over the
 * `Claim` union by construction: a `Record<Claim["kind"], …>` stops compiling
 * when a claim kind is added, so a new kind cannot silently depend on nothing.
 */
export const SCOPE_DEPENDENCIES: Record<Claim["kind"], readonly ScopeDimension[]> = {
  // A lesson is the same reviewed text for every trainer, and a game-rule
  // constant is the same certified number for every trainer — the lazy half of
  // IA-1 that lets both commit before any scope is established.
  explanation: [],
  gameRule: [],
  // Facts, sets and matchups are certified within a version group; nothing
  // else about the trainer changes what the snapshot says.
  fact: ["version"],
  count: ["version"],
  typeCount: ["version"],
  membership: ["version"],
  treats: ["version"],
  comparison: ["version"],
  matchup: ["version"],
  // A superlative is a claim about an ordering, and which ordering was asked
  // for is comparison scope (checkRankingBasis owns the value check).
  ranking: ["version", "comparisonBasis"],
  // Advice and acts read the trainer's accreditation: the badge gate (IA-5)
  // reads badgeLevel, and an unbound badge must be refused, never defaulted.
  eligibility: ["version", "badgeLevel"],
  recommendation: ["version", "badgeLevel"],
  action: ["version", "badgeLevel"],
};

/** Canonical order, so a derived required set is stable for records and digests. */
const DIMENSION_ORDER: readonly ScopeDimension[] = ["version", "region", "badgeLevel", "comparisonBasis"];

/**
 * The union of scope dimensions a set of claims depends on, in canonical order.
 * Empty exactly when every claim is a lesson — the one answer that needs no
 * established scope at all.
 */
export function requiredDimensionsFor(claims: readonly Claim[]): readonly ScopeDimension[] {
  const needed = new Set<ScopeDimension>();
  for (const claim of claims) {
    for (const dimension of SCOPE_DEPENDENCIES[claim.kind]) needed.add(dimension);
  }
  return DIMENSION_ORDER.filter((dimension) => needed.has(dimension));
}
