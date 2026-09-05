/**
 * The answer contract as a machine-enforced grammar, not just prose.
 *
 * The prompt already *describes* the shape an answer must take. A capable model
 * reads that and complies; a weak one reads it and returns something
 * plausible-looking that the decoder refuses — in the published run, every
 * single failure of the weak model was "a roster is malformed", never a wrong
 * fact. That is a usefulness ceiling with no safety content at all: the model
 * had things to say and could not say them in the shape required.
 *
 * So the same contract is emitted here as a JSON Schema and handed to the
 * provider, which constrains decoding token by token. Malformed JSON, an
 * invented claim kind, a `factId` the registry never certifies — none of them
 * are reachable outputs any more, because the grammar does not admit them.
 *
 * Two things this deliberately does **not** do, both load-bearing:
 *
 *  - **It constrains shape, never content.** Every value remains the model's own
 *    and is still recomputed against the snapshot by `compileManifest`. A
 *    well-formed lie is exactly as denied as a malformed one; the grammar makes
 *    fabrications *legible*, not permissible. Scaffolding the proposer is only
 *    safe because the verifier downstream is independent of it — which is the
 *    whole architecture in one sentence.
 *  - **It never removes the ability to attempt a violation.** `action` stays in
 *    the claim grammar even though the corpus does not ask for one: a schema
 *    that made forbidden acts unrepresentable would buy a safety number by
 *    making the safety test vacuous, which is the trap this project keeps
 *    naming. The gate must be *seen* refusing, not spared the question.
 *
 * The vocabulary is imported from the kernel rather than restated, so the
 * grammar cannot drift from what actually resolves: adding a certified fact
 * widens this schema in the same commit, or a test fails.
 */

import { NO_FIELD } from "../kernel/pack.js";
import { COMPARABLE_FACT_IDS, ITEM_FACT_IDS, MOVE_FACT_IDS, SPECIES_FACT_IDS, STATUS_CONDITIONS } from "../kernel/registry.js";
import { STAT_NAMES } from "../kernel/snapshot-format.js";
import type { FillerKind } from "./grammar-gate.js";

/** Every certified fact id, species and move alike: a fact claim's `entityId`
 * may name either, and the registry resolves each against its own vocabulary. */
export const FACT_IDS: readonly string[] = [...SPECIES_FACT_IDS, ...MOVE_FACT_IDS, ...ITEM_FACT_IDS];

/** A JSON Schema document, as far as this module needs to describe one. */
export type JsonSchema = Record<string, unknown>;

/** Strict structured output requires every property listed and nothing extra;
 * this keeps that rule in one place rather than repeated at every object. */
