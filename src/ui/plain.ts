/**
 * The player's register: every formal thing the kernel says, sayable to a
 * trainer without the vocabulary.
 *
 * The live page speaks to a player first; the compliance console keeps the
 * article codes, digests and kernel messages one toggle away. This module is
 * the join between the two — each violation keeps its formal identity (via
 * {@link violationView}: code, article title, real-world analog) and gains a
 * `plain` sentence a visitor can act on.
 *
 * Copy lives here, in a pure coverage-counted projection, and not in the
 * component: phrasing that explains a denial is part of what the page claims,
 * so it is tested like everything else the page claims. The phrases translate
 * and never soften — a denial reads as the League stepping in, because that is
 * what happened.
 */

import type { ScopeCandidate, ScopeDimension, Violation } from "../kernel/contracts.js";
import type { TransactionStage } from "../kernel/transaction.js";
import { type ViolationView, violationView } from "./viewmodel.js";

export interface PlainViolation extends ViolationView {
  /** The player's sentence: what went wrong, no vocabulary required. */
  plain: string;
}

/**
 * Player phrasing for the rules a live conversation can actually provoke —
 * a model inventing, misremembering, overreaching, or a page going stale.
 * Pack-loader and snapshot-loader rules are deliberately absent: a session
 * against the bundled world cannot reach them, and the per-article fallback
 * covers surprises without claiming more than it knows.
 */
const BY_RULE: Readonly<Record<string, string>> = {
  "fact-mismatch": "The Advisor stated a value that the official records contradict.",
  "uncertified-fact": "The Advisor cited a measurement the official records don't keep.",
  "fabricated-entity": "The Advisor named a Pokémon that doesn't exist in the official records.",
  "unknown-move": "The Advisor named a move the official records don't know.",
  "unknown-type": "The Advisor named a type the official records don't know.",
  "ambiguous-entity": "The Advisor named something the official records can't pin to one Pokémon.",
  "count-mismatch": "The Advisor's count doesn't match what the official records add up to.",
  "cardinality-mismatch": "The Advisor's count doesn't match what the official records add up to.",
  "membership-mismatch": "The Advisor put a Pokémon in a group the official records say it isn't in.",
  "ranking-mismatch": "The Advisor crowned the wrong winner — the official records rank it differently.",
  "ranking-outside-roster": "The Advisor crowned a winner that isn't even in the group being ranked.",
  "ranking-tie": "There is no single winner — it's a tie, and the League doesn't break ties by guessing.",
  "ranking-over-empty-roster": "The Advisor tried to rank a group with nothing in it.",
  "ranking-basis-not-ordered": "The Advisor tried to rank by something that isn't a measurable quantity.",
  "restricted-species": "That Pokémon is restricted — your badge count isn't high enough for it to be recommended to you.",
  "unknown-action": "The Advisor claimed it could do something no approved tool actually does.",
  "unattributed-content": "The page carried words nobody certified, so it was never shown.",
  "scope-contradicted": "You've said two different things about your game, and the League won't pick one for you.",
  "scope-expired-at-action": "Too much time passed — your confirmed details expired before the act could run.",
  "confirmation-digest-mismatch": "The page changed after you read it, so your confirmation no longer counts.",
  "action-never-shown": "The act was never shown to you on the page, so it could not be confirmed.",
  "action-not-visible": "The act wasn't visible on the page you confirmed, so it doesn't count as agreed.",
  "action-unconfirmed": "You never confirmed this act, so it did not run.",
};

/** When the rule has no phrase of its own, the article still has a plain
 * meaning — less specific, still true. */
const BY_ARTICLE: Readonly<Record<string, string>> = {
  "IA-1": "The League couldn't tie this to what you actually asked for.",
  "IA-2": "A stated value doesn't match the official records.",
  "IA-3": "Something named here doesn't exist in the official records.",
  "IA-4": "A group, count or ranking doesn't hold up against the official records.",
  "IA-5": "League policy doesn't allow this for a trainer with your badges.",
  "IA-6": "The page didn't show exactly what the certified answer says, so it was never shown to you.",
  "IA-7": "This wasn't confirmed by you on a page you actually saw, so nothing ran.",
  "IA-8": "Only your own words count here, and this didn't come from you.",
  "IA-9": "An irreversible act was missing the warning it owes you.",
  "IA-10": "This record can't be reproduced, so the League won't stand behind it.",
};

const FALLBACK = "The Advisor's answer didn't survive the League's checks.";

export function plainViolation(violation: Violation): PlainViolation {
  const view = violationView(violation);
  return {
    ...view,
    plain: BY_RULE[violation.rule] ?? BY_ARTICLE[violation.article] ?? FALLBACK,
  };
}

/** Where the League stepped in, as a phrase that finishes "The League stepped
 * in …". Stage names are console vocabulary; this is what they mean. */
export function plainStage(stage: TransactionStage): string {
  switch (stage) {
    case "scope":
      return "before your question was even settled";
    case "answer":
      return "before the answer could reach you";
    case "render":
      return "on the page itself";
    case "action":
      return "at the moment of action";
  }
}

function titleCase(value: string): string {
  return value
    .split("-")
    .map((word) => (word.length === 0 ? word : word[0]!.toUpperCase() + word.slice(1)))
    .join(" ");
}

/**
 * One pinned dimension in the trainer's own terms. "comparisonBasis =
 * base-speed" is the console's line; "comparing by Base Speed" is the
 * player's. The value is prettified, never translated — it is still exactly
 * the approved vocabulary value, worn casually.
 */
export function plainBinding(dimension: ScopeDimension, value: string | number): string {
  switch (dimension) {
    case "version":
      return `the ${String(value).split("-").map(titleCase).join(" & ")} version`;
    case "region":
      return `the ${titleCase(String(value))} region`;
    case "badgeLevel":
      return `${String(value)} badge${value === 1 ? "" : "s"}`;
    case "comparisonBasis":
      return `comparing by ${titleCase(String(value))}`;
    default:
      return `${dimension as string} = ${String(value)}`;
  }
}

/** A whole proposed interpretation, as one player-readable phrase. */
export function plainCandidate(candidate: ScopeCandidate): string {
  return (Object.entries(candidate) as [ScopeDimension, string | number][])
    .map(([dimension, value]) => plainBinding(dimension, value))
    .join(", and ");
}
