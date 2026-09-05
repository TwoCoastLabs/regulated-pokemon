/**
 * Schema linking, the driver's half (docs/routing.md, R3b).
 *
 * The model links each phrase of the ask to a field of the data dictionary,
 * or to none. Nothing here trusts that link; everything here reads it as
 * *structure* and holds the rest of the reply to it:
 *
 *  - **Claims stay inside the ask** ({@link linkClaims}). A field-bearing
 *    claim whose field the model did not link is a true fact nobody asked
 *    for — the substitution R2's bank leg found — and is dropped, counted.
 *  - **Aliases cross-check the link** ({@link aliasContradiction}). The one
 *    place the dictionary's words touch the driver: a phrase carrying an
 *    alias of a different field than the one linked, and no alias of the
 *    linked one, is a contradiction the trainer is asked about. An alias can
 *    make the system ask; it can never make it answer.
 *
 * None of this contains a domain word. The dictionary is the pack's; the
 * subjects come from the registry; the checks are the same for a Pokédex and
 * a drug label.
 */

import type { AskedField } from "../harness/decode.js";
import type { Claim } from "../kernel/contracts.js";
import type { AccordPack, DictionaryEntry, DictionarySubject } from "../kernel/pack.js";
import type { CertifiedRegistry } from "../kernel/registry.js";

/** The certified field a claim is about, when it is about one. Set
 * operations, lessons, rules and acts carry no field and answer to their own
 * guards. */
export function fieldOfClaim(claim: Claim): string | undefined {
  switch (claim.kind) {
    case "fact":
    case "comparison":
      return claim.factId;
    case "ranking":
      return claim.basis;
    case "matchup":
      return "type-chart";
    default:
      return undefined;
  }
}

export interface Linked {
  claims: readonly Claim[];
  /** Field-bearing claims dropped for being off the ask. */
  dropped: number;
}

/**
 * R1 — claims stay inside the ask. With a mapping present, every
 * field-bearing claim must be about a field the model linked; the rest are
 * dropped. An empty mapping (a reply that linked nothing, a scripted model)
 * holds nothing to anything, and the claims stand as they would have.
 */
export function linkClaims(asked: readonly AskedField[], claims: readonly Claim[]): Linked {
  if (asked.length === 0) return { claims, dropped: 0 };
  const linked = new Set(asked.flatMap((entry) => (entry.fieldId === null ? [] : [entry.fieldId])));
  const kept = claims.filter((claim) => {
    const field = fieldOfClaim(claim);
    return field === undefined || linked.has(field);
  });
  return { claims: kept, dropped: claims.length - kept.length };
}

export interface Contradiction {
  phrase: string;
  /** The field the model linked the phrase to; absent when it linked none. */
  linked?: DictionaryEntry;
  /** The fields whose aliases the phrase carries instead. */
  suggested: readonly DictionaryEntry[];
}

/**
 * R3 — the dictionary's aliases cross-check the link. For each phrase, the
 * fields (of the subject the ask names) whose aliases the phrase carries are
 * its lexical evidence. Evidence for the linked field settles it; evidence
 * only for *other* fields — or evidence for a field where the model linked
 * none — is a contradiction. First one found is returned; the driver asks.
 */
export function aliasContradiction(
  pack: AccordPack,
  registry: CertifiedRegistry,
  asked: readonly AskedField[],
): Contradiction | undefined {
  for (const entry of asked) {
    const linked = entry.fieldId === null ? undefined : pack.dictionary.find((field) => field.id === entry.fieldId);
    const subjects = subjectsOf(registry, entry.entityId);
    const evidence = pack.dictionary.filter(
      (field) => subjects.has(field.subject) && field.aliases.some((alias) => carries(entry.phrase, alias)),
    );
    if (evidence.length === 0) continue;
    if (linked !== undefined && evidence.some((field) => field.id === linked.id)) continue;
    return { phrase: entry.phrase, ...(linked === undefined ? {} : { linked }), suggested: evidence };
  }
  return undefined;
}

/** The subjects an entity id can be a field of, read from the registry: a
 * species has species fields and the type chart; a type name the chart
 * alone; an id the registry does not certify could be anything. */
function subjectsOf(registry: CertifiedRegistry, entityId: string): ReadonlySet<DictionarySubject> {
  const id = entityId.toLowerCase().trim();
  if (registry.speciesIds.includes(id)) return new Set(["species", "type"]);
  if (registry.moveIds.includes(id)) return new Set(["move"]);
  if (registry.itemIds.includes(id)) return new Set(["item"]);
  if (registry.typeNames.has(id)) return new Set(["type"]);
  return new Set(["species", "move", "item", "type"]);
}

/** Whether a phrase carries an alias, word-bounded on letters and digits. */
function carries(phrase: string, alias: string): boolean {
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(phrase.toLowerCase());
}
