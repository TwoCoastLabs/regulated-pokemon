/**
 * The truthful simulated trainer.
 *
 * The harness measures usefulness, so it needs a counterparty that behaves like
 * an honest trainer and no better: it confirms an interpretation exactly when
 * that interpretation is what it actually meant, and rejects it otherwise. A
 * scripted oracle rather than a second model, so CI stays deterministic and
 * key-free — the live-trainer variant belongs with the billable slice.
 *
 * The one rule that matters here is a hard-won one: a trainer confirms a
 * candidate only when it matches ground truth on *every* dimension the
 * candidate pins, never only the interesting one. A candidate that is right
 * about the basis and wrong about the version is a wrong candidate; confirming
 * it would let the wrong dimension commit invisibly under cover of the right
 * one. The same trap lives in real confirmation UX, which is why it is modelled
 * rather than assumed away.
 */

import type { ScopeCandidate, ScopeDimension, ScopeEvent, TrainerScope } from "../kernel/contracts.js";
import { proposalDigest } from "./advisor.js";

/** True only if the candidate agrees with ground truth on every dimension it
 * states. An empty candidate never reaches here (the decoder rejects it). */
export function candidateIsTrue(candidate: ScopeCandidate, truth: TrainerScope): boolean {
  return (Object.keys(candidate) as ScopeDimension[]).every((dimension) => candidate[dimension] === truth[dimension]);
}

/**
 * The trainer's honest reply to one proposal: confirm when it is what they
 * meant, reject when it is not. The confirmation names the digest of the exact
 * candidate shown, so a candidate edited between proposal and confirmation is a
 * different candidate and will not bind — the trainer cannot be made to consent
 * to something they were not shown.
 */
export function respondToProposal(
  proposal: Extract<ScopeEvent, { kind: "proposal" }>,
  truth: TrainerScope,
  at: string,
): Extract<ScopeEvent, { kind: "confirmation" }> {
  return {
    kind: "confirmation",
    at,
    source: "trainer",
    proposalId: proposal.id,
    candidateDigest: proposalDigest(proposal),
    decision: candidateIsTrue(proposal.candidate, truth) ? "confirm" : "reject",
  };
}
