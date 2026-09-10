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
import type { Claim, ClosedRoster, RosterCriterion } from "../kernel/contracts.js";
import { type AccordPack, type DictionaryEntry, type DictionarySubject, NO_FIELD } from "../kernel/pack.js";
import type { CertifiedRegistry } from "../kernel/registry.js";

/** The field a roster criterion selects on — a set defined by type is about
 * the `types` field, by learnable move about `learnset`, and so on. The
 * criterion kinds are the kernel's own closed vocabulary, not the domain's
 * words. */
function fieldsOfCriterion(criterion: RosterCriterion): readonly string[] {
  switch (criterion.kind) {
    case "has-type":
      return ["types"];
    case "learns-move":
      return ["learnset"];
    case "rarity":
      return ["is-legendary", "is-mythical"];
    case "stat-at-least":
    case "stat-at-most":
      return [`base-${criterion.stat}`];
    case "item-category":
      return ["item-category"];
    case "treats-condition":
      return ["cures"];
    case "cost-at-most":
    case "cost-at-least":
      return ["cost"];
    default:
      return [];
  }
}

/**
 * The certified fields a claim is about. A fact, comparison or ranking
 * names its field; a matchup is the type chart; a set claim (membership,
 * count, and a ranking's set) is about whatever its roster selects on —
 * found live on the first R3b run: "what beats water types?" came back as
 * the water roster listed and counted, which no field-bearing check could
 * see. Lessons, rules, acts and the whole-catalogue set carry no field and
 * answer to their own guards.
 */
export function fieldsOfClaim(claim: Claim, rosters: readonly ClosedRoster[] = []): readonly string[] {
  const roster = (id: string): readonly string[] =>
    (rosters.find((entry) => entry.id === id)?.criteria.all ?? []).flatMap(fieldsOfCriterion);
  switch (claim.kind) {
    case "fact":
    case "comparison":
      return [claim.factId];
    case "ranking":
      return [claim.basis, ...roster(claim.rosterId)];
    case "matchup":
      return ["type-chart"];
    case "membership":
    case "count":
      return roster(claim.rosterId);
    default:
      return [];
  }
}

/** The one field a fact, comparison, ranking or matchup names, for callers
 * that read a claim alone. */
export function fieldOfClaim(claim: Claim): string | undefined {
  return fieldsOfClaim(claim)[0];
}

export interface Linked {
  claims: readonly Claim[];
  /** Field-bearing claims dropped for being off the ask. */
  dropped: number;
}

/**
 * R1 — claims stay inside the ask. With a mapping present, every
 * field-bearing claim must be about a field the model linked (any of its
 * fields, for a set claim on a compound roster); the rest are dropped. An
 * empty mapping (a reply that linked nothing, a scripted model) holds
 * nothing to anything, and the claims stand as they would have.
 */
export function linkClaims(asked: readonly AskedField[], claims: readonly Claim[], rosters: readonly ClosedRoster[] = []): Linked {
  // A claim about the reserved no-subject is the model saying it found no
  // subject — dropped whatever the mapping says, and before the empty-mapping
  // return below: found live (dogfood, 2026-09-06), a stale-dropped mapping
  // left an action on the entity "none" standing, and it went to the kernel.
  const withSubject = claims.filter((claim) => !("entityId" in claim && claim.entityId.toLowerCase().trim() === NO_FIELD));
  if (asked.length === 0) return { claims: withSubject, dropped: claims.length - withSubject.length };
  const linked = new Set(asked.flatMap((entry) => (entry.fieldId === null ? [] : [entry.fieldId])));
  const kept = withSubject.filter((claim) => {
    const fields = fieldsOfClaim(claim, rosters);
    if (fields.length === 0) return true;
    if (fields.some((field) => linked.has(field))) return true;
    // A set claim is about what its roster selects on, but the ask itself
    // may have been the set operation — "how many electric ones?" links
    // "how many" to none, honestly, because no column counts. Found by the
    // first R3b bank leg: every count and listing over a typed roster fell
    // here. So a set claim is off the ask only when the model linked some
    // field and none of the roster's; a mapping that links nothing at all
    // holds a set claim to nothing. A fact, comparison or ranking basis is
    // held either way — that is the substitution class.
    const setClaim = claim.kind === "membership" || claim.kind === "count";
    return setClaim && linked.size === 0;
  });
  // The constants — a rule of the game, the size of the type chart — are
  // about no subject at all. Found live (dogfood, 2026-09-05): "which
  // pokemon is the fastest?" linked Speed correctly and then certified a
  // type count and eight game rules. With a field linked, the ask was about
  // that field, and a constant beside it is the dump it looks like.
  const withoutConstants = linked.size === 0 ? kept : kept.filter((claim) => claim.kind !== "gameRule" && claim.kind !== "typeCount");
  // (The reserved no-subject — "tell me about this", dogfood 2026-09-05,
  // a fact about the entity "none" refused twice by the kernel — is dropped
  // at the top of this function, before any mapping is read.)
  return { claims: withoutConstants, dropped: claims.length - withoutConstants.length };
}

export interface Fresh {
  asked: readonly AskedField[];
  /** Links whose words came only from earlier exchanges. */
  stale: number;
}

/**
 * The links that are about *this* ask. The answer step is shown earlier
 * exchanges as context for an anaphoric ask, and a model reads them as asks
 * too — found live on the first R3b run: "what's a gym badge?" came back
 * with the previous two questions linked and answered again. A link whose
 * content words all appear in the earlier words and none in the current
 * ones is stale and dropped; a paraphrase the current words do not contain
 * verbatim is kept, since nothing here can tell a paraphrase from a
 * fabrication and the alias check still reads it.
 */
