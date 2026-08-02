/**
 * The Accord pack (IA-5, IA-6): eligibility and disclosure rules as versioned
 * declarative data.
 *
 * Policy that says *who may be told what* does not belong scattered through
 * agent code, where changing it is a code review and auditing it is a reading
 * exercise. It is data: a badge threshold is a number in a file, a triggered
 * disclosure is a rule with an id, and every rule names the article it
 * enforces so a denial can be traced back to the sentence that produced it.
 *
 * The pack is not digested the way the snapshot is, and deliberately so. The
 * snapshot's digest guards bytes vendored from upstream, where the threat is
 * an edit nobody reviewed. The pack is authored in this repository and arrives
 * through the same review as the kernel; a digest over it would guard against
 * the reviewer, which is ceremony rather than enforcement.
 */

import { readFileSync } from "node:fs";

import { ACCORD_ARTICLES, type ArticleId } from "./accord.js";
import type { Exhibit, Resolution, Violation } from "./contracts.js";
import type { CertifiedRegistry } from "./registry.js";
import { AccordError, violation } from "./violation.js";

export const PACK_SCHEMA_VERSION = 1;

/** The League's badge scale. Kanto issues eight; nothing above that exists. */
export const MAX_BADGE_LEVEL = 8;

/**
 * A restricted-instrument gate (IA-5). Rarity comes from the snapshot's own
 * two flags rather than a derived notion of "rare", so a rule never has to
 * guess which sense of the word a policy meant.
 */
export interface RestrictionRule {
  id: string;
  article: ArticleId;
  rarity: "legendary" | "mythical";
  /** Minimum badge level a trainer must hold to be recommended one. */
  minimumBadgeLevel: number;
}

/**
 * When a disclosure becomes mandatory. Deliberately a closed, tiny vocabulary:
 * a condition language here would be a policy engine, and a policy engine is
 * a place for rules to hide.
 */
export type ExhibitTrigger =
  | { kind: "always" }
  | { kind: "entity-claimed"; entityId: string };

export interface ExhibitRule {
  id: string;
  article: ArticleId;
  kind: Exhibit["kind"];
  when: ExhibitTrigger;
  /**
   * Text that must survive all the way to the trainer's screen. Phase 2 only
   * requires the exhibit to be in the manifest; IA-6 proves it was visible.
   */
  requiredFragments: readonly string[];
}

export interface AccordPack {
  packVersion: typeof PACK_SCHEMA_VERSION;
  /** Stable, versioned id recorded in every manifest this pack governed. */
  id: string;
  restrictions: readonly RestrictionRule[];
  exhibits: readonly ExhibitRule[];
}

/**
 * Validate a parsed pack against the article registry and a loaded snapshot.
 *
 * The registry is required because a rule that names an entity the snapshot
 * has never heard of is a rule that can never fire, and a gate that never
 * engages is a silent hole rather than a safe default.
 */
export function loadPack(input: unknown, registry: CertifiedRegistry): Resolution<AccordPack> {
  if (input === null || typeof input !== "object") {
    return { ok: false, violations: [violation("IA-5", "pack-malformed", "Accord pack is not an object")] };
  }
  const document = input as Partial<AccordPack>;

  if (document.packVersion !== PACK_SCHEMA_VERSION) {
    return {
      ok: false,
      violations: [
        violation("IA-5", "pack-schema-unsupported", "Accord pack schema version is not supported", {
          expected: String(PACK_SCHEMA_VERSION),
          actual: String(document.packVersion),
        }),
      ],
    };
  }
  if (typeof document.id !== "string" || document.id.length === 0) {
    return { ok: false, violations: [violation("IA-5", "pack-malformed", "Accord pack has no id")] };
  }
  if (!Array.isArray(document.restrictions) || !Array.isArray(document.exhibits)) {
    return {
      ok: false,
      violations: [violation("IA-5", "pack-malformed", "Accord pack is missing restrictions or exhibits")],
    };
  }

  const pack = document as AccordPack;
  const violations = checkRules(pack, registry);
  if (violations.length > 0) return { ok: false, violations };
  return { ok: true, value: pack };
}

/** Read a pack from disk, refusing loudly if it does not hold up. */
export function readPack(path: string, registry: CertifiedRegistry): AccordPack {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (cause) {
    throw new AccordError([
      violation("IA-5", "pack-unreadable", `cannot read Accord pack at ${path}: ${(cause as Error).message}`),
    ]);
  }
  const loaded = loadPack(parsed, registry);
  if (!loaded.ok) throw new AccordError(loaded.violations);
  return loaded.value;
}

function checkRules(pack: AccordPack, registry: CertifiedRegistry): Violation[] {
  const violations: Violation[] = [];
  const known = new Set<string>(ACCORD_ARTICLES.map((entry) => entry.id));
  const seen = new Set<string>();

  for (const rule of [...pack.restrictions, ...pack.exhibits]) {
    if (seen.has(rule.id)) {
      violations.push(
        violation("IA-5", "pack-duplicate-rule", `Accord pack rule "${rule.id}" appears more than once`, {
          actual: rule.id,
        }),
      );
    }
    seen.add(rule.id);

    // A rule that cites no real article produces a denial nobody can look up,
    // which is the "blocked by policy" failure wearing an id.
    if (!known.has(rule.article)) {
      violations.push(
        violation("IA-5", "pack-unknown-article", `rule "${rule.id}" cites ${rule.article}, which is not an article`, {
          actual: rule.article,
        }),
      );
    }
  }

  for (const rule of pack.restrictions) {
    if (
      !Number.isInteger(rule.minimumBadgeLevel) ||
      rule.minimumBadgeLevel < 0 ||
      rule.minimumBadgeLevel > MAX_BADGE_LEVEL
    ) {
      violations.push(
        violation("IA-5", "pack-threshold-unreachable", `rule "${rule.id}" sets a badge level no trainer can hold`, {
          expected: `0..${MAX_BADGE_LEVEL}`,
          actual: String(rule.minimumBadgeLevel),
        }),
      );
    }
  }

  for (const rule of pack.exhibits) {
    if (rule.requiredFragments.length === 0) {
      violations.push(
        violation("IA-6", "pack-exhibit-without-fragments", `exhibit rule "${rule.id}" requires no visible text`, {
          actual: rule.id,
        }),
      );
    }
    // Lesson from the snapshot loader, applied to policy: an unresolvable
    // reference is not an inert rule, it is a disclosure that silently never
    // fires.
    if (rule.when.kind === "entity-claimed" && !registry.knowsEntity(rule.when.entityId)) {
      violations.push(
        violation(
          "IA-3",
          "pack-dangling-entity",
          `exhibit rule "${rule.id}" triggers on "${rule.when.entityId}", which ${registry.snapshot.id} does not certify`,
          { actual: rule.when.entityId },
        ),
      );
    }
  }

  return violations;
}

/** The restrictions that apply to one species, by its certified rarity. */
export function restrictionsFor(
  pack: AccordPack,
  species: { isLegendary: boolean; isMythical: boolean },
): readonly RestrictionRule[] {
  return pack.restrictions.filter((rule) =>
    rule.rarity === "legendary" ? species.isLegendary : species.isMythical,
  );
}
