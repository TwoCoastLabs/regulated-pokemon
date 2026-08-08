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

import type { ConfirmationEvent, ScopeCandidate, ScopeDimension, ScopeEvent, TrainerScope } from "../kernel/contracts.js";
import { type DomElement, walkArtifact } from "../kernel/dom.js";
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

/** The act a trainer walked into the exchange wanting done, when they did. */
export interface TrainerAsk {
  tool: string;
  entityId: string;
}

/**
 * The trainer's honest reply to a rendered page proposing an act: confirm when
 * the page proposes exactly what they asked for, decline otherwise.
 *
 * Three disciplines, each a hard-won lesson made behaviour:
 *
 * 1. **They read the page, not the paperwork.** Everything checked here comes
 *    from their own walk of the artifact — the acts it visibly proposes, the
 *    transaction it says it is, the digest of what they can actually see. The
 *    affidavit is the transport's evidence for the kernel, not the trainer's;
 *    a trainer who trusted it would be confirming a description of a page.
 * 2. **Every pinned dimension is checked, not just the interesting one.** The
 *    page must visibly propose the asked act *and nothing else*: an extra act
 *    riding along on a page the trainer confirms would commit invisibly under
 *    cover of the right one — the phase-3 confirmation trap, again, on a page.
 * 3. **No ask, no consent.** On a question-only scenario any proposed act is
 *    declined; an honest trainer does not confirm surprises.
 */
export function respondToArtifact(
  artifact: DomElement,
  ask: TrainerAsk | undefined,
  at: string,
): ConfirmationEvent | null {
  const seen = walkArtifact(artifact);
  const proposed = seen.units.filter((unit) => unit.visible && unit.id.startsWith("action:")).map((unit) => unit.id);

  if (ask === undefined) return null;
  const wanted = `action:${ask.tool}:${ask.entityId}`;
  if (proposed.length !== 1 || proposed[0] !== wanted) return null;

  const transactionId = seen.transactionId;
  if (transactionId === undefined) return null;

  return {
    id: `confirmation-${transactionId}`,
    transactionId,
    source: "trainer",
    artifactDigest: seen.digest,
    confirmedAt: at,
  };
}
