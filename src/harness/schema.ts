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

import { ITEM_FACT_IDS, MOVE_FACT_IDS, SPECIES_FACT_IDS, STATUS_CONDITIONS } from "../kernel/registry.js";
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

const CRITERION: JsonSchema = {
  anyOf: [
    variant("has-type", { type: STRING }),
    variant("learns-move", { move: STRING }),
    variant("rarity", { rarity: { type: "string", enum: ["legendary", "mythical"] } }),
    variant("stat-at-least", { stat: { type: "string", enum: [...STAT_NAMES] }, value: NUMBER }),
    variant("stat-at-most", { stat: { type: "string", enum: [...STAT_NAMES] }, value: NUMBER }),
  ],
};

const ROSTER: JsonSchema = object({
  id: STRING,
  criteria: object({ all: { type: "array", items: CRITERION } }),
});

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
          variant("comparison", { factId: FACT_ID, leftId: STRING, rightId: STRING }),
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
export function answerSchema(
  pack: {
    curriculum: ReadonlyArray<{ id: string }>;
    gameRules: ReadonlyArray<{ id: string }>;
  },
  /** When present, the filler kinds (`count`/`typeCount`/`gameRule`) a question
   * nominated; the schema offers only those three. Absent means no gate — all
   * three are offered, the default for every path that has not opted in. */
  fillerKinds?: ReadonlySet<FillerKind>,
  /** Whether the world certifies items — offers the Center claim kinds. */
  items = false,
): JsonSchema {
  return object({
    rosters: { type: "array", items: ROSTER },
    claims: {
      type: "array",
      items: claimSchema(
        pack.curriculum.map((entry) => entry.id),
        pack.gameRules.map((entry) => entry.id),
        fillerKinds,
        items,
      ),
    },
  });
}

/** Named for the provider's schema slot; part of the recorded request. */
export const ANSWER_SCHEMA_NAME = "certified_answer";
