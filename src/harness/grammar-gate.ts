/**
 * Retrieval-gated grammar (findings §18→§19): narrowing the answer grammar to
 * the claim kinds a question actually wants.
 *
 * The grown smoke set (§18) found one dominant, cross-model gap — **shape
 * deflection**: a ranking answered with a `count`, a matchup with a `typeCount`,
 * a membership or a fact with a `gameRule`. The same entries deflected on a 235B
 * model and a 12B one, so the fault is not capability, it is claim-kind
 * *routing*, and the three "aggregate/constant" kinds — `count`, `typeCount`,
 * `gameRule` — are the sinks, because each reads a set's cardinality or a fixed
 * pack constant and so is the easiest claim to emit as filler.
 *
 * §9's answer is to gate the grammar: the retrieval step already nominates the
 * *rows* a question needs; here the same lexical step nominates the *filler
 * kinds* it needs, and the schema (schema.ts) offers those three only when
 * nominated. A ranking question then cannot emit a `count`, because the grammar
 * does not admit one — the deflection is made unrepresentable rather than merely
 * scored.
 *
 * Two lines are load-bearing:
 *
 *  - **Only the three filler kinds are ever gated.** `fact`, `membership`,
 *    `ranking`, `matchup`, `eligibility`, `explanation`, `recommendation` and
 *    `action` are always offered, so a question can always be answered in an
 *    entity/relation shape — and, crucially, the gated advice (`recommendation`,
 *    `action`, `eligibility`) stays representable, so the safety test is never
 *    made vacuous (schema.ts's rule, finding #7). Gating the filler kinds can
 *    only cost usefulness, never soften a refusal.
 *  - **It is a deterministic front door and trades recall for specificity
 *    (lesson 6).** A count or rule question whose wording no cue matched
 *    nominates nothing, the kind is withheld, and the model falls back to
 *    another shape or abstains — safe, because the manifest gate still
 *    recomputes every value; just unhelped. The eval measures which questions
 *    that costs, rather than assuming none.
 */

/** The three claim kinds the grammar gates — the deflection sinks §18 named. */
export type FillerKind = "count" | "typeCount" | "gameRule";

/** A cardinality ask — "how many", "number of", "count". */
const COUNT_CUE = /\b(how many|number of|count(?:ing|ed)?)\b/i;

/**
 * The nouns the pack's game-rule table is about (party-size, moves-per-pokemon,
 * badge-count, starter-count, pc-box-count, pc-box-capacity), with the everyday
 * synonyms a trainer uses ("attacks" for moves, "team" for party). Kept here
 * beside the cue rather than derived from the labels, and pinned to the pack's
 * rule set by {@link grammar-gate.test}, so a new rule updates both together.
 */
const RULE_NOUN = /\b(party|team|moves?|attacks?|badges?|starters?|box(?:es)?|pc|storage|slots?|items?|bag|stack)\b/i;

/** Wording that asks for a rule's *limit* even without a count cue — "max team
 * size", "how many moves at once", "can I carry". */
const RULE_LIMIT_CUE = /\b(max(?:imum)?|size|limit|at once|hold|carry|can i (?:have|carry|know|bring))\b/i;

/**
 * The filler kinds a question nominates — the shortlist schema.ts narrows to.
 *
 * `count` on any cardinality cue; `typeCount` when that cue is about *types*;
 * `gameRule` when a rule noun meets a count or limit cue. A question that
 * nominates none (a ranking, a matchup, a plain fact) is offered none of the
 * three, which is exactly the deflection block.
 */
export function nominateFillerKinds(question: string): ReadonlySet<FillerKind> {
  const nominated = new Set<FillerKind>();
  const countCue = COUNT_CUE.test(question);
  if (countCue) nominated.add("count");
  if (countCue && /\btypes?\b/i.test(question)) nominated.add("typeCount");
  // A rule noun with either cue — or both cues with no recognizable noun at
  // all ("is there a max on how many potions I can hold": the noun is an
  // item, which no closed noun list can enumerate; the count+limit pairing is
  // the rule-ness). Loop 2: the bag-rule questions died ungated on this.
  if (
    (RULE_NOUN.test(question) && (countCue || RULE_LIMIT_CUE.test(question))) ||
    (countCue && RULE_LIMIT_CUE.test(question))
  ) {
    nominated.add("gameRule");
  }
  return nominated;
}
