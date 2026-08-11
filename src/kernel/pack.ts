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

import { ACCORD_ARTICLES, type ArticleId } from "./accord.js";
import type { Exhibit, Resolution, ScopeDimension, ScopeValue, Violation } from "./contracts.js";
import { digestText } from "./digest.js";
import { normalise } from "./dom.js";
import { formatCarriesLocale, type FormatId, IMPLEMENTED_LOCALES, isFormatId } from "./format.js";
import type { CertifiedRegistry } from "./registry.js";
import { AccordError, violation } from "./violation.js";

export const PACK_SCHEMA_VERSION = 4;

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
 * One consequential action the Advisor may perform (IA-7, IA-9).
 *
 * A closed list, for the same reason the fact vocabulary is one: a tool nobody
 * approved is a way to change the trainer's state that no rule was written
 * about. Whether an act can be taken back is policy rather than code — the
 * League decides that releasing a Pokémon is forever — and it is the whole of
 * what Article IX keys on.
 */
export interface ActionRule {
  id: string;
  irreversible: boolean;
}

/**
 * When a disclosure becomes mandatory. Deliberately a closed, tiny vocabulary:
 * a condition language here would be a policy engine, and a policy engine is
 * a place for rules to hide.
 */
export type ExhibitTrigger =
  | { kind: "always" }
  | { kind: "entity-claimed"; entityId: string }
  /** An answer that proposes this act owes the notice, once per act. */
  | { kind: "action-claimed"; tool: string };

/**
 * One approved rendering of a disclosure's mandatory text, for one locale.
 *
 * The digest is the block's *identity*, not a seal against the reviewer: it is
 * what a manifest carries instead of the words, and what the render affidavit
 * recomputes from the screen. The loader checks it names its own text so that
 * a block id can never drift away from the content it stands for.
 */
export interface BlockContent {
  locale: string;
  text: string;
  /** Digest over the normalised text — see `digestText`. */
  digest: string;
}

/**
 * Mandatory text as versioned, digested content rather than a bag of words.
 *
 * Fragment matching needed three rules — every fragment present, in order, not
 * assembled out of siblings — and still could not tell a paraphrase from the
 * sentence the Accord required. Digest equality is one rule, and truncation,
 * reordering and rewording all fail it the same way. A translation is a
 * separate entry approved on its own terms; it is never a looser match.
 */
export interface DisclosureBlockRule {
  id: string;
  /** Bumped whenever the words change, so a manifest names a text that existed. */
  version: number;
  content: readonly BlockContent[];
}

/**
 * Where an exhibit's non-fixed value comes from. A closed vocabulary of three,
 * each named because some disclosure cannot be written as fixed words: the
 * provenance notice has to name the snapshot it is attributing, and Article IX
 * requires a consent notice to state what is being given up *drawn from the
 * Certified Registry* — which is the acted-on species and what it knows.
 * Anything richer would be the transformation engine this design exists to
 * avoid.
 */
export type ExhibitSlotSource = "snapshot-id" | "action-entity" | "action-entity-learnset";

export const EXHIBIT_SLOT_SOURCES: readonly ExhibitSlotSource[] = [
  "snapshot-id",
  "action-entity",
  "action-entity-learnset",
];

/** Sources that only mean anything for a disclosure attached to an act. */
const ACTION_SLOT_SOURCES: readonly ExhibitSlotSource[] = ["action-entity", "action-entity-learnset"];

export interface ExhibitSlotRule {
  /** Unique within the exhibit; the mark the renderer places. */
  name: string;
  source: ExhibitSlotSource;
  format: FormatId;
}

export interface ExhibitRule {
  id: string;
  article: ArticleId;
  kind: Exhibit["kind"];
  when: ExhibitTrigger;
  /**
   * The text that must survive all the way to the trainer's screen. Phase 2
   * only requires the exhibit to be in the manifest; IA-6 proves it was
   * visible, unaltered, in the locale the answer was planned for.
   */
  block: DisclosureBlockRule;
  slots?: readonly ExhibitSlotRule[];
}

