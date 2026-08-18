/**
 * The transaction seam, followed past "answered": render → confirm → act.
 *
 * The phases below the seam prove their own articles against their own
 * fixtures; the crucible proves every sabotage of the chain. What these tests
 * prove is the composition the seam owns: that an answer proposing an act
 * continues through phase 5's entry points in order, that each way the chain
 * can end — acted, declined, refused — lands as its own outcome rather than
 * being smoothed into another, and that a transaction that never proposes an
 * act never enters the path at all.
 */

import { describe, expect, it } from "vitest";

import { honestDraft } from "../crucible/phase2.js";
import { renderAnswer } from "../render/reference.js";
import type { ConfirmationEvent, ScopeDimension } from "./contracts.js";
import { type DomElement, walkArtifact } from "./dom.js";
import { REQUIRED_DIMENSIONS } from "./scope.js";
import { type ActTransport, actionClaims, type AnswerPlan, runTransaction, type Transaction } from "./transaction.js";
import { denialCode } from "./violation.js";
import { COMMIT_TIME, ISSUED_AT, kantoPack, kantoRegistry, LOCALE, trainerTranscript } from "../testing/fixtures.js";

const REQUIRED: readonly ScopeDimension[] = [...REQUIRED_DIMENSIONS, "comparisonBasis"];

/** The chain's moments, supplied rather than clocked, inside the grant window. */
const RENDERED_AT = "2026-01-01T12:00:05Z";
const CONFIRMED_AT = "2026-01-01T12:00:30Z";
const AUTHORIZED_AT = "2026-01-01T12:00:31Z";
const EXECUTED_AT = "2026-01-01T12:00:32Z";

const answerPlan: AnswerPlan = (context, transactionId) => ({ ...honestDraft(context), transactionId });

/** Phase 2's honest answer, plus the act it leads to — phase 5's own fixture. */
const actPlan: AnswerPlan = (context, transactionId) => {
  const draft = honestDraft(context);
  return {
    ...draft,
    transactionId,
    claims: [...draft.claims, { kind: "action", tool: "release", entityId: "pikachu" }],
  };
};

/** A trainer who confirms what they see: their own walk, their own digest. */
function trainerConfirms(artifact: DomElement): ConfirmationEvent {
  const seen = walkArtifact(artifact);
  return {
    id: `confirmation-${seen.transactionId ?? "unmarked"}`,
    transactionId: seen.transactionId ?? "",
    source: "trainer",
    artifactDigest: seen.digest,
    confirmedAt: CONFIRMED_AT,
  };
}

function transport(confirm: ActTransport["confirm"] = trainerConfirms): ActTransport {
  return {
    render: renderAnswer,
    confirm,
    renderedAt: RENDERED_AT,
    authorizedAt: AUTHORIZED_AT,
    executedAt: EXECUTED_AT,
  };
}

function run(id: string, plan: AnswerPlan, act?: ActTransport): Transaction {
  return runTransaction({
    id,
    registry: kantoRegistry(),
    pack: kantoPack(),
    transcript: trainerTranscript(),
    establishedAt: ISSUED_AT,
    committedAt: COMMIT_TIME,
    locale: LOCALE,
    required: REQUIRED,
    plan,
    ...(act === undefined ? {} : { act }),
  });
}

