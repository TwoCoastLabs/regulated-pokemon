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
import { type CertifiedRegistry, fidelitySurfaces, ITEM_FACT_IDS, MOVE_FACT_IDS, SPECIES_FACT_IDS } from "./registry.js";
import { AccordError, violation } from "./violation.js";

export const PACK_SCHEMA_VERSION = 7;

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
  /**
   * What the rule gates: a species rarity, or — since the Center world
   * (epic #94, slice 3) — an item category. Exactly one, validated at load:
   * a rule about both would gate two universes with one sentence, and a rule
   * about neither gates nothing while looking like policy.
   */
  rarity?: "legendary" | "mythical";
  itemCategory?: string;
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
export type ExhibitSlotSource = "snapshot-id" | "action-entity" | "action-entity-learnset" | "action-entity-effect";

export const EXHIBIT_SLOT_SOURCES: readonly ExhibitSlotSource[] = [
  "snapshot-id",
  "action-entity",
  "action-entity-learnset",
  "action-entity-effect",
];

/** Sources that only mean anything for a disclosure attached to an act. */
const ACTION_SLOT_SOURCES: readonly ExhibitSlotSource[] = ["action-entity", "action-entity-learnset", "action-entity-effect"];

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
 * One approved lesson in the explanation catalogue.
 *
 * The curriculum answers the questions no snapshot fact can — "what is a
 * badge?", "how does catching work?" — and it does so the only way this
 * kernel certifies prose: as authored, reviewed, digest-pinned text the model
 * may *route to* and can never edit. A wrong route shows a reviewed lesson on
 * the wrong subject — a deflection, never a fabrication.
 *
 * Provenance is deliberately different from a fact's, and the certificate
 * says so: a lesson's authority is editorial — this pack version, this
 * review, this digest — not derivation from the snapshot. What keeps a
 * lesson from drifting away from the certified world is a pin, not a
 * derivation: where its text overlaps something the registry knows (the
 * what-is-type lesson enumerates the fifteen types), a test holds the two
 * equal.
 */