/**
 * One renderer-owned string, versioned in the pack.
 *
 * The lead-ins and headings are copy: the renderer chooses them and they assert
 * nothing. Text closure still needs somewhere to attribute them to, though —
 * default-deny for text only works if the permitted text is written down — so
 * the copy lives here, reviewed, rather than in the renderer where it could
 * change without anyone approving it.
 */
export interface CopyEntry {
  id: string;
  /** One rendering per approved locale. */
  text: Readonly<Record<string, string>>;
}

/**
 * How a certified answer may be presented: the locales it may appear in, the
 * formats its values may take, and the copy that may surround them.
 *
 * All three are closed lists. Between them they are the whole of what a
 * renderer is allowed to put on a certified artifact — a slot filled through an
 * approved format, a disclosure block, or a catalogued string. There is no
 * fourth category, which is what makes "anything else is denied" a rule the
 * kernel can actually apply.
 */
export interface Presentation {
  locales: readonly string[];
  formats: readonly FormatId[];
  catalogue: readonly CopyEntry[];
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
  presentation: Presentation;
  restrictions: readonly RestrictionRule[];
  actions: readonly ActionRule[];
  exhibits: readonly ExhibitRule[];
  vocabulary: ScopeVocabulary;
}

/** The rule for one action, or nothing if this pack declares no such act. */
export function actionRule(pack: AccordPack, tool: string): ActionRule | undefined {
  return pack.actions.find((rule) => rule.id === tool);
}

/** The block a disclosure requires in one locale, or nothing. */
export function blockFor(rule: ExhibitRule, locale: string): BlockContent | undefined {
  return rule.block.content.find((entry) => entry.locale === locale);
}

/** One catalogued string in one locale, or nothing. */
export function copyFor(pack: AccordPack, id: string, locale: string): string | undefined {
  return pack.presentation.catalogue.find((entry) => entry.id === id)?.text[locale];
}

export function approvesLocale(pack: AccordPack, locale: string): boolean {
  return pack.presentation.locales.includes(locale);
}