describe("the act path, walked through the kernel's own doors", () => {
  it("commits the whole chain: rendered, attested, confirmed, authorised", () => {
    const transaction = run("txn-acted", actPlan, transport());

    expect(transaction.outcome.status).toBe("acted");
    expect(transaction.verdicts.map((entry) => entry.stage)).toEqual(["scope", "answer", "action"]);
    expect(transaction.verdicts.every((entry) => entry.verdict.allowed)).toBe(true);

    // The record carries the whole chain: the page, the attestation of it, the
    // trainer's confirmation of that exact page, and one grant for the one act.
    expect(transaction.artifact).toBeDefined();
    expect(transaction.affidavit?.artifactDigest).toBe(transaction.confirmation?.artifactDigest);
    expect(transaction.actionGrants).toHaveLength(1);
    expect(transaction.actionGrants?.[0]).toMatchObject({
      transactionId: "txn-acted",
      tool: "release",
      entityId: "pikachu",
      authorizedAt: AUTHORIZED_AT,
    });
    expect(transaction.executedAt).toBe(EXECUTED_AT);
  });

  it("never enters the path for an answer that proposes no act", () => {
    const transaction = run("txn-plain", answerPlan, transport());

    expect(transaction.outcome.status).toBe("answered");
    expect(actionClaims(transaction.manifest!)).toHaveLength(0);
    expect(transaction.artifact).toBeUndefined();
    expect(transaction.renderedAt).toBeUndefined();
  });

  it("stops at answered when no transport offers the path, and executes nothing", () => {
    const transaction = run("txn-no-transport", actPlan);

    expect(transaction.outcome.status).toBe("answered");
    expect(transaction.actionGrants).toBeUndefined();
    expect(transaction.artifact).toBeUndefined();
  });

  it("honours the trainer declining: the answer stands, nothing executes", () => {
    const transaction = run("txn-declined", actPlan, transport(() => null));

    expect(transaction.outcome.status).toBe("declined");
    // The answer itself was certified — the manifest and the page are on
    // record — but no confirmation and no grant exist to act on.
    expect(transaction.manifest).toBeDefined();
    expect(transaction.artifact).toBeDefined();
    expect(transaction.affidavit).toBeDefined();
    expect(transaction.confirmation).toBeUndefined();
    expect(transaction.actionGrants).toBeUndefined();
  });

  it("refuses a confirmation of a different page, by name", () => {
    const doctored = transport((artifact) => ({
      ...trainerConfirms(artifact),
      artifactDigest: "sha256:some-other-page",
    }));
    const transaction = run("txn-doctored-digest", actPlan, doctored);

    expect(transaction.outcome.status).toBe("denied");
    if (transaction.outcome.status !== "denied") throw new Error("unreachable");
    expect(transaction.outcome.stage).toBe("action");
    expect(transaction.outcome.violations.map(denialCode)).toContain("IA-7/confirmation-digest-mismatch");
    expect(transaction.actionGrants).toBeUndefined();
  });

  it("refuses consent from a channel that cannot consent (IA-8)", () => {
    const forged = transport((artifact) => ({ ...trainerConfirms(artifact), source: "tool" }));
    const transaction = run("txn-forged-channel", actPlan, forged);

    expect(transaction.outcome.status).toBe("denied");
    if (transaction.outcome.status !== "denied") throw new Error("unreachable");
    expect(transaction.outcome.stage).toBe("action");
    expect(transaction.outcome.violations.map(denialCode)).toContain("IA-8/confirmation-not-from-trainer");
  });
});

describe("the seam teaches before it interrogates", () => {
  it("commits a lessons-only plan under a clarifying scope, grantless", () => {
    const record = runTransaction({
      id: "txn-teach",
      registry: kantoRegistry(),
      pack: kantoPack(),
      transcript: [{ kind: "utterance", at: ISSUED_AT, source: "trainer", text: "What's a badge?" }],
      establishedAt: ISSUED_AT,
      committedAt: COMMIT_TIME,
      locale: LOCALE,
      plan: () => ({
        transactionId: "txn-teach",
        claims: [{ kind: "explanation", blockId: "what-is-badge" }],
        rosters: [],
      }),
    });
    expect(record.outcome.status).toBe("answered");
    expect(record.grant).toBeUndefined();
    expect(record.manifest?.scopeGrantId).toBeUndefined();
  });

  it("still asks when the plan wants anything personal", () => {
    const record = runTransaction({
      id: "txn-no-teach",
      registry: kantoRegistry(),
      pack: kantoPack(),
      transcript: [{ kind: "utterance", at: ISSUED_AT, source: "trainer", text: "Where can I catch Abra?" }],
      establishedAt: ISSUED_AT,
      committedAt: COMMIT_TIME,
      locale: LOCALE,
      plan: () => ({
        transactionId: "txn-no-teach",
        claims: [{ kind: "fact", entityId: "abra", factId: "locations" }],
        rosters: [],
      }),
    });
    expect(record.outcome.status).toBe("clarifying");
  });
});
