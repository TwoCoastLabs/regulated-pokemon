/**
 * The crucible, assembled: every phase's mutations and controls in one place,
 * plus an explicit list of the articles nothing denies yet.
 *
 * This file is the coverage gate that matters. Line coverage can sit at 100%
 * while an Accord article has no mutation denying it by name, so the epic's
 * acceptance criterion — every article denied by name in at least one
 * mutation — is asserted here rather than inferred from a percentage.
 *
 * Two lists, and between them there is no third state. An article is either
 * covered by a mutation or written into {@link NOT_YET_COVERED} against the
 * phase that will cover it. Shrinking that list is how a phase is finished: a
 * phase cannot be ticked in the epic while an article it owns is still in it.
 */

import type { ArticleId } from "../kernel/accord.js";
import type { Control, Mutation } from "./harness.js";
import { PHASE_1_ARTICLES, PHASE_1_CONTROLS, PHASE_1_MUTATIONS } from "./phase1.js";
import { PHASE_2_ARTICLES, PHASE_2_CONTROLS, PHASE_2_MUTATIONS } from "./phase2.js";
import { PHASE_3_ARTICLES, PHASE_3_CONTROLS, PHASE_3_MUTATIONS } from "./phase3.js";

export interface CruciblePhase {
  /** Epic phase number, matching docs and the issue tracker. */
  phase: number;
  title: string;
  /**
   * The articles this phase claims. Pinned in both directions: the mutations
   * must cover exactly these, no more and no fewer, so a checkbox cannot
   * drift ahead of the crucible and a mutation cannot be added under an
   * article the phase never claimed.
   */
  articles: readonly ArticleId[];
  mutations: readonly Mutation[];
  controls: readonly Control[];
}

export const CRUCIBLE_PHASES: readonly CruciblePhase[] = [
  {
    phase: 1,
    title: "Certified registry",
    articles: PHASE_1_ARTICLES,
    mutations: PHASE_1_MUTATIONS,
    controls: PHASE_1_CONTROLS,
  },
  {
    phase: 2,
    title: "Answer compilation and manifest verification",
    articles: PHASE_2_ARTICLES,
    mutations: PHASE_2_MUTATIONS,
    controls: PHASE_2_CONTROLS,
  },
  {
    phase: 3,
    title: "Scope resolution and the propose/confirm ladder",
    articles: PHASE_3_ARTICLES,
    mutations: PHASE_3_MUTATIONS,
    controls: PHASE_3_CONTROLS,
  },
];

/**
 * Articles no mutation denies yet, each against the phase that will cover it.
 *
 * This is an admission, not a suppression: it is written down so that "not
 * covered" and "covered" are the only two states an article can be in, and so
 * that the gap is visible in review rather than absent from the test output.
 */
export const NOT_YET_COVERED: Partial<Record<ArticleId, number>> = {
  "IA-7": 5, // read-to-act continuity
  "IA-9": 5, // irreversible acts need informed consent
  "IA-10": 6, // replay
};

/** Every mutation the crucible knows about, across all landed phases. */
export const ALL_MUTATIONS: readonly Mutation[] = CRUCIBLE_PHASES.flatMap((entry) => entry.mutations);

/** Every control, across all landed phases. */
export const ALL_CONTROLS: readonly Control[] = CRUCIBLE_PHASES.flatMap((entry) => entry.controls);

/** Articles denied by name by at least one mutation. */
export function coveredArticles(): ReadonlySet<ArticleId> {
  return new Set(ALL_MUTATIONS.map((mutation) => mutation.article));
}