export interface CurriculumRule {
  /** What the model routes to. Distinct from the block id, which names the text. */
  id: string;
  article: ArticleId;
  block: DisclosureBlockRule;
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
 * The geometry floors a live page is measured against (IA-6).
 *
 * These are the FTC's "four Ps" — prominence, placement, proximity — turned
 * into numbers a stylesheet cannot argue with: the smallest a certified value
 * or disclosure may be drawn, the faintest it may be, and how far a triggered
 * warning may drift from what it discloses.
 *
 * They are policy, versioned here like every other rule, and *only the live
 * browser authority consults them*. The deterministic offline walker reads
 * structure, never pixels, so nothing on the replayable chain (IA-10) depends
 * on a number a viewport, a font stack or a device's DPI can move. That
 * asymmetry is the whole point — geometry is where the kernel's guarantee stops
 * being replayable, so it is enforced at the edge and never folded into a
 * digest. A pixel floor in the pack is not a claim the offline gate will check;
 * it is the standing instruction the production affidavit holds the real
 * browser to.
 */
export interface DisplayPolicy {
  /**
   * The smallest computed font size, in CSS pixels, a certified value or a
   * disclosure may be rendered at. The four-pixel warning is denied here — the
   * fine print's oldest trick, in a stylesheet instead of a printing press.
   */
  minLegiblePx: number;
  /** The lowest computed opacity that still counts as shown, in `(0, 1]`. */
  minLegibleOpacity: number;
  /**
   * How far, in CSS pixels, a triggered disclosure's box may sit from the box
   * of the unit it discloses before proximity fails. Adjacency in the document
   * tree is necessary and not sufficient: two elements can be siblings in the
   * markup and a screen apart in the layout.
   */
  maxProximityPx: number;
}

/**
 * How a certified answer may be presented: the locales it may appear in, the
 * formats its values may take, the copy that may surround them, and the
 * geometry floors a live rendering of it is held to.
 *
 * The first three are closed lists — between them the whole of what a renderer
 * may put on a certified artifact: a slot filled through an approved format, a
 * disclosure block, or a catalogued string, and no fourth category. The last is
 * not a list but a set of floors, and it governs a different question: not what
 * may appear, but whether what appeared could actually be read.
 */
export interface Presentation {
  locales: readonly string[];
  formats: readonly FormatId[];
  catalogue: readonly CopyEntry[];
  /**
   * Approved sentence templates (epic #94, slice 4 — certified surface
   * realisation). One per unit kind at most: the reviewed sentence a claim of
   * that kind is presented as, with `{slot}` placeholders for the unit's
   * certified values. The words between the placeholders are approved copy;
   * the placeholders are filled by the kernel through the closed formatter
   * registry; and the whole rendered sentence is verified by equality, so a
   * certified page can read as prose without the renderer being able to
   * compose any. A kind with no template falls back to the labelled-slot
   * presentation.
   */
  templates: readonly SentenceTemplate[];
  display: DisplayPolicy;
}

/** One approved sentence, for one unit kind, in every approved locale. */
export interface SentenceTemplate {
  id: string;
  /** The unit kind this sentence presents. At most one template per kind. */
  kind: string;
  /** One rendering per approved locale, with `{slot}` placeholders. */
  text: Readonly<Record<string, string>>;
}

/**
 * The slots each unit kind certifies — the closed vocabulary a template's
 * placeholders may draw on. Kernel truth, stated here so the loader can
 * refuse a template naming a slot its kind will never carry; render.ts pins
 * its own unit construction to this table by test, so the two cannot drift.
 */
export const TEMPLATE_SLOTS: Readonly<Record<string, readonly string[]>> = {
  fact: ["entity", "fact", "value"],
  count: ["count", "set"],
  membership: ["entity", "membership", "set"],
  listing: ["set", "membership", "members"],
  treats: ["item", "condition", "verdict"],
  comparison: ["left", "right", "fact", "leftvalue", "rightvalue", "gap", "leader"],
  selection: ["entity", "set", "basis"],
  matchup: ["subject", "direction", "members"],
  eligibility: ["entity", "verdict", "rule", "requires", "held"],
  recommendation: ["entity"],
  action: ["action", "entity"],
};

/** The placeholders a template's text actually uses, in order of appearance. */
export function templatePlaceholders(text: string): readonly string[] {
  return [...text.matchAll(/\{([a-z]+)\}/g)].map((match) => match[1] as string);
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
  /**
   * Declares this dimension a parameter of the ask rather than a fact about
   * the trainer's world — so its terms may bind inside the trainer's own
   * interrogative clauses. "Who's faster?" is where a comparison basis
   * *lives*; no trainer states one as a fact. World dimensions must never
   * declare this: asking "is it Yellow?" is not playing Yellow, and the
   * crucible pins that refusal (IA-1/question-is-not-assertion). Every other
   * block — quoted, reported, instruction, foreign channel — still applies.
   */
  askParameter?: boolean;
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

/**
 * A certified game-rule constant (epic #64, game-rules slice): a fixed number
 * of Red and Blue — six Pokémon on a team, four moves each — that no snapshot
 * fact carries because it is a rule, not species data. Reviewed reference data,
 * exactly like the curriculum, but structured: a `gameRule` claim reads the
 * value here, so "how many can I have on my team?" answers as a certified
 * number, never as a paragraph that happens to mention one. Count-shaped by
 * design — `label` is the plural noun the number counts ("Pokémon on your team
 * at once"), so it reads "6 Pokémon on your team at once".
 */
export interface GameRule {
  id: string;
  value: number;
  label: string;
}

/**
 * What the records do not hold, as reviewed policy (epic #145, R3): the
 * lesson that says so. Which asks reach it is the model's mapping to decide
 * (an `asked` entry linked to no field — docs/routing.md, R3b), never a word
 * list: R3a's seventy tokens were the class of mechanism a bank or a
 * hospital cannot re-tune per domain, and they are gone. The kernel
 * certifies the lesson like any other.
 */
export interface RecordsBoundaryRule {
  /** A curriculum lesson id; the loader refuses one the pack does not carry. */
  lessonId: string;
}

/** Whose field a dictionary entry is: what a claim on it names as its
 * subject. `type` is the type chart — the one certified surface that is not
 * a fact of a species, a move or an item. */
export type DictionarySubject = "species" | "move" | "item" | "type";

/**
 * One entry of the domain's data dictionary (docs/routing.md, R3b): a
 * certified field, described for the model to link the trainer's phrases to
 * and for the driver to cross-check that link with. The plain database
 * sense of the term — the domain team authors one line per field, O(fields)
 * not O(phrases). The loader pins the dictionary to the registry in both
 * directions: every entry names a surface the registry certifies, and every
 * certified surface has an entry, so the grammar's enum and the prompt's
 * catalogue can never drift from what resolves.
 */
export interface DictionaryEntry {
  /** The certified surface: a fact id, or "type-chart". */
  id: string;
  subject: DictionarySubject;
  /** The field's everyday name. */
  name: string;
  /** One line: what the value is. */
  description: string;
  /**
   * The trainer's words for this field, lowercase, word-bounded, spaces
   * allowed. The one place the dictionary's words touch the driver: an
   * alias of a *different* field in a phrase the model linked here is a
   * contradiction the trainer is asked about. An alias can make the system
   * ask; it can never make it answer.
   */
  aliases: readonly string[];
}

/** The `fieldId` a model writes for "the records certify no such field" —
 * decoded as null. Reserved: no dictionary entry may claim it. */
export const NO_FIELD = "none";

/**
 * The ceremony dial: how much explicit confirmation the pack demands before
 * an interpretation binds. Policy, not code — a deployment's compliance
 * owner sets it in the reviewed pack, every filed record pins the pack that
 * governed it, and replay proves which dial setting each answer was
 * certified under. The friction/rigor tradeoff as a versioned artifact.
 */
export interface CeremonyPolicy {
  /**
   * When true, a trainer's reply that directly names a term of a *pending
   * proposal's* dimension binds without the confirmation click — the card is
   * itself recorded ceremony, so the leniency is auditable in the transcript
   * (hard-won lesson 1, extended one step: a recorded proposal is context).
   * Absent or false, only the explicit confirmation binds a proposal — the
   * strict default a regulated pack keeps.
   */
  proposalDirectAnswers: boolean;
}

export interface AccordPack {
  packVersion: typeof PACK_SCHEMA_VERSION;
  /** Stable, versioned id recorded in every manifest this pack governed. */
  id: string;
  /** Absent means strict: every proposal needs its confirmation. */
  ceremony?: CeremonyPolicy;
  /**
   * The records' own boundary, as policy (epic #145, R3): the reviewed
   * lesson that says what these records do not hold. Taught when the model's
   * mapping links an ask to no certified field — a certified statement of
   * what the League holds beats a certified fact the trainer did not ask
   * for. Optional — a pack without it reports the boundary as a note alone.
   */
  recordsBoundary?: RecordsBoundaryRule;
  /** The data dictionary: every certified field, described (R3b). */
  dictionary: readonly DictionaryEntry[];
  presentation: Presentation;
  restrictions: readonly RestrictionRule[];
  actions: readonly ActionRule[];
  exhibits: readonly ExhibitRule[];
  curriculum: readonly CurriculumRule[];
  gameRules: readonly GameRule[];
  vocabulary: ScopeVocabulary;
}

/** The rule for one action, or nothing if this pack declares no such act. */
export function actionRule(pack: AccordPack, tool: string): ActionRule | undefined {
  return pack.actions.find((rule) => rule.id === tool);
}

/** The block a disclosure requires in one locale, or nothing. */
export function blockFor(rule: { block: DisclosureBlockRule }, locale: string): BlockContent | undefined {
  return rule.block.content.find((entry) => entry.locale === locale);
}

/** One approved lesson, by the id a model routes to, or nothing. */
export function curriculumRule(pack: AccordPack, id: string): CurriculumRule | undefined {
  return pack.curriculum.find((rule) => rule.id === id);
}

/** One certified game-rule constant, by the id a model names, or nothing. */
export function gameRule(pack: AccordPack, id: string): GameRule | undefined {
  return pack.gameRules.find((rule) => rule.id === id);
}

/** The approved sentence for a unit kind in one locale, or nothing. */
export function templateFor(pack: AccordPack, kind: string, locale: string): { id: string; text: string } | undefined {
  const template = pack.presentation.templates.find((entry) => entry.kind === kind);
  const text = template?.text[locale];
  return template === undefined || text === undefined ? undefined : { id: template.id, text };
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
  if (!Array.isArray(document.curriculum)) {
    // Same reasoning as the action registry: an empty catalogue is a pack
    // that teaches nothing, which is a coherent policy. A missing one is a
    // pack that never decided, and every routed lesson would be unapproved.
    return {
      ok: false,
      violations: [violation("IA-6", "pack-curriculum-missing", "Accord pack does not say what may be taught")],
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
  if (!Array.isArray(document.gameRules)) {
    // Like the curriculum: an empty list is a pack that states no constants, a
    // missing one is a pack that never decided, and every gameRule claim would
    // then name a rule nobody approved.
    return {
      ok: false,
      violations: [violation("IA-6", "pack-game-rules-missing", "Accord pack does not state the game's rules")],
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
    !Array.isArray(document.presentation.catalogue) ||
    !Array.isArray(document.presentation.templates)
  ) {
    return {
      ok: false,
      violations: [
        violation("IA-6", "pack-presentation-missing", "Accord pack says nothing about how an answer may be presented"),
      ],
    };
  }

  if (document.ceremony !== undefined) {
    const ceremony = document.ceremony as unknown as Record<string, unknown>;
    const keys = Object.keys(ceremony);
    if (
      typeof document.ceremony !== "object" ||
      document.ceremony === null ||
      keys.some((key) => key !== "proposalDirectAnswers") ||
      typeof ceremony.proposalDirectAnswers !== "boolean"
    ) {
      // Closed in both directions, like every policy section: an unreadable
      // dial is a pack that never decided how much ceremony it demands.
      return {
        ok: false,
        violations: [violation("IA-1", "pack-ceremony-malformed", "Accord pack's ceremony section is not readable")],
      };
    }
  }

  if (document.recordsBoundary !== undefined) {
    const boundary = document.recordsBoundary as unknown as Record<string, unknown>;
    const curriculum = document.curriculum as ReadonlyArray<{ id?: unknown }>;
    const lessonKnown =
      typeof boundary.lessonId === "string" && curriculum.some((lesson) => lesson.id === boundary.lessonId);
    if (typeof document.recordsBoundary !== "object" || document.recordsBoundary === null || !lessonKnown) {
      // A boundary naming a lesson the pack does not carry would teach
      // nothing — a hole that looks like policy.
      return {
        ok: false,
        violations: [violation("IA-6", "pack-records-boundary-malformed", "Accord pack's records boundary names no carried lesson")],
      };
    }
  }
  if (document.dictionary !== undefined && !Array.isArray(document.dictionary)) {
    return {
      ok: false,
      violations: [violation("IA-6", "pack-dictionary-malformed", "Accord pack's data dictionary is not a list")],
    };
  }

  // A pack without a dictionary (the pre-R3b packs, still governing filed
  // runs that must replay) offers the model no fields to link and the
  // driver nothing to hold the claims to — the measured control, not an
  // error. One that starts a dictionary must finish it: the checks below
  // refuse a partial one as incomplete.
  const pack = { ...document, dictionary: document.dictionary ?? [] } as AccordPack;
  const violations = [
    ...checkPresentation(pack.presentation),
    ...checkRules(pack, registry),
    ...checkActions(pack),
    ...checkGameRules(pack.gameRules),
    ...checkVocabulary(pack.vocabulary),
    ...(document.dictionary === undefined ? [] : checkDictionary(pack.dictionary, registry)),
  ];
  if (violations.length > 0) return { ok: false, violations };
  return { ok: true, value: pack };
}

/**
 * Every game-rule constant is a whole, positive number with a label that reads
 * after it. Reviewed data, so this catches a malformation, not a wrong value —
 * the value's correctness is the reviewer's, exactly as a lesson's text is.
 */
function checkGameRules(rules: readonly GameRule[]): Violation[] {
  const violations: Violation[] = [];
  const seen = new Set<string>();
  for (const rule of rules) {
    if (typeof rule.id !== "string" || rule.id.length === 0) {
      violations.push(violation("IA-6", "pack-game-rule-malformed", "a game rule has no id"));
      continue;
    }
    if (seen.has(rule.id)) {
      violations.push(violation("IA-6", "pack-duplicate-game-rule", `game rule "${rule.id}" appears more than once`, { actual: rule.id }));
    }
    seen.add(rule.id);
    if (!Number.isInteger(rule.value) || rule.value <= 0) {
      violations.push(
        violation("IA-6", "pack-game-rule-malformed", `game rule "${rule.id}" has no positive whole value`, { actual: String(rule.value) }),
      );
    }
    if (typeof rule.label !== "string" || rule.label.trim().length === 0) {
      violations.push(violation("IA-6", "pack-game-rule-malformed", `game rule "${rule.id}" has no label`, { actual: rule.id }));
    }
  }
  return violations;
}

function checkRules(pack: AccordPack, registry: CertifiedRegistry): Violation[] {
  const violations: Violation[] = [];
  const known = new Set<string>(ACCORD_ARTICLES.map((entry) => entry.id));
  const seen = new Set<string>();

  for (const rule of [...pack.restrictions, ...pack.exhibits, ...pack.curriculum]) {
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
    const gates = [rule.rarity !== undefined, rule.itemCategory !== undefined].filter(Boolean).length;
    if (gates !== 1) {
      violations.push(
        violation("IA-5", "pack-restriction-ungated", `restriction "${rule.id}" must gate exactly one of a rarity or an item category`, {
          expected: "rarity xor itemCategory",
          actual: `rarity=${String(rule.rarity)}, itemCategory=${String(rule.itemCategory)}`,
        }),
      );
    }
    if (rule.itemCategory !== undefined && !registry.items.some((item) => item.category === rule.itemCategory)) {
      // A gate on a category no item carries can never fire — policy that
      // measures nothing, refused exactly as an empty display floor is.
      violations.push(
        violation("IA-5", "pack-restriction-category-unknown", `restriction "${rule.id}" gates "${rule.itemCategory}", which no certified item carries`, {
          expected: [...new Set(registry.items.map((item) => item.category))].sort().join(", ") || "a world with items",
          actual: rule.itemCategory,
        }),
      );
    }
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

  for (const rule of pack.curriculum) {
    // A lesson is its block: the same locale coverage, emptiness and
    // self-naming digest rules a disclosure's text lives under.
    violations.push(...checkBlock(pack, rule));
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

  violations.push(...checkDisplay(presentation.display));

  const templateKinds = new Set<string>();
  for (const template of presentation.templates) {
    if (typeof template.id !== "string" || template.id.length === 0) {
      violations.push(violation("IA-6", "pack-template-unnamed", "a sentence template has no id"));
      continue;
    }
    const kindSlots = TEMPLATE_SLOTS[template.kind];
    if (kindSlots === undefined) {
      violations.push(
        violation("IA-6", "pack-template-kind-unknown", `template "${template.id}" presents "${String(template.kind)}", which is not a unit kind that takes a sentence`, {
          expected: Object.keys(TEMPLATE_SLOTS).join(", "),
          actual: String(template.kind),
        }),
      );
      continue;
    }
    if (templateKinds.has(template.kind)) {
      // Two approved sentences for one kind would leave the renderer choosing
      // wording, which is exactly the discretion templates exist to remove.
      violations.push(
        violation("IA-6", "pack-template-kind-duplicated", `unit kind "${template.kind}" carries more than one sentence template`, {
          actual: template.kind,
        }),
      );
    }
    templateKinds.add(template.kind);
    for (const locale of presentation.locales) {
      const text = template.text?.[locale];
      if (typeof text !== "string" || text.trim().length === 0) {
        violations.push(
          violation("IA-6", "pack-template-locale-missing", `template "${template.id}" has no sentence for ${locale}`, {
            expected: presentation.locales.join(", "),
            actual: locale,
          }),
        );
        continue;
      }
      const placeholders = templatePlaceholders(text);
      if (placeholders.length === 0) {
        // A sentence with no bound value is free prose wearing a mark.
        violations.push(
          violation("IA-6", "pack-template-unbound", `template "${template.id}" (${locale}) binds no certified value`, {
            expected: `a placeholder from: ${kindSlots.join(", ")}`,
            actual: text,
          }),
        );
      }
      for (const name of placeholders) {
        if (!kindSlots.includes(name)) {
          violations.push(
            violation("IA-6", "pack-template-slot-unknown", `template "${template.id}" (${locale}) names "{${name}}", which a ${template.kind} unit never certifies`, {
              expected: kindSlots.join(", "),
              actual: name,
            }),
          );
        }
      }
    }
  }

  return violations;
}

/**
 * Validate the display floors.
 *
 * Same discipline the rest of the pack gets: a floor that is missing, zero, or
 * outside the range it means switches the live affidavit's measurement off
 * silently. A missing prominence floor would let any font size pass; an opacity
 * floor of zero would call a fully transparent disclosure "shown". Fail closed
 * at load, before any page is measured against a policy that measures nothing.
 */
function checkDisplay(display: DisplayPolicy | undefined): Violation[] {
  if (display === null || typeof display !== "object") {
    return [
      violation(
        "IA-6",
        "pack-display-missing",
        "the pack states no display floors, so a live page's prominence and proximity could never be measured",
      ),
    ];
  }

  const violations: Violation[] = [];
  const positive = (key: "minLegiblePx" | "maxProximityPx") => {
    const value = display[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      violations.push(
        violation("IA-6", "pack-display-unusable", `the display floor "${key}" is not a positive number of pixels`, {
          actual: String(value),
        }),
      );
    }
  };
  positive("minLegiblePx");
  positive("maxProximityPx");

  // Opacity is a fraction, not a pixel count: a floor at or below zero would
  // call an invisible disclosure legible, and one above one could never be met.
  const opacity = display.minLegibleOpacity;
  if (typeof opacity !== "number" || !Number.isFinite(opacity) || opacity <= 0 || opacity > 1) {
    violations.push(
      violation("IA-6", "pack-display-unusable", 'the display floor "minLegibleOpacity" is not a fraction in (0, 1]', {
        actual: String(opacity),
      }),
    );
  }

  return violations;
}

/** A rule's mandatory text: present in every locale, and naming itself.
 * Shared by disclosures and lessons — a block is a block wherever it lives. */
function checkBlock(pack: AccordPack, rule: { id: string; block: DisclosureBlockRule }): Violation[] {
  const violations: Violation[] = [];
  const block = rule.block;

  if (block === undefined || typeof block.id !== "string" || block.id.length === 0) {
    return [
      violation("IA-6", "pack-block-missing", `rule "${rule.id}" carries no text block`, {
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

    if (rule.askParameter !== undefined && typeof rule.askParameter !== "boolean") {
      violations.push(
        violation("IA-1", "pack-ask-parameter-malformed", `"${rule.dimension}" declares askParameter as something other than a boolean`, {
          expected: "boolean",
          actual: typeof rule.askParameter,
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

/** The subject a certified surface belongs to, from the registry's own
 * vocabulary — the check that a dictionary entry describes the field it
 * names as the kind of thing it is. */
function subjectOfSurface(id: string): DictionarySubject | undefined {
  if (SPECIES_FACT_IDS.includes(id)) return "species";
  if (MOVE_FACT_IDS.includes(id)) return "move";
  if (ITEM_FACT_IDS.includes(id)) return "item";
  if (id === "type-chart") return "type";
  return undefined;
}

/**
 * The dictionary pinned to the registry, both ways (R3b): every entry names
 * a surface this world certifies and describes it as the right subject's
 * field; every certified surface has an entry; no id twice; no alias on two
 * fields of one subject (the cross-check could not tell which the phrase
 * meant); no alias or id spelt like the reserved "none". Reviewed data, so
 * this catches a malformation, not a wrong description — the words are the
 * reviewer's.
 */
function checkDictionary(dictionary: readonly DictionaryEntry[], registry: CertifiedRegistry): Violation[] {
  const violations: Violation[] = [];
  const surfaces = fidelitySurfaces(registry.document);
  const seen = new Set<string>();
  const aliasOwners = new Map<string, string>();
  for (const entry of dictionary) {
    const sound =
      typeof entry === "object" &&
      entry !== null &&
      typeof entry.id === "string" &&
      entry.id.length > 0 &&
      typeof entry.name === "string" &&
      entry.name.trim().length > 0 &&
      typeof entry.description === "string" &&
      entry.description.trim().length > 0 &&
      Array.isArray(entry.aliases) &&
      entry.aliases.every((alias) => typeof alias === "string" && alias.trim().length > 0 && alias === alias.toLowerCase().trim());
    if (!sound) {
      violations.push(violation("IA-6", "pack-dictionary-entry-malformed", "a dictionary entry lacks an id, a name, a description or lowercase aliases"));
      continue;
    }
    if (entry.id === NO_FIELD || entry.aliases.includes(NO_FIELD)) {
      violations.push(violation("IA-6", "pack-dictionary-entry-malformed", `dictionary entry "${entry.id}" uses the reserved word "${NO_FIELD}"`, { actual: entry.id }));
    }
    if (seen.has(entry.id)) {
      violations.push(violation("IA-6", "pack-dictionary-duplicate-field", `dictionary entry "${entry.id}" appears more than once`, { actual: entry.id }));
    }
    seen.add(entry.id);
    const subject = subjectOfSurface(entry.id);
    if (subject === undefined || !surfaces.includes(entry.id)) {
      violations.push(violation("IA-6", "pack-dictionary-field-unknown", `dictionary entry "${entry.id}" names no surface these records certify`, { actual: entry.id }));
    } else if (entry.subject !== subject) {
      violations.push(
        violation("IA-6", "pack-dictionary-subject-mismatch", `dictionary entry "${entry.id}" is a ${subject} field, not ${String(entry.subject)}`, {
          expected: subject,
          actual: String(entry.subject),
        }),
      );
    }
    // Unique within a subject: "type" may name a species' typing and a
    // move's type at once, because the cross-check reads aliases per the
    // subject the ask names; two species fields sharing a word could not
    // be told apart by anything.
    for (const alias of entry.aliases) {
      const key = `${String(entry.subject)}:${alias}`;
      const owner = aliasOwners.get(key);
      if (owner !== undefined && owner !== entry.id) {
        violations.push(
          violation("IA-6", "pack-dictionary-alias-shared", `alias "${alias}" belongs to both "${owner}" and "${entry.id}"`, { actual: alias }),
        );
      }
      aliasOwners.set(key, entry.id);
    }
  }
  const missing = surfaces.filter((surface) => !seen.has(surface));
  if (missing.length > 0) {
    violations.push(
      violation("IA-6", "pack-dictionary-incomplete", `the dictionary describes no entry for: ${missing.join(", ")}`, { actual: missing.join(", ") }),
    );
  }
  return violations;
}

/** One dictionary entry by field id, or nothing. */
/**
 * One word a trainer could say that names two fields of the same subject:
 * an alias of `field` that is carried, word-bounded, by the name or an alias
 * of `within` (or equals one of its aliases). Not an error in the pack — a
 * bare "defense" *is* what people say — but every collision is a question
 * the driver may have to ask, and a pack's count of them is a number a
 * knowledge steward owns and ratchets down (docs/generalization.md §4).
 */
export interface DictionaryCollision {
  field: string;
  alias: string;
  within: string;
  /** The colliding name or alias of `within`, as written. */
  carrier: string;
}

/**
 * The dictionary's alias collisions, by structure alone — no domain word in
 * the check, so it lints a Pokédex and a drug label alike. Found while
 * reading the first governance-tax legs (2026-09-11): "evolves", an alias of
 * one field, sits inside "How it evolves", the name of another, and the
 * exact label of an option read as ambiguous.
 */
export function dictionaryCollisions(dictionary: readonly DictionaryEntry[]): readonly DictionaryCollision[] {
  const normalise = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const carries = (hay: string, needle: string): boolean => needle.length > 0 && ` ${hay} `.includes(` ${needle} `);
  const found: DictionaryCollision[] = [];
  for (const field of dictionary) {
    for (const within of dictionary) {
      if (within.id === field.id || within.subject !== field.subject) continue;
      for (const alias of field.aliases) {
        const word = normalise(alias);
        const carriers = [within.name, ...within.aliases].filter((carrier) => carries(normalise(carrier), word));
        for (const carrier of carriers) found.push({ field: field.id, alias, within: within.id, carrier });
      }
    }
  }
  return found;
}

export function dictionaryEntry(pack: AccordPack, id: string): DictionaryEntry | undefined {
  return pack.dictionary.find((entry) => entry.id === id);
}

/** The restrictions that apply to one species, by its certified rarity. */
export function restrictionsFor(
  pack: AccordPack,
  species: { isLegendary: boolean; isMythical: boolean },
): readonly RestrictionRule[] {
  return pack.restrictions.filter((rule) =>
    rule.rarity === undefined ? false : rule.rarity === "legendary" ? species.isLegendary : species.isMythical,
  );
}

/** The rules gating an item, by its certified category (epic #94, slice 3). */
export function itemRestrictionsFor(pack: AccordPack, item: { category: string }): readonly RestrictionRule[] {
  return pack.restrictions.filter((rule) => rule.itemCategory !== undefined && rule.itemCategory === item.category);
}
