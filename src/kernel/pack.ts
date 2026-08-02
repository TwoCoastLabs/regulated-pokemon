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
import type { Exhibit, Resolution, ScopeDimension, ScopeValue, Violation } from "./contracts.js";
import type { CertifiedRegistry } from "./registry.js";
import { AccordError, violation } from "./violation.js";

export const PACK_SCHEMA_VERSION = 2;

/** The League's badge scale. Kanto issues eight; nothing above that exists. */
export const MAX_BADGE_LEVEL = 8;

/**
 * The dimensions of material scope, in the order they are asked about.
 *
 * Listed here rather than derived from the type, because the loader has to
 * refuse a vocabulary that names a dimension the kernel has never heard of,
 * and a type cannot be consulted at load time.
 */
export const SCOPE_DIMENSIONS: readonly ScopeDimension[] = [
  "version",
  "region",
  "badgeLevel",
  "comparisonBasis",
];

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

/**
 * One way of saying one typed value (IA-1).
 *
 * `tokens` are the words that may express the value; `context` are the words
 * at least one of which must appear near one of them. The second list is not
 * decoration. A bare-noun alias carries full authority on a paraphrase or a
 * misspelling — "yellow" alone would mint a game version out of a Pokémon's
 * colour — so context is required of every term, and the loader refuses a
 * term that declares none.
 */
export interface VocabularyTerm {
  value: ScopeValue;
  tokens: readonly string[];
  context: readonly string[];
}

/** The approved vocabulary for one dimension of material scope. */
export interface DimensionRule {
  dimension: ScopeDimension;
  /** The type a bound value must have. A term that disagrees is refused at load. */
  valueType: "text" | "number";
  /** Asked verbatim when this dimension is the one thing still missing. */
  question: string;
  terms: readonly VocabularyTerm[];
}

/**
 * League-approved vocabulary: the closed list of things a trainer can say
 * that establish typed scope, and the closed lists of things that stop a
 * clause from establishing anything.
 *
 * A closed vocabulary is the whole guarantee. Whatever text arrives, the only
 * value the resolver can emit is one written here, so there is no sentence
 * anyone can compose that makes it produce something else. Everything below is
 * word lists and a proximity window rather than patterns: a condition language
 * here would be a policy engine, and a policy engine is a place for rules to
 * hide.
 */
export interface ScopeVocabulary {
  /**
   * How far, in tokens, a required context word may sit from a value token.
   * This is the specificity/recall dial. Narrowing it denies more paraphrases
   * and sends them to the propose/confirm ladder; widening it lets a term
   * bind on wording nobody meant.
   */
  contextWindow: number;
  /** How long a grant minted from this vocabulary stays valid, in seconds. */
  validitySeconds: number;
  markers: {
    /** Negation is respected (IA-8): "not Yellow" binds nothing. */
    negation: readonly string[];
    /** Reported speech: a rival's wish is not the trainer's (IA-8). */
    reported: readonly string[];
    /** Text addressed to the Advisor. Instruction is not intent (IA-8). */
    instruction: readonly string[];
    /** Asking about a thing is not being in it, so a question binds nothing. */
    interrogative: readonly string[];
    /** Words a sentence is cut at, so one poisoned clause cannot spoil a good one. */
    conjunction: readonly string[];
  };
  dimensions: readonly DimensionRule[];
}

export interface AccordPack {
  packVersion: typeof PACK_SCHEMA_VERSION;
  /** Stable, versioned id recorded in every manifest this pack governed. */
  id: string;
  restrictions: readonly RestrictionRule[];
  exhibits: readonly ExhibitRule[];
  vocabulary: ScopeVocabulary;
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
  if (
    document.vocabulary === null ||
    typeof document.vocabulary !== "object" ||
    !Array.isArray(document.vocabulary.dimensions)
  ) {
    return {
      ok: false,
      violations: [violation("IA-1", "pack-vocabulary-missing", "Accord pack declares no approved vocabulary")],
    };
  }

  const pack = document as AccordPack;
  const violations = [...checkRules(pack, registry), ...checkVocabulary(pack.vocabulary)];
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

/**
 * Validate the approved vocabulary.
 *
 * Same discipline the exhibit rules already get: a rule that can never fire is
 * not a safe default, it is a hole nobody can see. A dimension with no terms
 * never binds; a term with no context words binds far too much; a numeric
 * dimension carrying a text value binds something the kernel cannot type.
 */
function checkVocabulary(vocabulary: ScopeVocabulary): Violation[] {
  const violations: Violation[] = [];

  if (!Number.isInteger(vocabulary.contextWindow) || vocabulary.contextWindow < 1) {
    violations.push(
      violation("IA-1", "pack-window-unusable", "the context window is not a positive whole number of tokens", {
        actual: String(vocabulary.contextWindow),
      }),
    );
  }
  if (!Number.isInteger(vocabulary.validitySeconds) || vocabulary.validitySeconds <= 0) {
    violations.push(
      violation("IA-1", "pack-validity-unusable", "grants minted from this vocabulary would never be valid", {
        actual: String(vocabulary.validitySeconds),
      }),
    );
  }

  // Every marker group must exist, including an empty one. A missing group
  // would silently switch off a whole class of exclusion — the resolver would
  // read a rival's reported wish as the trainer's own and never say why.
  for (const group of ["negation", "reported", "instruction", "interrogative", "conjunction"] as const) {
    if (!Array.isArray(vocabulary.markers?.[group])) {
      violations.push(
        violation("IA-8", "pack-markers-missing", `the vocabulary declares no "${group}" markers`, { actual: group }),
      );
    }
  }

  const seen = new Set<ScopeDimension>();
  for (const rule of vocabulary.dimensions) {
    if (!SCOPE_DIMENSIONS.includes(rule.dimension)) {
      violations.push(
        violation("IA-1", "pack-unknown-dimension", `the vocabulary declares "${rule.dimension}", which is not a dimension of material scope`, {
          expected: SCOPE_DIMENSIONS.join(", "),
          actual: String(rule.dimension),
        }),
      );
      continue;
    }
    if (seen.has(rule.dimension)) {
      violations.push(
        violation("IA-1", "pack-duplicate-dimension", `the vocabulary declares "${rule.dimension}" more than once`, {
          actual: rule.dimension,
        }),
      );
    }
    seen.add(rule.dimension);

    if (rule.terms.length === 0 || rule.question.length === 0) {
      violations.push(
        violation("IA-1", "pack-dimension-unaskable", `"${rule.dimension}" has no terms to match or no question to ask`, {
          actual: `${rule.terms.length} terms`,
        }),
      );
    }

    for (const term of rule.terms) {
      const label = `${rule.dimension}=${String(term.value)}`;
      if (term.tokens.length === 0) {
        violations.push(
          violation("IA-1", "pack-term-without-tokens", `term ${label} has no words that express it`, { actual: label }),
        );
      }
      // The bare-noun ban, enforced where it cannot be forgotten.
      if (term.context.length === 0) {
        violations.push(
          violation("IA-1", "pack-term-without-context", `term ${label} would bind on a bare noun`, { actual: label }),
        );
      }
      const expected = rule.valueType === "number" ? "number" : "string";
      if (typeof term.value !== expected) {
        violations.push(
          violation("IA-1", "pack-term-mistyped", `term ${label} is not the type "${rule.dimension}" declares`, {
            expected,
            actual: typeof term.value,
          }),
        );
      }
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