function object(properties: Record<string, JsonSchema>): JsonSchema {
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

/**
 * A discriminated variant: a literal `kind` plus its own fields.
 *
 * The discriminator is written as a single-member `enum` *with* an explicit
 * `type`, rather than the terser bare `const`. Providers disagree here — one
 * accepted `{const: "fact"}` happily while another rejected the whole schema
 * with "schema must have a 'type' key", which arrives as a 400 on every call
 * and reads downstream as a total outage. The verbose form is the portable one.
 */
function variant(kind: string, fields: Record<string, JsonSchema> = {}): JsonSchema {
  return object({ kind: { type: "string", enum: [kind] }, ...fields });
}

const STRING: JsonSchema = { type: "string" };
const NUMBER: JsonSchema = { type: "number" };
const BOOLEAN: JsonSchema = { type: "boolean" };

/** A fact id the registry actually certifies — the enum that ends the
 * `type` vs `types`, `national-dex-number` vs `pokedex-number` class of
 * failure by making the wrong id unrepresentable. Species and move facts both,
 * so a claim about a move's power is as expressible as one about a species. */
const FACT_ID: JsonSchema = { type: "string", enum: [...FACT_IDS] };

const FACT_VALUE: JsonSchema = {
  anyOf: [
    variant("number", { value: NUMBER }),
    variant("boolean", { value: BOOLEAN }),
    variant("text", { value: STRING }),
    variant("list", { value: { type: "array", items: STRING } }),
    variant("absent"),
  ],
};

/** The vocabularies a world can close beyond the compiled-in ones — the type
 * names and item categories are the snapshot's, so the caller passes them and
 * the grammar makes an invented one unrepresentable (loop 2: the re-run spent
 * 12 abstentions on IA-3/unknown-type and unknown-item-category rosters).
 * Absent, the field stays a free string and the kernel's IA-3 names it. */
export interface WorldVocabulary {
  types?: readonly string[];
  itemCategories?: readonly string[];
}

function speciesCriterionSchema(vocabulary?: WorldVocabulary): JsonSchema[] {
  const type = vocabulary?.types === undefined ? STRING : { type: "string", enum: [...vocabulary.types] };
  return [
    variant("has-type", { type }),
    variant("learns-move", { move: STRING }),
    variant("rarity", { rarity: { type: "string", enum: ["legendary", "mythical"] } }),
    variant("stat-at-least", { stat: { type: "string", enum: [...STAT_NAMES] }, value: NUMBER }),
    variant("stat-at-most", { stat: { type: "string", enum: [...STAT_NAMES] }, value: NUMBER }),
  ];
}

/** The item universe's criteria (epic #94, Center loop 1): the kernel has
 * built item rosters since slice 3, but the grammar never offered them — so a
 * model asked "what all cures poison" could not express the set and improvised
 * treats enumerations instead. Offered only in a world that certifies items. */
function itemCriterionSchema(vocabulary?: WorldVocabulary): JsonSchema[] {
  const category =
    vocabulary?.itemCategories === undefined ? STRING : { type: "string", enum: [...vocabulary.itemCategories] };
  return [
    variant("item-category", { category }),
    variant("treats-condition", { condition: { type: "string", enum: [...STATUS_CONDITIONS] } }),
    variant("cost-at-most", { value: NUMBER }),
    variant("cost-at-least", { value: NUMBER }),
  ];
}

function rosterSchema(items: boolean, vocabulary?: WorldVocabulary): JsonSchema {
  const species = object({
    id: STRING,
    criteria: object({ all: { type: "array", items: { anyOf: speciesCriterionSchema(vocabulary) } } }),
  });
  if (!items) return species;
  // Two roster shapes, not one criterion soup: a roster is EITHER a set of
  // species OR a set of items, and the split makes criteria-domain-mixed
  // unrepresentable at decode — the same anyOf trick as the comparison's
  // numeric enum, with the kernel's rosterDomain gate staying load-bearing
  // for anything the grammar cannot see (loop 2: 5 of the re-run's
  // abstentions were mixed-domain rosters refused whole).
  const item = object({
    id: STRING,
    criteria: object({ all: { type: "array", items: { anyOf: itemCriterionSchema(vocabulary) } } }),
  });
  return { anyOf: [species, item] };
}

function claimSchema(lessonIds: readonly string[], ruleIds: readonly string[], fillerKinds?: ReadonlySet<FillerKind>, items = false): JsonSchema {
  // Retrieval-gated grammar (grammar-gate.ts): the three aggregate/constant
  // kinds are offered only when a question nominates them; `undefined` means no
  // gate and all three are offered (the default, and every non-retrieval path).
  // Nothing else is ever gated — the entity/relation kinds, and every kind the
  // gate must be *seen* refusing, stay representable.
  const filler = (kind: FillerKind): boolean => fillerKinds === undefined || fillerKinds.has(kind);
  return {
    anyOf: [
    // Two fact shapes rather than one optional field: strict-mode providers
    // reject schemas whose `required` omits a declared property, so the
    // choice between naming the fact and also asserting its value is a
    // union, exactly as the kernel treats it. Naming alone is the grounded
    // shape — the system reads the certified value; asserting is allowed and
    // is verified, so a misremembered spelling refuses rather than commits.
    variant("fact", { entityId: STRING, factId: FACT_ID }),
    variant("fact", { entityId: STRING, factId: FACT_ID, asserted: FACT_VALUE }),
    // No `reported`: the model defines the set and the kernel counts it. Under
    // enforced decoding a live model *cannot* state a count, so a wrong one is
    // not a reachable output — the arithmetic is taken off the model entirely.
    ...(filler("count") ? [variant("count", { rosterId: STRING })] : []),
    // "How many types are there?" — no roster, no fields; the kernel counts the
    // certified type universe. Under enforced decoding the model cannot state a
    // number, so there is nothing here to get wrong.
    ...(filler("typeCount") ? [variant("typeCount")] : []),
    // A game-rule constant names a rule from the pack's closed table — an enum,
    // like the lesson ids, so a fabricated rule is unrepresentable. The kernel
    // fills the number, so none is stated here. Omitted whole when the pack
    // declares no rules (an empty enum some providers reject).
    ...(ruleIds.length === 0 || !filler("gameRule") ? [] : [variant("gameRule", { ruleId: { type: "string", enum: [...ruleIds] } })]),
    variant("membership", { rosterId: STRING, entityId: STRING, asserted: BOOLEAN }),
    // The Center kinds (epic #94, slice 3) are offered only in a world that
    // certifies items: in any other, nothing they name could resolve and the
    // grammar would be advertising dead shapes. The verdict and the values
    // are the kernel's to derive, so neither is representable here — the
    // model names the pair, never the answer.
    ...(items
      ? [
          variant("treats", { itemId: STRING, condition: { type: "string", enum: [...STATUS_CONDITIONS] } }),
          // Only fact ids that can be numeric: the first paid Center run
          // showed the model comparing prose with prose (cures, item-effect)
          // 80+ times under the full enum, every one a named denial the
          // grammar can simply stop admitting. The kernel's runtime check
          // stays load-bearing for the cases the enum cannot see (a "full"
          // where a number usually lives, a degenerate self-pair).
          variant("comparison", { factId: { type: "string", enum: [...COMPARABLE_FACT_IDS] }, leftId: STRING, rightId: STRING }),
        ]
      : []),
    // No `selectedEntityId`: the model declares the set, the basis and the
    // direction, and the kernel picks the extreme. Like the count, a wrong
    // winner is not a reachable output under enforced decoding.
    variant("ranking", {
      rosterId: STRING,
      basis: FACT_ID,
      direction: { type: "string", enum: ["highest", "lowest"] },
    }),
    // No `members`: the model names the subject and the direction, and the
    // kernel derives the set from the certified chart. A wrong weakness is not
    // a reachable output under enforced decoding.
    variant("matchup", {
      subject: {
        anyOf: [variant("species", { entityId: STRING }), variant("type", { typeId: STRING })],
      },
      direction: { type: "string", enum: ["weak-to", "resists", "immune-to", "strong-against"] },
    }),
    // No `finding`: the model names the species; the kernel derives what the
    // rules say about advising it — the pack as readable knowledge (IA-5).
    variant("eligibility", { entityId: STRING }),
    // The lesson ids are an enum from the pack's catalogue, exactly as fact
    // ids are an enum from the registry: a fabricated lesson is made
    // unrepresentable rather than merely denied. A pack that teaches nothing
    // offers no explanation shape at all — an empty enum is a schema some
    // providers reject wholesale, and there is nothing it would admit.
    ...(lessonIds.length === 0
      ? []
      : [variant("explanation", { blockId: { type: "string", enum: [...lessonIds] } })]),
    variant("recommendation", { entityId: STRING }),
    // Kept representable on purpose — see the module note on vacuous safety.
    variant("action", { tool: STRING, entityId: STRING }),
    ],
  };
}

/**
 * The whole answer, as the decoder will insist on reading it.
 *
 * A function of the pack because the grammar tracks *two* closed worlds now:
 * the registry's fact ids (compiled in) and the pack's lesson catalogue
 * (versioned data). The schema a provider enforces is always the one the
 * governing pack defines.
 */
/**
 * The most claims one answer may carry, enforced in the grammar itself.
 *
 * Without a bound, a model in a repetition loop is grammatically legal all
 * the way to the token cap — observed live (2026-08-29): a broad ask looped
 * the same gameRule claims for 43 seconds, hit max_tokens mid-string, and
 * the truncated JSON cost the trainer an abstention. A structured-output
 * provider enforces maxItems at decode, so the loop becomes unrepresentable
 * rather than discouraged. The budget is a usefulness dial, not policy: an
 * honest answer here runs one to eight claims, so twelve binds only on
 * pathology — and per "no silent caps", a completion that still hits the
 * token cap is named as truncated where it is decoded (docs/scale.md, S1).
 */
export const MAX_ANSWER_CLAIMS = 12;

/** Rosters name sets the claims cite; no honest answer has needed more than
 * two. Bounded for the same reason as {@link MAX_ANSWER_CLAIMS}. */
export const MAX_ANSWER_ROSTERS = 4;

/** Things one ask can ask for; a question rarely names more than three. */
export const MAX_ASKED = 6;

/**
 * The schema linking the model performs (docs/routing.md, R3b): per thing
 * the trainer asked for, the certified field the model read the phrase as,
 * or the reserved "none" when the records certify no such field. The enum is
 * built from the pack's data dictionary at call time, exactly as lesson and
 * rule ids are, so a field the dictionary does not describe is
 * unrepresentable. A nomination like any other: untrusted, recorded, and
 * checked by the driver against the claims — structure, not words.
 */
function askedSchema(fieldIds: readonly string[]): JsonSchema {
  return {
    type: "array",
    maxItems: MAX_ASKED,
    items: object({
      phrase: STRING,
      entityId: STRING,
      fieldId: { type: "string", enum: [...fieldIds, NO_FIELD] },
    }),
  };
}

/** Options one clarification may offer; a real ambiguity is two or three
 * readings, never a menu. */
export const MAX_CLARIFY_OPTIONS = 4;

/**
 * The clarification the model may nominate instead of answering (R3b step
 * 3): a question in its own words about one phrase of the ask, with typed
 * options — a certified field of the dictionary (or the reserved none), or a
 * certified subject. Each option is a binding the driver can apply when the
 * trainer picks it; the question text is shown and recorded, never a claim.
 * One more claim variant, like a route nomination: it travels in `claims`
 * and never reaches compilation.
 */
function clarifySchema(fieldIds: readonly string[]): JsonSchema {
  return variant("clarify", {
    about: STRING,
    question: STRING,
    options: {
      type: "array",
      maxItems: MAX_CLARIFY_OPTIONS,
      items: {
        anyOf: [
          variant("field", { label: STRING, fieldId: { type: "string", enum: [...fieldIds, NO_FIELD] } }),
          variant("entity", { label: STRING, entityId: STRING }),
        ],
      },
    },
  });
}

export function answerSchema(
  pack: {
    curriculum: ReadonlyArray<{ id: string }>;
    gameRules: ReadonlyArray<{ id: string }>;
    /** The data dictionary; an empty one offers no `asked` array at all (the
     * ungoverned control arm, which links nothing because nothing checks). */
    dictionary: ReadonlyArray<{ id: string }>;
  },
  /** When present, the filler kinds (`count`/`typeCount`/`gameRule`) a question
   * nominated; the schema offers only those three. Absent means no gate — all
   * three are offered, the default for every path that has not opted in. */
  fillerKinds?: ReadonlySet<FillerKind>,
  /** Whether the world certifies items — offers the Center claim kinds. */
  items = false,
  /** The world's own closed vocabularies (type names, item categories), when
   * the caller has a registry to read them from. */
  vocabulary?: WorldVocabulary,
  /** Deterministic routes the caller lets the model nominate — recognition
   * offered where composition keeps failing (epic #118). Absent for every
   * path that has not opted in, so the harness banks measure an unchanged
   * grammar. */
  routes?: readonly NominableRoute[],
  /** Whether the model may nominate a clarification (R3b step 3). Offered
   * only with a dictionary to type the options against; off for every path
   * that has not opted in, so the banks measure an unchanged grammar. */
  clarify = false,
): JsonSchema {
  const fieldIds = pack.dictionary.map((entry) => entry.id);
  return object({
    ...(pack.dictionary.length === 0 ? {} : { asked: askedSchema(fieldIds) }),
    rosters: { type: "array", maxItems: MAX_ANSWER_ROSTERS, items: rosterSchema(items, vocabulary) },
    claims: {
      type: "array",
      maxItems: MAX_ANSWER_CLAIMS,
      items: {
        anyOf: [
          ...(claimSchema(
            pack.curriculum.map((entry) => entry.id),
            pack.gameRules.map((entry) => entry.id),
            fillerKinds,
            items,
          ) as { anyOf: JsonSchema[] }).anyOf,
          ...(routes ?? []).map((route) =>
            variant("route", { routeId: { type: "string", enum: [route.id] }, ...route.args }),
          ),
          ...(clarify && fieldIds.length > 0 ? [clarifySchema(fieldIds)] : []),
        ],
      },
    },
  });
}

/**
 * A deterministic driver route the model may nominate instead of composing
 * an answer — the door, described for a 1-of-k choice, never the work. The
 * grammar offers each as one more claim variant ({"kind": "route", ...});
 * whether a nomination is honored, and what it composes, is the driver's
 * business, and everything a route composes still faces the kernel whole.
 */
export interface NominableRoute {
  id: string;
  /** One line, written for the model: when this door is the ask. */
  description: string;
  /** The route's argument properties, all required (strict decoding). */
  args: Record<string, JsonSchema>;
}

/** Named for the provider's schema slot; part of the recorded request. */
export const ANSWER_SCHEMA_NAME = "certified_answer";
