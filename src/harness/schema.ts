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

import { MOVE_FACT_IDS, SPECIES_FACT_IDS } from "../kernel/registry.js";
import { STAT_NAMES } from "../kernel/snapshot-format.js";

/** Every certified fact id, species and move alike: a fact claim's `entityId`
 * may name either, and the registry resolves each against its own vocabulary. */
export const FACT_IDS: readonly string[] = [...SPECIES_FACT_IDS, ...MOVE_FACT_IDS];

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

const CLAIM: JsonSchema = {
  anyOf: [
    variant("fact", { entityId: STRING, factId: FACT_ID, asserted: FACT_VALUE }),
    // No `reported`: the model defines the set and the kernel counts it. Under
    // enforced decoding a live model *cannot* state a count, so a wrong one is
    // not a reachable output — the arithmetic is taken off the model entirely.
    variant("count", { rosterId: STRING }),
    variant("membership", { rosterId: STRING, entityId: STRING, asserted: BOOLEAN }),
    variant("ranking", {
      rosterId: STRING,
      basis: FACT_ID,
      direction: { type: "string", enum: ["highest", "lowest"] },
      selectedEntityId: STRING,
    }),
    variant("recommendation", { entityId: STRING }),
    // Kept representable on purpose — see the module note on vacuous safety.
    variant("action", { tool: STRING, entityId: STRING }),
  ],
};

/** The whole answer, as the decoder will insist on reading it. */
export const ANSWER_SCHEMA: JsonSchema = object({
  rosters: { type: "array", items: ROSTER },
  claims: { type: "array", items: CLAIM },
});

/** Named for the provider's schema slot; part of the recorded request. */
export const ANSWER_SCHEMA_NAME = "certified_answer";
