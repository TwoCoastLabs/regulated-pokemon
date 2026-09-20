/**
 * Canonical surface forms: reading the model's entity names correctly
 * (findings §20→§21; docs/recovery.md, channel 1).
 *
 * The residual IA-3 population after the grammar was gated turned out to be
 * mostly *not* fabrication: "Bulbasaur" for `bulbasaur`, "selfdestruct" for
 * `self-destruct`, a matchup naming "electric" in the species slot. The name is
 * right; the *surface form* is wrong — casing, separators, or the union
 * variant. Denying those as fabricated entities is the decoder failing to read
 * what the model plainly said (finding #3's family), so this module folds
 * names to their canonical certified form at decode time, before the kernel
 * ever rules.
 *
 * Three lines hold it to the doctrine:
 *
 *  - **Same name only, never a nearest neighbour.** The fold strips case and
 *    separators and must land on *exactly one* certified id — the fold over
 *    the certified vocabulary is checked injective, and a key two ids share is
 *    dropped so an ambiguous name maps nowhere. "brock", "elite-four", a dex
 *    number, an invented species: none of them fold to anything, and IA-3
 *    denies them exactly as before. Reference-system translation ("144" →
 *    articuno) is deliberately out: that is a guess about intent, and guesses
 *    belong to a human (channel 3), not a decoder.
 *  - **Content stays verbatim.** Only the *spelling of names* is read
 *    canonically; every asserted value survives untouched and faces the same
 *    verification. An adversary's wrong value about "Pikachu" now reads as a
 *    wrong value about `pikachu` — a fact-mismatch instead of a fabrication —
 *    and is denied either way. Nothing becomes committable that was not.
 *  - **Deterministic and pure.** Same registry, same claims, same output; a
 *    canonicalized run replays like any other.
 */

import type { Claim, RosterCriteria } from "../kernel/contracts.js";
import type { CertifiedRegistry } from "../kernel/registry.js";

/**
 * Case and separators gone: the name reduced to what it names.
 *
 * Deliberately locale-independent and ASCII-scoped. `toLowerCase()` — never
 * `toLocaleLowerCase()` — applies Unicode's default case mappings, so the fold
 * is identical on every host locale and a canonicalized run replays anywhere.
 * And `[a-z0-9]` is not "English": it is the certified vocabulary's own
 * alphabet (ASCII slugs). A spelling from outside it ("Pikáchu", a kana name)
 * loses those letters in the fold, lands on no certified key, and fails closed
 * to IA-3 like any unknown — a miss, never a nearest-neighbour guess. If the
 * certified world ever localizes, this fold widens with the vocabulary
 * (Unicode normalization plus case folding); the injectivity check below is
 * what holds the same-name-only doctrine, and it carries over unchanged.
 */
function fold(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * The folded-form index over the certified vocabulary, ambiguous keys dropped.
 * Built per call — ~300 ids — so the module holds no state and tracks the
 * registry it is handed, not the one it first saw.
 */
function canonicalIndex(registry: CertifiedRegistry): ReadonlyMap<string, string> {
  const index = new Map<string, string>();
  const ambiguous = new Set<string>();
  // Items joined the fold when the Center world did (epic #94, slice 3):
  // "Antidote" is `antidote` and "Super Potion" is `super-potion`, the same
  // name in a different surface form — and the same injectivity rule guards
  // a key two universes would share.
  for (const id of [...registry.speciesIds, ...registry.moveIds, ...registry.itemIds]) {
    const key = fold(id);
    if (index.has(key) && index.get(key) !== id) ambiguous.add(key);
    index.set(key, id);
  }
  for (const key of ambiguous) index.delete(key);
  return index;
}

/** The certified id this name is a surface form of, or the name unchanged —
 * an unchanged unknown falls through to the kernel's IA-3, as it must. */
function canonicalEntity(registry: CertifiedRegistry, index: ReadonlyMap<string, string>, entityId: string): string {
  if (registry.knowsEntity(entityId)) return entityId;
  return index.get(fold(entityId)) ?? entityId;
}

/**
 * Read every entity name in a draft's claims in its canonical form.
 *
 * Also re-slots the one unambiguous union mix-up the runs actually produced: a
 * matchup subject declared as a *species* whose name is a certified *type* (and
 * not any certified entity) is read as the type subject. Type names and entity
 * ids are disjoint in the certified world, so this is the same name in the
 * right variant, not a guess.
 */
/**
 * Read a roster's criteria with their move ids in canonical form — the same
 * fold as the claims', for the same reason: "Selfdestruct" is
 * `self-destruct`, and a set defined by a surface form is the certified set
 * spelled the trainer's way, not a different set (bank, 2026-09-20: the
 * follow-up "which of them is the fastest?" rebuilt a learns-move roster
 * under the surface form and was refused under IA-3/unknown-move on both
 * models). A name that folds to no certified move passes through unchanged
 * and earns its IA-3 exactly as before; every other criterion is untouched.
 */
export function canonicalizeCriteria(registry: CertifiedRegistry, criteria: RosterCriteria): RosterCriteria {
  const index = canonicalIndex(registry);
  return {
    all: criteria.all.map((criterion) => (criterion.kind === "learns-move" ? { ...criterion, move: canonicalEntity(registry, index, criterion.move) } : criterion)),
  };
}

export function canonicalizeClaims(registry: CertifiedRegistry, claims: readonly Claim[]): readonly Claim[] {
  const index = canonicalIndex(registry);
  const entity = (entityId: string): string => canonicalEntity(registry, index, entityId);

  return claims.map((claim): Claim => {
    switch (claim.kind) {
      case "fact":
        return { ...claim, entityId: entity(claim.entityId) };
      case "membership":
        return { ...claim, entityId: entity(claim.entityId) };
      case "eligibility":
        return { ...claim, entityId: entity(claim.entityId) };
      case "recommendation":
        return { ...claim, entityId: entity(claim.entityId) };
      case "action":
        return { ...claim, entityId: entity(claim.entityId) };
      case "treats":
        // "Antidote" is `antidote`; the condition vocabulary is already
        // canonical and folds nowhere.
        return { ...claim, itemId: entity(claim.itemId) };
      case "comparison":
        return { ...claim, leftId: entity(claim.leftId), rightId: entity(claim.rightId) };
      case "matchup": {
        if (claim.subject.kind === "species") {
          const named = entity(claim.subject.entityId);
          if (named !== claim.subject.entityId || registry.knowsEntity(named)) {
            return { ...claim, subject: { kind: "species", entityId: named } };
          }
          // Not an entity under any surface form — but exactly a type's name in
          // the wrong slot is still the same name, so it re-slots.
          const asType = claim.subject.entityId.toLowerCase();
          if (registry.typeNames.has(asType)) {
            return { ...claim, subject: { kind: "type", typeId: asType } };
          }
          return claim;
        }
        // A type subject in the wrong case is the same type.
        const asType = claim.subject.typeId.toLowerCase();
        if (asType !== claim.subject.typeId && registry.typeNames.has(asType)) {
          return { ...claim, subject: { kind: "type", typeId: asType } };
        }
        return claim;
      }
      default:
        return claim;
    }
  });
}
