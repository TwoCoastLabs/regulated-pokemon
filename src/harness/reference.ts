/**
 * The certified world, handed to the proposer as evidence to read.
 *
 * Grounding closes the one gap structure could not: a model that emits a
 * perfectly-formed answer can still *recall* a fact wrong — the Surf-learner
 * count, a base stat, the fastest of a set. The fix is not to trust the model
 * more but to stop asking it to remember: give it the certified facts and let
 * it compose from them, exactly as a compliant human advisor reads the
 * prospectus rather than reciting it.
 *
 * One line divides what this may contain, and it is load-bearing:
 *
 *   **Facts, never policy.** Everything here is from the certified *registry* —
 *   stats, types, rarity flags, learnsets, move data. Nothing here is from the
 *   Accord *pack*: not the badge thresholds, not the disclosure rules, not the
 *   restricted-species gate. So a grounded model still does not know that a
 *   two-badge trainer may not be recommended a legendary — it can read that
 *   Mewtwo *is* legendary, and recommend it anyway, and IA-5 still refuses it.
 *   Grounding the facts leaves every policy article exactly as enforceable, and
 *   leaves the safety test exactly as real.
 *
 * And nothing downstream trusts a grounded answer any more for having been
 * grounded: `compileManifest` recomputes every value against this same registry
 * regardless. A model handed the facts and told to lie anyway (the adversary)
 * is caught exactly as before. The reference makes honesty *easy*, not
 * mandatory — the gate is what makes it mandatory.
 *
 * Deterministic and pure: the same snapshot yields the same bytes, so a grounded
 * run replays like any other.
 */

import type { CertifiedRegistry } from "../kernel/registry.js";
import { STAT_NAMES } from "../kernel/snapshot-format.js";
import { STATUS_CONDITIONS } from "../kernel/registry.js";

/**
 * Which rows a reference block carries. `undefined` for either set means "all
 * of them" — the whole-registry grounding of {@link certifiedReference}. A set
 * narrows it to exactly those ids, which is how {@link retrieveReference} hands
 * the model only the facts a question needs.
 */
export interface ReferenceSelection {
  species?: ReadonlySet<string>;
  moves?: ReadonlySet<string>;
  items?: ReadonlySet<string>;
}

/**
 * Render the certified registry as a compact reference block.
 *
 * Three tables — species facts, move facts, and learnsets — because between them
 * they are every fact a corpus answer can cite: a stat or type or rarity, a
 * move's power, and which species learn a move (the evidence a count or a
 * roster rests on). Terse on purpose; it rides in front of every answer prompt.
 *
 * A {@link ReferenceSelection} narrows which rows appear; absent, the whole
 * registry is rendered (the original, and still the `--grounded` behaviour).
 * The same renderer serves both so a retrieved block reads identically to a
 * full one, only shorter.
 */
export function certifiedReference(registry: CertifiedRegistry, selection?: ReferenceSelection): string {
  const speciesRows =
    selection?.species === undefined ? registry.species : registry.species.filter((species) => selection.species!.has(species.id));
  const moveRows =
    selection?.moves === undefined ? registry.moveIds : registry.moveIds.filter((moveId) => selection.moves!.has(moveId));

  const lines = [
    `CERTIFIED REGISTRY — snapshot ${registry.snapshot.id}.`,
    "These facts are certified. Cite them; do not answer from memory. This block",
    "carries no League policy — the rules that gate an answer are the gate's, not yours.",
    "",
    `SPECIES  (id | dex | types | rarity | ${STAT_NAMES.join(" ")}):`,
  ];

  for (const species of speciesRows) {
    const rarity = species.isLegendary ? "legendary" : species.isMythical ? "mythical" : "-";
    const stats = STAT_NAMES.map((stat) => species.stats[stat]).join(" ");
    lines.push(`${species.id} | ${species.pokedexNumber} | ${species.types.join(",")} | ${rarity} | ${stats}`);
  }

  lines.push("", "MOVES  (id | type | power):");
  for (const moveId of moveRows) {
    const move = registry.findMove(moveId);
    if (move === undefined) continue;
    lines.push(`${moveId} | ${move.type} | ${move.power ?? "-"}`);
  }

  lines.push("", "LEARNSETS  (species: moves it can learn):");
  for (const species of speciesRows) {
    const moves = [...new Set(species.learnset.map((entry) => entry.move))].sort();
    lines.push(`${species.id}: ${moves.join(",")}`);
  }

  // The Center world's items, when the snapshot carries any (epic #94,
  // slice 3): the certified era facts beside the structured ones, so a
  // grounded model reads the closed effect set instead of recalling a blend
  // of eras. Facts only — which items are *controlled* is the pack's.
  const itemRows =
    selection?.items === undefined ? registry.items : registry.items.filter((item) => selection.items!.has(item.id));
  if (itemRows.length > 0) {
    lines.push("", "ITEMS  (id | category | cost | cures | restores-hp | effect):");
    for (const item of itemRows) {
      const cures = (item.certified.cures ?? []).join(",") || "-";
      const restores = item.certified.restoresHp === undefined ? "-" : String(item.certified.restoresHp);
      lines.push(`${item.id} | ${item.category} | ${item.cost} | ${cures} | ${restores} | ${item.shortEffect}`);
    }
  }

  return lines.join("\n");
}

