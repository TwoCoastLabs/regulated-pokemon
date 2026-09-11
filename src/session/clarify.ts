/**
 * Clarification, the driver's half (docs/routing.md, R3b step 3): the model
 * may ask, the trainer's pick binds.
 *
 * A clarification is a nomination with typed options. The question's wording
 * is the model's and is only ever shown; what a pick *binds to* is an id the
 * driver typed against the dictionary or the registry, so everything here
 * reads structure:
 *
 *  - {@link validOptions} keeps the options whose ids exist — a field of the
 *    pack's dictionary (or the reserved none), a subject the registry
 *    certifies — and drops the rest. An option the grammar could not have
 *    produced is dropped if it arrives.
 *  - {@link matchPick} reads the trainer's reply against the options: by
 *    label, or by the dictionary's aliases for a field option, or by the
 *    subject's own name for an entity option. Exactly one match is a pick;
 *    none or several is not, and the driver asks again or gives up.
 *  - {@link scopeOptions} lists the pack's approved values for a dimension
 *    as options the trainer can click — the labels are the vocabulary's own
 *    tokens, so a click says exactly what the kernel's answer route reads.
 *
 * None of this contains a domain word. The labels are the pack's and the
 * model's; the checks are the same for a Pokédex and a drug label.
 */

import type { ClarificationOption, ScopeDimension } from "../kernel/contracts.js";
import type { AccordPack, DictionaryEntry } from "../kernel/pack.js";
import type { CertifiedRegistry } from "../kernel/registry.js";

/** How many times the advisor may ask about one ask before it gives up —
 * a field, then a subject, and never a third (docs/routing.md, R3b: "so the
 * bot can ask twice and never interrogate"). A constant beside the ladder's. */
export const MAX_CLARIFICATIONS = 2;

/**
 * The options whose ids exist, in the order offered; duplicates by binding
 * fold to their first statement. Labels are trimmed; an empty one is no
 * option at all.
 */
export function validOptions(
  pack: AccordPack,
  registry: CertifiedRegistry,
  options: readonly ClarificationOption[],
): readonly ClarificationOption[] {
  const seen = new Set<string>();
  const kept: ClarificationOption[] = [];
  for (const option of options) {
    const label = option.label.trim();
    if (label.length === 0) continue;
    if (option.kind === "field") {
      if (option.fieldId !== null && !pack.dictionary.some((entry) => entry.id === option.fieldId)) continue;
      const key = `field:${option.fieldId ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      kept.push({ kind: "field", label, fieldId: option.fieldId });
    } else {
      const id = canonicalId(option.entityId);
      if (!certifies(registry, id)) continue;
      const key = `entity:${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      kept.push({ kind: "entity", label, entityId: id });
    }
  }
  return kept;
}

/**
 * The trainer's reply, read against the options, by tiers of evidence.
 *
 * A reply can match an option four ways, and they are not equal evidence:
 * the option's own label (what a click would have said); the field's or
 * subject's name; an alias of the field; a certified subject the model never
 * listed. A pick binds when the *strongest tier that matches anything*
 * matches exactly one option. Only a tie inside that tier, or no match at
 * any tier, is ambiguous — and then the driver asks again.
 *
 * Found live (2026-09-11): "How it evolves" — the exact label of one option
 * — was read as ambiguous because the other option's alias "evolves" sits
 * inside it, and every tier had counted alike. Aliases are also read
 * *discriminatingly*: an alias that is carried by another offered option's
 * label, name or aliases says nothing about the choice and is ignored for
 * this question (computed per question, so it holds for any dictionary).
 */
export function matchPick(
  pack: AccordPack,
  registry: CertifiedRegistry,
  options: readonly ClarificationOption[],
  reply: string,
): ClarificationOption | undefined {
  const said = normalise(reply);
  if (said.length === 0) return undefined;
  const fieldOf = (option: ClarificationOption): DictionaryEntry | undefined =>
    option.kind === "field" && option.fieldId !== null ? pack.dictionary.find((entry) => entry.id === option.fieldId) : undefined;
  const nameOf = (option: ClarificationOption): string | undefined =>
    option.kind === "field" ? fieldOf(option)?.name : option.entityId.replace(/-/g, " ");
  /** Every word an option answers to — for deciding which aliases discriminate. */
  const wordsOf = (option: ClarificationOption): readonly string[] =>
    [option.label, nameOf(option) ?? "", ...(fieldOf(option)?.aliases ?? [])].map(normalise).filter((word) => word.length > 0);

  const tiers: ((option: ClarificationOption) => boolean)[] = [
    (option) => carries(said, normalise(option.label)),
    (option) => {
      const name = nameOf(option);
      return name !== undefined && carries(said, normalise(name));
    },
    (option) => {
      const field = fieldOf(option);
      if (field === undefined) return false;
      const others = options.filter((other) => other !== option).flatMap(wordsOf);
      return field.aliases
        .map(normalise)
        .filter((alias) => !others.some((word) => carries(word, alias)))
        .some((alias) => carries(said, alias));
    },
  ];
  for (const tier of tiers) {
    const matched = options.filter(tier);
    if (matched.length === 1) return matched[0];
    if (matched.length > 1) return undefined;
  }
  // A question about *which subject*, answered with a certified subject the
  // model did not list, is still answered — the options were the model's
  // guesses at the candidates, and the trainer's own word outranks a guess
  // (found live 2026-09-05: "the fast one" drew Electrode, Caterpie and
  // Dragonite, and "Pikachu" matched nothing). Typed exactly as a listed
  // option is: the id must be one the registry certifies, and exactly one.
  if (options.length > 0 && options.every((option) => option.kind === "entity")) {
    const named = [...registry.speciesIds, ...registry.moveIds, ...registry.itemIds].filter((id) => carries(said, id.replace(/-/g, " ")));
    if (named.length === 1) return { kind: "entity", label: reply.trim(), entityId: named[0]! };
  }
  return undefined;
}

/**
 * The pack's approved values for one dimension as clickable options: one
 * per distinct value, labelled by the term's own token (the one spelled like
 * the value when there is one), so a click sends words the vocabulary reads
 * with no context needed — the recorded question is the context.
 */
export function scopeOptions(pack: AccordPack, dimension: ScopeDimension): readonly string[] {
  const rule = pack.vocabulary.dimensions.find((entry) => entry.dimension === dimension);
  if (rule === undefined) return [];
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const term of rule.terms) {
    const value = String(term.value);
    if (seen.has(value)) continue;
    seen.add(value);
    const token = term.tokens.find((candidate) => candidate === value) ?? term.tokens[0];
    if (token !== undefined) labels.push(token);
  }
  return labels;
}

/** Whether the registry certifies an id as a species, move, item or type. */
export function certifies(registry: CertifiedRegistry, id: string): boolean {
  return registry.speciesIds.includes(id) || registry.moveIds.includes(id) || registry.itemIds.includes(id) || registry.typeNames.has(id);
}

/** An id as the registry spells it: lowercase, hyphenated. */
export function canonicalId(raw: string): string {
  return raw.toLowerCase().trim().replace(/\s+/g, "-");
}

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Whether a normalised reply carries a normalised phrase, word-bounded. */
function carries(said: string, phrase: string): boolean {
  if (phrase.length === 0) return false;
  return ` ${said} `.includes(` ${phrase} `);
}