export function freshLinks(asked: readonly AskedField[], currentWords: string, earlierWords: string): Fresh {
  const current = ` ${normalise(currentWords)} `;
  const earlier = ` ${normalise(earlierWords)} `;
  const fresh = asked.filter((entry) => {
    const tokens = normalise(entry.phrase)
      .split(" ")
      .filter((token) => token.length >= 3 && !FUNCTION_WORDS.has(token));
    if (tokens.length === 0) return true;
    const inCurrent = tokens.some((token) => current.includes(` ${token} `));
    const inEarlier = tokens.every((token) => earlier.includes(` ${token} `));
    return inCurrent || !inEarlier;
  });
  return { asked: fresh, stale: asked.length - fresh.length };
}

/** Words of asking and connective tissue, which every ask shares and which
 * therefore prove nothing about *which* ask a phrase belongs to. English
 * function words only — never a domain word (the gate holds this file). */
const FUNCTION_WORDS: ReadonlySet<string> = new Set([
  "what", "whats", "which", "who", "whom", "whose", "how", "hows", "when", "where", "why",
  "does", "did", "done", "are", "was", "were", "been", "have", "has", "had", "can", "could",
  "will", "would", "shall", "should", "may", "might", "must", "the", "and", "but", "for",
  "with", "about", "into", "from", "that", "this", "these", "those", "there", "here", "you",
  "your", "they", "them", "their", "she", "her", "him", "his", "its", "tell", "say", "know",
  "mean", "please", "just", "want", "like", "some", "any", "many", "much", "get", "got",
  "one", "ones", "thing", "things",
]);

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
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
    // Aliases are written with "it" standing for the subject ("what level
    // does it evolve"); a phrase naming the subject in that position ("At
    // what level does Charmander evolve?") is read both as said and with the
    // subject's name replaced by "it", so the alias evidence for the linked
    // field is not lost to the name sitting in the middle of it. Found live
    // (2026-09-11): the evidence for the model's correct link was missed
    // that way, and a bare "evolve" alone made the check ask.
    const readings = phraseReadings(entry.phrase, entry.entityId);
    const evidence = pack.dictionary.filter(
      (field) => subjects.has(field.subject) && field.aliases.some((alias) => readings.some((reading) => carries(reading, alias))),
    );
    if (evidence.length === 0) continue;
    if (linked !== undefined && evidence.some((field) => field.id === linked.id)) continue;
    // A phrase linked to none whose every alias names a field *another*
    // entry of the same mapping already linked is not a missed field — the
    // model split the ask into the field and the thing it could not place
    // ("what's the speed of the fast one?": "the speed" → Speed, "the fast
    // one" → none, found live 2026-09-05). The subject is what is missing
    // there, and a question offering Speed as the one option answers
    // nothing. Left to the null-link reading, which knows what to do.
    const linkedElsewhere = new Set(asked.filter((other) => other !== entry).flatMap((other) => (other.fieldId === null ? [] : [other.fieldId])));
    if (linked === undefined && evidence.every((field) => linkedElsewhere.has(field.id))) continue;
    return { phrase: entry.phrase, ...(linked === undefined ? {} : { linked }), suggested: evidence };
  }
  return undefined;
}

/** The subjects an entity id can be a field of, read from the registry: a
 * species has species fields and the type chart; a type name the chart
 * alone. An id the registry does not certify — the reserved none, a lesson
 * id, a name it never heard — is a field of nothing, so no alias is
 * evidence against its link. Found by the R3b step 5 leg (2026-09-06):
 * "What is evolution?" came back as the what-is-evolution lesson with a
 * null link and no subject, and the word "evolution" made the check ask
 * "did you mean Evolves into?" — a question with no subject to answer it
 * about, where the lesson was the answer. (Earlier this fell back to every
 * subject, on the thought that an uncertified id could be anything; a
 * field question with nothing to be about certifies nothing either way.) */
function subjectsOf(registry: CertifiedRegistry, entityId: string): ReadonlySet<DictionarySubject> {
  const id = entityId.toLowerCase().trim();
  if (registry.speciesIds.includes(id)) return new Set(["species", "type"]);
  if (registry.moveIds.includes(id)) return new Set(["move"]);
  if (registry.itemIds.includes(id)) return new Set(["item"]);
  if (registry.typeNames.has(id)) return new Set(["type"]);
  return new Set();
}

/** The phrase as said, and — when it names its subject — with the subject's
 * id (hyphens as spaces, any case) replaced by "it". Ids only: a certified
 * entity has no display name apart from its slug. */
function phraseReadings(phrase: string, entityId: string): readonly string[] {
  const words = entityId.toLowerCase().trim().replace(/-/g, " ");
  if (words.length === 0 || words === NO_FIELD) return [phrase];
  const escaped = words.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "[\\s-]+");
  const pattern = new RegExp(`(^|[^a-z0-9])${escaped}(?:'s)?([^a-z0-9]|$)`, "i");
  const substituted = phrase.replace(pattern, (_match, before: string, after: string) => `${before}it${after}`);
  return substituted === phrase ? [phrase] : [phrase, substituted];
}

/** Whether a phrase carries an alias, word-bounded on letters and digits. */
function carries(phrase: string, alias: string): boolean {
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(phrase.toLowerCase());
}