export function approvesFormat(pack: AccordPack, formatId: FormatId): boolean {
  return pack.presentation.formats.includes(formatId);
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
  if (!Array.isArray(document.actions)) {
    // An empty list is a pack under which the Advisor may say things and do
    // nothing, which is a coherent policy. A missing list is a pack that never
    // decided, and every act would then be one nobody approved.
    return {
      ok: false,
      violations: [violation("IA-7", "pack-actions-missing", "Accord pack does not say which actions exist")],
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
  if (
    document.presentation === null ||
    typeof document.presentation !== "object" ||
    !Array.isArray(document.presentation.locales) ||
    !Array.isArray(document.presentation.formats) ||
    !Array.isArray(document.presentation.catalogue)
  ) {
    return {
      ok: false,
      violations: [
        violation("IA-6", "pack-presentation-missing", "Accord pack says nothing about how an answer may be presented"),
      ],
    };
  }

  const pack = document as AccordPack;
  const violations = [
    ...checkPresentation(pack.presentation),
    ...checkRules(pack, registry),
    ...checkActions(pack),
    ...checkVocabulary(pack.vocabulary),
  ];
  if (violations.length > 0) return { ok: false, violations };
  return { ok: true, value: pack };
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
    violations.push(...checkBlock(pack, rule));
    violations.push(...checkExhibitSlots(pack, rule));
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
 * Validate the action registry (IA-7, IA-9).
 *
 * The load-time rule that matters is the last one: an act the pack calls
 * irreversible and no rule discloses is a consent the trainer could never have
 * given, because there would be nothing to consent *to*. Article IX composes
 * out of Article VI, so the composition has to exist in the data — and the one
 * moment it can be checked for every act at once is here, before any answer is
 * compiled against it.
 */
function checkActions(pack: AccordPack): Violation[] {
  const violations: Violation[] = [];
  const declared = new Set<string>();

  for (const rule of pack.actions) {
    if (typeof rule.id !== "string" || rule.id.length === 0 || declared.has(rule.id)) {
      violations.push(
        violation("IA-7", "pack-action-unusable", `the action registry declares "${String(rule.id)}" twice or unnamed`, {
          actual: String(rule.id),
        }),
      );
    }
    declared.add(rule.id);

    if (typeof rule.irreversible !== "boolean") {
      violations.push(
        violation("IA-9", "pack-action-reversibility-unstated", `action "${rule.id}" does not say whether it can be taken back`, {
          expected: "true or false",
          actual: String(rule.irreversible),
        }),
      );
    }
  }

  const disclosed = new Set(
    pack.exhibits.flatMap((rule) => (rule.when.kind === "action-claimed" ? [rule.when.tool] : [])),
  );
  for (const tool of disclosed) {
    if (declared.has(tool)) continue;
    violations.push(
      violation("IA-7", "pack-dangling-action", `a disclosure triggers on "${tool}", which the action registry does not declare`, {
        expected: [...declared].join(", ") || "no actions",
        actual: tool,
      }),
    );
  }
  for (const rule of pack.actions) {
    if (rule.irreversible !== true || disclosed.has(rule.id)) continue;
    violations.push(
      violation("IA-9", "pack-irreversible-undisclosed", `"${rule.id}" is irreversible and nothing in this pack discloses it`, {
        expected: `an exhibit triggering on ${rule.id}`,
        actual: [...disclosed].join(", ") || "no action disclosures",
      }),
    );
  }

  return violations;
}

/**
 * Validate the presentation rules.
 *
 * The same discipline every other list in this pack gets, applied to display: a
 * locale nothing can render, a format nothing implements, or a catalogue entry
 * missing a translation are all rules that cannot fire. Here that is worse than
 * inert — a half-supported locale would let an artifact be planned and then
 * denied at the last moment for a reason nobody wrote down.
 */
function checkPresentation(presentation: Presentation): Violation[] {
  const violations: Violation[] = [];

  if (presentation.locales.length === 0) {
    violations.push(
      violation("IA-6", "pack-no-locale", "the pack approves no locale, so no answer could ever be presented"),
    );
  }
  for (const locale of presentation.locales) {
    if (IMPLEMENTED_LOCALES.includes(locale)) continue;
    violations.push(
      violation("IA-6", "pack-locale-unimplemented", `no formatter in this kernel renders ${locale}`, {
        expected: IMPLEMENTED_LOCALES.join(", "),
        actual: locale,
      }),
    );
  }

  if (presentation.formats.length === 0) {
    violations.push(
      violation("IA-6", "pack-no-format", "the pack approves no format, so no certified value could be shown"),
    );
  }
  for (const formatId of presentation.formats) {
    if (!isFormatId(formatId)) {
      violations.push(
        violation("IA-6", "pack-format-unknown", `"${String(formatId)}" is not a formatter this kernel implements`, {
          actual: String(formatId),
        }),
      );
      continue;
    }
    // Approving a presentation the kernel cannot produce in an approved locale
    // is how "we support de-DE" becomes true in the pack and false on screen.
    for (const locale of presentation.locales) {
      if (formatCarriesLocale(formatId, locale)) continue;
      violations.push(
        violation("IA-6", "pack-format-locale-unimplemented", `"${formatId}" has no rendering for ${locale}`, {
          expected: `${formatId} in every approved locale`,
          actual: locale,
        }),
      );
    }
  }

  const seen = new Set<string>();
  for (const entry of presentation.catalogue) {
    if (seen.has(entry.id)) {
      violations.push(
        violation("IA-6", "pack-copy-duplicated", `catalogue entry "${entry.id}" appears more than once`, {
          actual: entry.id,
        }),
      );
    }
    seen.add(entry.id);

    for (const locale of presentation.locales) {
      if (normalise(entry.text?.[locale] ?? "").length > 0) continue;
      violations.push(
        violation("IA-6", "pack-copy-incomplete", `catalogue entry "${entry.id}" says nothing in ${locale}`, {
          expected: `${entry.id} in every approved locale`,
          actual: locale,
        }),
      );
    }
  }

  return violations;
}

/** A disclosure's mandatory text: present in every locale, and naming itself. */
function checkBlock(pack: AccordPack, rule: ExhibitRule): Violation[] {
  const violations: Violation[] = [];
  const block = rule.block;

  if (block === undefined || typeof block.id !== "string" || block.id.length === 0) {
    return [
      violation("IA-6", "pack-block-missing", `exhibit rule "${rule.id}" carries no disclosure block`, {
        actual: rule.id,
      }),
    ];
  }
  if (!Number.isInteger(block.version) || block.version < 1) {
    violations.push(
      violation("IA-6", "pack-block-unversioned", `block "${block.id}" has no usable version`, {
        actual: String(block.version),
      }),
    );
  }

  const byLocale = new Map((block.content ?? []).map((entry) => [entry.locale, entry]));
  for (const locale of pack.presentation.locales) {
    const content = byLocale.get(locale);
    if (content === undefined) {
      // Fail closed at load: an answer planned in a locale whose disclosure has
      // no approved text would have to either skip the disclosure or invent it.
      violations.push(
        violation("IA-6", "pack-block-locale-missing", `block "${block.id}" has no approved text in ${locale}`, {
          expected: `${block.id} in every approved locale`,
          actual: [...byLocale.keys()].join(", ") || "nothing",
        }),
      );
      continue;
    }
    if (normalise(content.text ?? "").length === 0) {
      violations.push(
        violation("IA-6", "pack-block-empty", `block "${block.id}" says nothing in ${locale}`, { actual: locale }),
      );
      continue;
    }
    const expected = digestText(content.text);
    if (content.digest !== expected) {
      violations.push(
        violation("IA-6", "pack-block-digest-mismatch", `block "${block.id}" does not name its own ${locale} text`, {
          expected,
          actual: content.digest ?? "no digest",
        }),
      );
    }
  }

  for (const entry of block.content ?? []) {
    if (pack.presentation.locales.includes(entry.locale)) continue;
    violations.push(
      violation("IA-6", "pack-block-locale-unapproved", `block "${block.id}" carries text for unapproved ${entry.locale}`, {
        expected: pack.presentation.locales.join(", "),
        actual: entry.locale,
      }),
    );
  }

  return violations;
}

/** The values an exhibit shows alongside its fixed text. */
function checkExhibitSlots(pack: AccordPack, rule: ExhibitRule): Violation[] {
  const violations: Violation[] = [];
  const seen = new Set<string>();

  for (const slot of rule.slots ?? []) {
    const label = `${rule.id}.${slot.name}`;
    if (slot.name.length === 0 || seen.has(slot.name)) {
      violations.push(
        violation("IA-6", "pack-slot-name-unusable", `exhibit "${rule.id}" declares "${slot.name}" twice or unnamed`, {
          actual: label,
        }),
      );
    }
    seen.add(slot.name);

    if (!EXHIBIT_SLOT_SOURCES.includes(slot.source)) {
      violations.push(
        violation("IA-6", "pack-slot-source-unknown", `slot ${label} reads "${String(slot.source)}", which is not a source`, {
          expected: EXHIBIT_SLOT_SOURCES.join(", "),
          actual: String(slot.source),
        }),
      );
    } else if (ACTION_SLOT_SOURCES.includes(slot.source) && rule.when.kind !== "action-claimed") {
      // A notice that reads the acted-on species, attached to a rule no act
      // triggers, has nothing to read. It would be planned and then refused at
      // render time, which is a load-time error arriving three stages late.
      violations.push(
        violation("IA-6", "pack-slot-source-unavailable", `slot ${label} reads the acted-on species, and "${rule.id}" is not triggered by an action`, {
          expected: "a rule triggered by an action",
          actual: rule.when.kind,
        }),
      );
    }
    if (!isFormatId(slot.format) || !approvesFormat(pack, slot.format)) {
      violations.push(
        violation("IA-6", "pack-slot-format-unapproved", `slot ${label} is presented by "${String(slot.format)}", which this pack does not approve`, {
          expected: pack.presentation.formats.join(", "),
          actual: String(slot.format),
        }),
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