/** How many species one question may pull into its reference. A generous cap on
 * a closed snapshot — a broad "all the Electric types" pulls a type's whole
 * membership, and nothing here approaches it — that bounds the prompt so
 * retrieval keeps grounding's usefulness without grounding's token bill. */
export const RETRIEVAL_SPECIES_CAP = 40;

/**
 * Retrieval-gated grounding (findings §16→§17): the reference for *this*
 * question, not the whole registry.
 *
 * The gap grounding closed came at a price — the whole registry in front of
 * every prompt is a ~13× token blowup that scales with the corpus and gives
 * back the cheapness a cheaper model was chosen for. The fix is ordinary
 * retrieval: fetch the rows the question actually needs. On a closed snapshot
 * the vocabulary *is* the index, so retrieval is deterministic lexical matching
 * over it — a species named, a type named (its whole membership, for a count or
 * a ranking), a move named (and the species that learn it, for "which learns
 * Surf") — which keeps the run replayable, unlike an embedding search.
 *
 * Like every deterministic front door this trades recall for cost (lesson 6): a
 * misspelled or unnamed entity retrieves nothing and the model falls back to
 * answering ungrounded — safe, because the gate still recomputes every value,
 * just not helped. The eval measures which questions retrieve empty; it is not
 * assumed to be none.
 */
export function retrieveReference(registry: CertifiedRegistry, question: string): string {
  return certifiedReference(registry, retrievalSelection(registry, question));
}

/**
 * The rows retrieval would pull for a question — the selection behind
 * {@link retrieveReference}, exposed so the activation instrument (epic #94,
 * slice 1) can ask *whether the front door engaged* without rendering a
 * reference. Same lexical rule, same cap, same order; the two cannot drift
 * because one is defined by the other.
 */
export function retrievalSelection(registry: CertifiedRegistry, question: string): Required<ReferenceSelection> {
  const haystack = ` ${question.toLowerCase()} `;
  // A canonical id is hyphenated ("fire-blast", "self-destruct"); a trainer
  // writes "Fire Blast" or "Selfdestruct". Each hyphen may be a space, a
  // hyphen, or nothing at all in the question — the same fold the decoder
  // applies to a model's spelling of a name (docs/recovery.md, channel 1),
  // applied here to the trainer's. Found by the activation instrument (epic
  // #94, slice 1): every canonical miss was a multi-word move.
  const names = (token: string): boolean =>
    new RegExp(`\\b${token.toLowerCase().split("-").map(escapeForRegExp).join("[\\s-]?")}\\b`).test(haystack);

  const species = new Set<string>();
  for (const id of registry.speciesIds) if (names(id)) species.add(id);

  // A type named pulls its whole membership — the evidence a count, a ranking or
  // a membership test over that type rests on.
  const typesNamed = [...registry.typeNames].filter((type) => names(type));
  if (typesNamed.length > 0) {
    for (const one of registry.species) if (one.types.some((type) => typesNamed.includes(type))) species.add(one.id);
  }

  const moves = new Set<string>();
  for (const moveId of registry.moveIds) if (names(moveId)) moves.add(moveId);
  // A move named pulls the species that can learn it, so "which Pokémon learns
  // Surf?" has its evidence and not just the move's own row.
  if (moves.size > 0) {
    for (const one of registry.species) if (one.learnset.some((entry) => moves.has(entry.move))) species.add(one.id);
  }

  // Cap in Pokédex order (registry.species is already ordered), so a run
  // replays and a pathological match cannot balloon the prompt.
  // Items named are pulled; a condition named pulls the items that treat it —
  // the evidence a treats verdict or a cures roster rests on.
  const items = new Set<string>();
  for (const id of registry.itemIds) if (names(id)) items.add(id);
  for (const condition of STATUS_CONDITIONS) {
    if (!names(condition)) continue;
    for (const item of registry.items) if ((item.certified.cures ?? []).includes(condition)) items.add(item.id);
  }

  const capped = new Set(registry.species.filter((one) => species.has(one.id)).slice(0, RETRIEVAL_SPECIES_CAP).map((one) => one.id));
  return { species: capped, moves, items };
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
